import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CHANNEL_CAPABILITIES } from '@lumo/safety-domain';
import { PrismaService } from '../prisma/prisma.service';
import { TrustedContactsService } from '../trusted-contacts/trusted-contacts.service';
import { LedgerService } from './ledger.service';
import { alertBody } from './message-templates';
import { NotificationQueue } from './queue';
import { SMS_PROVIDER, type SmsProvider } from './sms/sms-provider';

/**
 * Runs the jobs (docs/specs/NOTIFICATIONS.md). Every way a send can end is a ledger row that
 * says which; none is silent, and none is retried by sending a second message.
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
  ) {}

  onModuleInit() {
    this.queue.setHandlers({ send: id => this.send(id), expire: id => this.expire(id) });
  }

  /** At most once: claim first, send second. A redelivered job finds the claim and stops. */
  async send(attemptId: string, now: Date = new Date()): Promise<void> {
    const claimed = await this.prisma.notificationAttempt.updateMany({
      where: { id: attemptId, state: 'QUEUED', claimedAt: null },
      data: { claimedAt: now },
    });
    if (claimed.count !== 1) return;

    const attempt = await this.prisma.notificationAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const notAttempted = (reason: string) =>
      this.ledger.apply(attemptId, [{ event: 'NOT_ATTEMPTED', by: 'system', reason }], now);

    if (attempt.channel !== 'sms') return void (await notAttempted('NO_ADDRESS'));

    // Consent and existence are checked AGAIN here: both can change between planning and sending.
    const contact = await this.contacts.findActive(this.prisma, attempt.recipientId);
    if (!contact) return void (await notAttempted('CONTACT_REMOVED'));
    if (!contact.consented || contact.consentStatus !== 'agreed') return void (await notAttempted('CONSENT_WITHDRAWN'));

    if (!this.sms.configured()) return void (await notAttempted('PROVIDER_NOT_CONFIGURED'));

    const owner = await this.prisma.user.findUnique({ where: { id: contact.userId }, select: { fullName: true } });
    const outcome = await this.sms.send({ to: contact.phone, body: alertBody(owner?.fullName ?? 'Someone'), attemptId });

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
      // reported but did not has EXPIRED.
      const providerDependent = CHANNEL_CAPABILITIES[attempt.channel].receipts === 'provider-dependent';
      await this.ledger.apply(
        attemptId,
        [{ event: providerDependent ? 'CHANNEL_CANNOT_REPORT' : 'TTL_ELAPSED', by: 'system', reason: 'NO_RECEIPT_BY_TTL' }],
        now,
      );
    }
    // Any other state is already settled: nothing to do.
  }
}
