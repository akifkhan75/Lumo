import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CHANNEL_CAPABILITIES, type AttemptEvent } from '@lumo/safety-domain';
import { PrismaService } from '../prisma/prisma.service';
import { TrustedContactsService } from '../trusted-contacts/trusted-contacts.service';
import { LedgerService, type Step } from './ledger.service';
import { alertBody, pushBody, resolvedBody, voiceScript, type AlertKind, type AlertLocation } from './message-templates';
import { NotificationQueue } from './queue';
import { SMS_PROVIDER, type SmsProvider } from './sms/sms-provider';
import { VOICE_PROVIDER, type VoiceProvider } from './voice/voice-provider';
import { PUSH_PROVIDER, type PushProvider } from './push/push-provider';
import { DevicesService } from '../devices/devices.service';

/**
 * Runs the jobs (docs/specs/NOTIFICATIONS.md). Every way a send can end is a ledger row that
 * says which; none is silent, and none is retried by sending a second message.
 *
 * ORDER MATTERS. Everything that can throw or decide "do not send" (the lookups, the consent
 * re-check, the configuration check) happens BEFORE the claim. The claim is taken immediately
 * before the provider is called and not a moment earlier: a claim taken first and then followed
 * by a failing lookup would leave the attempt claimed but unsent, so the job's retry would find
 * the claim and stop, and the attempt would sit QUEUED for its whole time-to-live and then be
 * recorded as "outcome unknown" although nothing had been sent.
 */
