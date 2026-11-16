import { Injectable } from '@nestjs/common';
import type { Channel } from '@lumo/safety-domain';
import { PrismaService } from '../prisma/prisma.service';
import { resolveRecipients, type SkipReason } from '../trusted-contacts/recipients';
import { TrustedContactsService } from '../trusted-contacts/trusted-contacts.service';
import { LedgerService, type Tx } from './ledger.service';
import { NotificationQueue } from './queue';

/**
 * Plans the attempts for an incident (docs/specs/NOTIFICATIONS.md).
 *
 * In ONE transaction: one QUEUED attempt per recipient and channel, its first event, and its
 * jobs. Recipients come only from `resolveRecipients`; a contact who may not be alerted is
 * not dropped but ledgered, with the reason, as an attempt that was never made.
 *
 * Nothing calls this yet — incidents are milestone 1.8. It exists now so the ledger, the
 * queue and the worker can be proven end to end before an incident can be raised.
 */

const MINUTE = 60;

/** How long an attempt may stay open before the ledger settles it, by channel. */
export function ttlSeconds(channel: Channel): number {
  switch (channel) {
    case 'sms':
      return 15 * MINUTE;
    case 'email':
      return 60 * MINUTE;
    case 'voice':
    case 'device_direct_sms':
      return 5 * MINUTE;
    default:
      return 10 * MINUTE; // push, web
  }
}

const SKIP_TO_REASON: Record<SkipReason, string> = {
  NOT_INVITED: 'CONSENT_NOT_INVITED',
  AWAITING_CONSENT: 'CONSENT_AWAITING',
  INVITE_EXPIRED: 'CONSENT_INVITE_EXPIRED',
  WITHDRAWN: 'CONSENT_WITHDRAWN',
  DETAILS_CHANGED: 'CONSENT_DETAILS_CHANGED',
};

export interface PlanInput {
  readonly incidentId: string;
  readonly userId: string;
  readonly channels: readonly Channel[];
  readonly now?: Date;
}

export interface PlannedAttempt {
  readonly attemptId: string;
  readonly recipientId: string;
  readonly channel: Channel;
  /** Queued for the worker, or settled at once as "never attempted". */
  readonly outcome: 'queued' | 'not_attempted';
  readonly reason?: string;
}

@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: TrustedContactsService,
    private readonly ledger: LedgerService,
    private readonly queue: NotificationQueue,
  ) {}

  /** Plan inside the caller's transaction, so an incident and its attempts commit together. */
  async planIn(tx: Tx, input: PlanInput): Promise<PlannedAttempt[]> {
    const now = input.now ?? new Date();
    const { eligible, skipped } = resolveRecipients(await this.contacts.list(tx, input.userId));
    const planned: PlannedAttempt[] = [];

    const create = async (recipientId: string, channel: Channel) => {
      const attempt = await tx.notificationAttempt.create({
        data: { incidentId: input.incidentId, recipientId, channel, escalationStep: 0, queuedAt: now },
      });
      await tx.notificationEvent.create({ data: { attemptId: attempt.id, toState: 'QUEUED', reason: 'PLANNED', occurredAt: now } });
      return attempt.id;
    };

    for (const contact of eligible) {
      for (const channel of input.channels) {
        const attemptId = await create(contact.id, channel);
        if (channel === 'sms') {
          await this.queue.enqueueSend(tx, attemptId);
          await this.queue.enqueueExpiry(tx, attemptId, ttlSeconds(channel));
          planned.push({ attemptId, recipientId: contact.id, channel, outcome: 'queued' });
        } else {
          // No address: a Device belongs to a user and a contact is not linked to one (and is
          // never matched by email or number). Other channels arrive in 1.7b.
          await this.ledger.apply(attemptId, [{ event: 'NOT_ATTEMPTED', by: 'system', reason: 'NO_ADDRESS' }], now, tx);
          planned.push({ attemptId, recipientId: contact.id, channel, outcome: 'not_attempted', reason: 'NO_ADDRESS' });
        }
      }
    }

    for (const skip of skipped) {
      for (const channel of input.channels) {
        const attemptId = await create(skip.contactId, channel);
        const reason = SKIP_TO_REASON[skip.reason];
        await this.ledger.apply(attemptId, [{ event: 'NOT_ATTEMPTED', by: 'policy', reason }], now, tx);
        planned.push({ attemptId, recipientId: skip.contactId, channel, outcome: 'not_attempted', reason });
      }
    }
    return planned;
  }

  plan(input: PlanInput): Promise<PlannedAttempt[]> {
    return this.prisma.$transaction(tx => this.planIn(tx, input));
  }
}
