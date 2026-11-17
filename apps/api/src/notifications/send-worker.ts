import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CHANNEL_CAPABILITIES, type AttemptEvent } from '@lumo/safety-domain';
import { PrismaService } from '../prisma/prisma.service';
import { TrustedContactsService } from '../trusted-contacts/trusted-contacts.service';
import { LedgerService, type Step } from './ledger.service';
import { alertBody, voiceScript } from './message-templates';
import { NotificationQueue } from './queue';
import { SMS_PROVIDER, type SmsProvider } from './sms/sms-provider';
import { VOICE_PROVIDER, type VoiceProvider } from './voice/voice-provider';

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
  ) {}

  onModuleInit() {
    this.queue.setHandlers({ send: id => this.send(id), expire: id => this.expire(id) });
  }

  private skip(attemptId: string, reason: string, now: Date) {
    return this.ledger.apply(attemptId, [{ event: 'NOT_ATTEMPTED', by: 'system', reason }], now);
  }

  /** At most once: decide, then claim, then send. A redelivered job finds the claim and stops. */
  async send(attemptId: string, now: Date = new Date()): Promise<void> {
    const attempt = await this.prisma.notificationAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.state !== 'QUEUED' || attempt.claimedAt) return;

    if (attempt.channel !== 'sms' && attempt.channel !== 'voice') return void (await this.skip(attemptId, 'NO_ADDRESS', now));

    // Consent and existence are checked AGAIN here: both can change between planning and sending.
    const contact = await this.contacts.findActive(this.prisma, attempt.recipientId);
    if (!contact) return void (await this.skip(attemptId, 'CONTACT_REMOVED', now));
    if (!contact.consented || contact.consentStatus !== 'agreed') return void (await this.skip(attemptId, 'CONSENT_WITHDRAWN', now));

    const provider = attempt.channel === 'sms' ? this.sms : this.voice;
    if (!provider.configured()) return void (await this.skip(attemptId, 'PROVIDER_NOT_CONFIGURED', now));

    const owner = await this.prisma.user.findUnique({ where: { id: contact.userId }, select: { fullName: true } });
    const name = owner?.fullName ?? 'Someone';

    // The claim: from here the provider may be called, so from here a retry must not call it again.
    const claimed = await this.prisma.notificationAttempt.updateMany({
      where: { id: attemptId, state: 'QUEUED', claimedAt: null },
      data: { claimedAt: now },
    });
    if (claimed.count !== 1) return;

    const outcome =
      attempt.channel === 'sms'
        ? await this.sms.send({ to: contact.phone, body: alertBody(name), attemptId })
        : await this.voice.call({ to: contact.phone, script: voiceScript(name), attemptId });

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
      const providerDependent = CHANNEL_CAPABILITIES[attempt.channel].receipts === 'provider-dependent';
      const event: AttemptEvent = providerDependent ? 'CHANNEL_CANNOT_REPORT' : 'TTL_ELAPSED';
      const step: Step = { event, by: 'system', reason: 'NO_RECEIPT_BY_TTL' };
      await this.ledger.apply(attemptId, [step], now);
    }
    // Any other state is already settled: nothing to do.
  }
}
