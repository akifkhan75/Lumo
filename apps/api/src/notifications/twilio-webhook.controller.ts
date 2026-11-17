import { Body, Controller, ForbiddenException, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import twilio from 'twilio';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService, type Step } from './ledger.service';
import { getTwilioConfig } from './sms/twilio-sms';
import { getTwilioVoiceConfig } from './voice/twilio-voice';

/**
 * Twilio's delivery-status callbacks (docs/specs/NOTIFICATIONS.md).
 *
 * UNAUTHENTICATED BY DESIGN: Twilio holds no account here. The SIGNATURE is the gate. It is an
 * HMAC over the exact public URL and the form parameters, so the URL is built from
 * PUBLIC_API_URL, never from the request's Host header (an attacker controls that). Validation is
 * Twilio's own `validateRequest`, as their docs direct, not a copy of the algorithm.
 *
 * Exempt from the global throttler (a burst of callbacks must not be dropped) and takes an
 * untyped body (Twilio adds fields without notice, and the global pipe rejects unknown ones).
 * Neither exemption applies to any other route.
 *
 * Callbacks arrive twice, late, out of order, and sometimes BEFORE the worker has committed
 * SENT. The attempt is found by the id in the callback URL (covered by the signature), not by
 * Twilio's message id, which may not be stored yet. A body, number or signature is never logged.
 */
@Controller('api/v1/webhooks/twilio')
export class TwilioWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /** The signature is the gate. The URL it covers comes from config, never from the request's Host. */
  private verify(req: Request, signature: string | undefined, body: Record<string, string>) {
    // SMS and voice share one account, so either configuration can vouch for the account's token.
    const config = getTwilioConfig() ?? getTwilioVoiceConfig();
    if (!config || !signature) throw new ForbiddenException();
    const url = `${config.publicApiUrl}${req.originalUrl}`;
    if (!twilio.validateRequest(config.authToken, signature, url, body ?? {})) {
      this.ledger.counters.set('webhook.bad_signature', (this.ledger.counters.get('webhook.bad_signature') ?? 0) + 1);
      throw new ForbiddenException();
    }
  }

  @Post('voice-status')
  @SkipThrottle()
  @HttpCode(200)
  async voiceStatus(
    @Req() req: Request,
    @Headers('x-twilio-signature') signature: string | undefined,
    @Query('attempt') attemptId: string | undefined,
    @Body() body: Record<string, string>,
  ) {
    this.verify(req, signature, body);
    const sid = body?.CallSid;
    const status = body?.CallStatus;
    if (!attemptId || !sid || !status) return { ok: true };

    const attempt = await this.prisma.notificationAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.channel !== 'voice' || (attempt.providerMessageId && attempt.providerMessageId !== sid)) {
      this.ledger.counters.set('webhook.unmatched', (this.ledger.counters.get('webhook.unmatched') ?? 0) + 1);
      return { ok: true };
    }

    const inferAccepted: Step = {
      event: 'PROVIDER_ACCEPTED', by: 'system', reason: 'INFERRED_FROM_CALLBACK', onlyFrom: 'QUEUED', providerMessageId: sid, providerStatus: status,
    };
    if (['busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
      // Nobody picked up (or the number was bad): the call did not reach a person.
      await this.ledger.apply(attempt.id, [inferAccepted, { event: 'PROVIDER_REPORTED_FAILURE', by: 'system', reason: `VOICE_${status.toUpperCase().replace('-', '_')}`, providerStatus: status }]);
    } else {
      await this.ledger.apply(attempt.id, [inferAccepted]);
      // "Answered" is a FACT about the call, recorded on the attempt, and nothing more: a voicemail
      // answers too, answered is not understood, and a call is never an acknowledgement. The
      // channel stops at SENT, so the attempt settles UNKNOWN at its time-to-live.
      if (status === 'in-progress' || status === 'completed') await this.ledger.recordProviderStatus(attempt.id, status);
    }
    return { ok: true };
  }

  @Post('status')
  @SkipThrottle()
  @HttpCode(200)
  async status(
    @Req() req: Request,
    @Headers('x-twilio-signature') signature: string | undefined,
    @Query('attempt') attemptId: string | undefined,
    @Body() body: Record<string, string>,
  ) {
    this.verify(req, signature, body);

    const sid = body?.MessageSid;
    const status = body?.MessageStatus;
    if (!attemptId || !sid || !status) return { ok: true };

    const attempt = await this.prisma.notificationAttempt.findUnique({ where: { id: attemptId } });
    // Unknown attempt, or a message id that is not the one we recorded: ignore, and count.
    if (!attempt || attempt.channel !== 'sms' || (attempt.providerMessageId && attempt.providerMessageId !== sid)) {
      this.ledger.counters.set('webhook.unmatched', (this.ledger.counters.get('webhook.unmatched') ?? 0) + 1);
      return { ok: true };
    }

    // The provider accepted the message, whatever else it says. If we have not recorded
    // that yet (the callback beat the worker, or the worker crashed) do it now, honestly.
    const inferAccepted: Step = {
      event: 'PROVIDER_ACCEPTED', by: 'system', reason: 'INFERRED_FROM_CALLBACK', onlyFrom: 'QUEUED', providerMessageId: sid, providerStatus: status,
    };
    let steps: Step[];
    if (status === 'delivered') {
      steps = [inferAccepted, { event: 'RECEIPT_DELIVERED', by: 'system', evidence: 'provider', reason: 'PROVIDER_RECEIPT', providerStatus: status }];
    } else if (status === 'undelivered' || status === 'failed') {
      const code = body?.ErrorCode ? `TWILIO_${body.ErrorCode}` : status.toUpperCase();
      steps = [inferAccepted, { event: 'PROVIDER_REPORTED_FAILURE', by: 'system', reason: code, providerStatus: status }];
    } else if (['sent', 'sending', 'queued', 'accepted'].includes(status)) {
      steps = [inferAccepted];
    } else {
      return { ok: true }; // a status we do not act on (read, canceled, ...)
    }

    await this.ledger.apply(attempt.id, steps);
    return { ok: true };
  }
}