@Injectable()
export class SendWorker implements OnModuleInit {
  private readonly logger = new Logger('SendWorker');

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: TrustedContactsService,
    private readonly ledger: LedgerService,
    private readonly queue: NotificationQueue,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(VOICE_PROVIDER) private readonly voice: VoiceProvider,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
    private readonly devices: DevicesService,
  ) {}

  onModuleInit() {
    this.queue.setHandlers({ send: id => this.send(id), expire: id => this.expire(id), receipts: id => this.checkReceipts(id) });
  }

  private skip(attemptId: string, reason: string, now: Date) {
    return this.ledger.apply(attemptId, [{ event: 'NOT_ATTEMPTED', by: 'system', reason }], now);
  }

  /** At most once: decide, then claim, then send. A redelivered job finds the claim and stops. */
  async send(attemptId: string, now: Date = new Date()): Promise<void> {
    const attempt = await this.prisma.notificationAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.state !== 'QUEUED' || attempt.claimedAt) return;

    if (attempt.channel !== 'sms' && attempt.channel !== 'voice' && attempt.channel !== 'push') {
      return void (await this.skip(attemptId, 'NO_ADDRESS', now));
    }

    // The practice boundary, before anything else can lead to a provider: a rehearsal is never sent (docs/specs/PRACTICE_MODE.md).
    const incident = await this.prisma.emergencyIncident.findUnique({ where: { id: attempt.incidentId }, select: { triggerType: true, mode: true, lateBySeconds: true } });
    if (incident?.mode === 'practice') {
      this.ledger.counters.set('send.practice_refused', (this.ledger.counters.get('send.practice_refused') ?? 0) + 1);
      return void (await this.skip(attemptId, 'PRACTICE_MODE', now));
    }

    // Consent and existence are checked AGAIN here: both can change between planning and sending.
    const contact = await this.contacts.findActive(this.prisma, attempt.recipientId);
    if (!contact) return void (await this.skip(attemptId, 'CONTACT_REMOVED', now));
    if (!contact.consented || contact.consentStatus !== 'agreed') return void (await this.skip(attemptId, 'CONSENT_WITHDRAWN', now));

    // Push has an address only if the contact CLAIMED their invite while signed in, and only the
    // live tokens of THAT account. Never inferred from a matching phone or email.
    let tokens: { id: string; pushToken: string }[] = [];
    if (attempt.channel === 'push') {
      tokens = contact.linkedUserId ? await this.devices.tokensFor(contact.linkedUserId) : [];
      if (tokens.length === 0) return void (await this.skip(attemptId, 'NO_ADDRESS', now));
    }

    const provider = attempt.channel === 'sms' ? this.sms : attempt.channel === 'voice' ? this.voice : this.push;
    if (!provider.configured()) return void (await this.skip(attemptId, 'PROVIDER_NOT_CONFIGURED', now));

    const owner = await this.prisma.user.findUnique({ where: { id: contact.userId }, select: { fullName: true, shareLocationOnSos: true } });
    const name = owner?.fullName ?? 'Someone';
    const resolved = attempt.purpose === 'RESOLVED';
    const kind: AlertKind = incident?.triggerType === 'missed_check_in' ? 'missed_check_in' : 'sos';
    // A position goes into a message only if the user allows it, and only for an alert (not for "it ended").
    const location = !resolved && owner?.shareLocationOnSos ? await this.latestLocation(attempt.incidentId) : null;

    // The claim: from here the provider may be called, so from here a retry must not call it again.
    const claimed = await this.prisma.notificationAttempt.updateMany({
      where: { id: attemptId, state: 'QUEUED', claimedAt: null },
      data: { claimedAt: now },
    });
    if (claimed.count !== 1) return;

    if (attempt.channel === 'push') return this.sendPush(attemptId, tokens.map(t => t.pushToken), name, resolved, kind, now, incident?.lateBySeconds ?? 0);

    const outcome =
      attempt.channel === 'sms'
        ? await this.sms.send({ to: contact.phone, body: resolved ? resolvedBody(name) : alertBody(name, location, now.getTime(), kind, incident?.lateBySeconds ?? 0), attemptId })
        : await this.voice.call({ to: contact.phone, script: voiceScript(name, kind, incident?.lateBySeconds ?? 0), attemptId });

    if (outcome.kind === 'accepted') {
      await this.ledger.apply(
        attemptId,
        [{ event: 'PROVIDER_ACCEPTED', by: 'system', reason: 'PROVIDER_ACCEPTED', providerMessageId: outcome.providerMessageId, providerStatus: outcome.status }],
        now,
      );
    } else if (outcome.kind === 'rejected') {
      await this.ledger.apply(attemptId, [{ event: 'PROVIDER_REJECTED', by: 'system', reason: outcome.reason }], now);
    } else {
      // No answer. The message may have gone. Record nothing and never re-send: the attempt
      // stays claimed, and its expiry says SEND_OUTCOME_UNKNOWN.
      this.ledger.counters.set('send.ambiguous', (this.ledger.counters.get('send.ambiguous') ?? 0) + 1);
      this.logger.warn('send outcome unknown; attempt left claimed');
    }
  }

  private async latestLocation(incidentId: string): Promise<AlertLocation | null> {
    const s = await this.prisma.locationSnapshot.findFirst({ where: { incidentId }, orderBy: { capturedAt: 'desc' } });
    return s ? { latitude: s.latitude, longitude: s.longitude, accuracyM: s.accuracyM, capturedAt: s.capturedAt.getTime() } : null;
  }

  private async sendPush(attemptId: string, tokens: string[], name: string, resolved: boolean, kind: AlertKind, now: Date, lateBySeconds = 0): Promise<void> {
    const outcome = await this.push.send({ tokens, title: resolved ? 'Lumo' : 'Lumo alert', body: resolved ? resolvedBody(name) : pushBody(name, kind, lateBySeconds), attemptId });
    // A token the service says is dead stops receiving anything.
    for (const dead of outcome.kind === 'ambiguous' ? [] : outcome.deadTokens) await this.devices.revokeToken(dead, now);

    if (outcome.kind === 'accepted') {
      // Several devices, one attempt: the ticket ids are kept together, and the attempt is
      // SENT if the service accepted AT LEAST ONE. It is not "delivered to all" or to any.
      await this.ledger.apply(
        attemptId,
        [{ event: 'PROVIDER_ACCEPTED', by: 'system', reason: 'PROVIDER_ACCEPTED', providerMessageId: outcome.tickets.map(t => t.id).join(','), providerStatus: 'ticket_ok' }],
        now,
      );
    } else if (outcome.kind === 'rejected') {
      await this.ledger.apply(attemptId, [{ event: 'PROVIDER_REJECTED', by: 'system', reason: outcome.reason }], now);
    } else {
      this.ledger.counters.set('send.ambiguous', (this.ledger.counters.get('send.ambiguous') ?? 0) + 1);
      this.logger.warn('send outcome unknown; attempt left claimed');
    }
  }

  /**
   * About 15 minutes after a push was accepted (Expo's advice), ask the service what it did with
   * it. An `ok` receipt means FCM or APNs accepted it — recorded as a fact, NEVER as delivery. If
   * every ticket errored the message went nowhere: a failure. Otherwise nothing changes, and the
   * time-to-live settles the attempt as "sent, not confirmed".
   */
  async checkReceipts(attemptId: string, now: Date = new Date()): Promise<void> {
    const attempt = await this.prisma.notificationAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.channel !== 'push' || attempt.state !== 'SENT' || !attempt.providerMessageId) return;
    const ids = attempt.providerMessageId.split(',');
    const receipts = await this.push.receipts(ids);
    if (receipts === null) throw new Error('receipts unavailable'); // the queue retries

    const seen = ids.map(id => receipts.get(id)).filter((r): r is NonNullable<typeof r> => r !== undefined);
    if (seen.length === 0) return; // not available yet; the TTL settles it
    if (seen.some(r => r.status === 'ok')) {
      await this.ledger.recordProviderStatus(attemptId, 'push_service_accepted');
    } else if (seen.length === ids.length) {
      const first = seen[0];
      const reason = first.status === 'error' ? `EXPO_${first.error}` : 'EXPO_ERROR';
      await this.ledger.apply(attemptId, [{ event: 'PROVIDER_REPORTED_FAILURE', by: 'system', reason }], now);
    }
  }

  /** At the time-to-live: settle whatever is still open, saying why. */
  async expire(attemptId: string, now: Date = new Date()): Promise<void> {
    const attempt = await this.prisma.notificationAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) return;

    if (attempt.state === 'QUEUED') {
      await this.ledger.apply(
        attemptId,
        [{ event: 'TTL_ELAPSED', by: 'system', reason: attempt.claimedAt ? 'SEND_OUTCOME_UNKNOWN' : 'NEVER_SENT' }],
        now,
      );
    } else if (attempt.state === 'SENT') {
      // A channel whose receipts depend on the destination network (SMS) that stayed at SENT
      // is "delivery unconfirmed", not "did not arrive": UNKNOWN. A channel that should have
      // reported but did not has EXPIRED. A channel that stops at SENT (voice) settles UNKNOWN.
      const cap = CHANNEL_CAPABILITIES[attempt.channel];
      // A silent device looks like an absent one (push): "sent, not confirmed", like an SMS with no receipt.
      const providerDependent = cap.receipts === 'provider-dependent' || cap.deliveredEvidence === 'device';
      const event: AttemptEvent = providerDependent ? 'CHANNEL_CANNOT_REPORT' : 'TTL_ELAPSED';
      const step: Step = { event, by: 'system', reason: 'NO_RECEIPT_BY_TTL' };
      await this.ledger.apply(attemptId, [step], now);
    }
    // Any other state is already settled: nothing to do.
  }
}
