import { Inject, Injectable, Logger } from '@nestjs/common';
import { channelGate, dailyCapFor, type RegionProfile, type RegionRegistry } from '@lumo/region-profiles';
import { REGION_REGISTRY } from '../regions/regions.module';
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
    case 'push':
      // Longer than the receipt check (15 minutes): Expo advises checking receipts about then, and
      // the check must be able to run BEFORE the attempt is settled as not confirmed.
      return 20 * MINUTE;
    case 'voice':
    case 'device_direct_sms':
      return 5 * MINUTE;
    default:
      return 10 * MINUTE; // web
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
  /** Queued for the worker; settled at once as "never attempted"; or stopped by the daily cap. */
  readonly outcome: 'queued' | 'not_attempted' | 'capped';
  readonly reason?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** When to ask the push service whether it handed the message on (Expo: about 15 minutes). */
export const PUSH_RECEIPT_CHECK_SECONDS = 15 * 60;
/** Channels the worker can send today. Web has no sender yet; push needs a linked contact (checked at send time). */
const SENDABLE: ReadonlySet<Channel> = new Set<Channel>(['sms', 'voice', 'push']);

@Injectable()
export class DispatchService {
  private readonly logger = new Logger('Dispatch');

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: TrustedContactsService,
    private readonly ledger: LedgerService,
    private readonly queue: NotificationQueue,
    @Inject(REGION_REGISTRY) private readonly regions: RegionRegistry,
  ) {}

  /**
   * The daily cap for a channel. From the incident's profile; with NO profile, the STRICTEST cap
   * among the known profiles, because "we do not know where this is" must not mean "unlimited".
   */
  private capFor(profile: RegionProfile | null, channel: Channel): number | null {
    if (profile) return dailyCapFor(profile, channel);
    const caps = this.regions.profiles.map(p => dailyCapFor(p, channel)).filter((c): c is number => c !== null);
    return caps.length > 0 ? Math.min(...caps) : null;
  }

  /** Does this contact have a claimed account with at least one live push device? */
  private async hasPushAddress(tx: Tx, contactId: string): Promise<boolean> {
    const link = await tx.trustedContact.findUnique({ where: { id: contactId }, select: { linkedUserId: true } });
    if (!link?.linkedUserId) return false;
    return (await tx.device.count({ where: { userId: link.linkedUserId, revokedAt: null, pushToken: { not: null } } })) > 0;
  }

  /** Plan inside the caller's transaction, so an incident and its attempts commit together. */
  async planIn(tx: Tx, input: PlanInput): Promise<PlannedAttempt[]> {
    const now = input.now ?? new Date();
    const incident = await tx.emergencyIncident.findUniqueOrThrow({
      where: { id: input.incidentId },
      select: { userId: true, regionProfileId: true },
    });
    if (incident.userId !== input.userId) throw new Error('The incident does not belong to this user.');

    // Region of the INCIDENT (where the device was), not of the account.
    const profile = this.regions.profileFor(incident.regionProfileId);
    if (!profile) this.ledger.counters.set('plan.no_region_profile', (this.ledger.counters.get('plan.no_region_profile') ?? 0) + 1);

    // One plan at a time per user: the cap is read, then spent, and two concurrent plans must not
    // both read the same remaining budget. The lock is released with the transaction.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lumo.cap:${input.userId}`}))`;
    const remaining = new Map<Channel, number | null>();
    for (const channel of new Set(input.channels)) {
      const cap = this.capFor(profile, channel);
      if (cap === null || !SENDABLE.has(channel)) {
        remaining.set(channel, null);
        continue;
      }
      const used = await tx.notificationAttempt.count({
        where: { channel, reservedAt: { gt: new Date(now.getTime() - DAY_MS) }, incident: { userId: input.userId } },
      });
      remaining.set(channel, Math.max(0, cap - used));
    }

    const { eligible, skipped } = resolveRecipients(await this.contacts.list(tx, input.userId));
    const planned: PlannedAttempt[] = [];

    const create = async (recipientId: string, channel: Channel, reserved: boolean) => {
      const attempt = await tx.notificationAttempt.create({
        data: { incidentId: input.incidentId, recipientId, channel, escalationStep: 0, queuedAt: now, reservedAt: reserved ? now : null },
      });
      await tx.notificationEvent.create({ data: { attemptId: attempt.id, toState: 'QUEUED', reason: 'PLANNED', occurredAt: now } });
      return attempt.id;
    };
    const settle = async (recipientId: string, channel: Channel, event: 'NOT_ATTEMPTED' | 'SPEND_CAP_REACHED', by: 'system' | 'policy', reason: string) => {
      const attemptId = await create(recipientId, channel, false);
      await this.ledger.apply(attemptId, [{ event, by, reason }], now, tx);
      planned.push({ attemptId, recipientId, channel, outcome: event === 'SPEND_CAP_REACHED' ? 'capped' : 'not_attempted', reason });
    };

    // Contacts are in priority order, so the budget goes to the first-priority contacts first.
    for (const contact of eligible) {
      for (const channel of input.channels) {
        const gate = profile ? channelGate(profile, channel) : ({ allowed: true } as const);
        if (!gate.allowed) {
          await settle(contact.id, channel, 'NOT_ATTEMPTED', 'policy', gate.reason);
        } else if (!SENDABLE.has(channel)) {
          // No sender for this channel yet (web).
          await settle(contact.id, channel, 'NOT_ATTEMPTED', 'system', 'NO_ADDRESS');
        } else if (channel === 'push' && !(await this.hasPushAddress(tx, contact.id))) {
          // No claimed account or no live device: nothing to send to, so nothing is reserved. The
          // worker checks again at send time (a device can be revoked in between).
          await settle(contact.id, channel, 'NOT_ATTEMPTED', 'system', 'NO_ADDRESS');
        } else if (remaining.get(channel) === 0) {
          await settle(contact.id, channel, 'SPEND_CAP_REACHED', 'system', 'SPEND_CAP');
        } else {
          const left = remaining.get(channel);
          if (left !== null && left !== undefined) remaining.set(channel, left - 1);
          const attemptId = await create(contact.id, channel, true);
          await this.queue.enqueueSend(tx, attemptId);
          await this.queue.enqueueExpiry(tx, attemptId, ttlSeconds(channel));
          if (channel === 'push') await this.queue.enqueueReceipts(tx, attemptId, PUSH_RECEIPT_CHECK_SECONDS);
          planned.push({ attemptId, recipientId: contact.id, channel, outcome: 'queued' });
        }
      }
    }

    // A contact who may not be alerted is ledgered with the reason; skipped rows spend no budget.
    for (const skip of skipped) {
      for (const channel of input.channels) {
        await settle(skip.contactId, channel, 'NOT_ATTEMPTED', 'policy', SKIP_TO_REASON[skip.reason]);
      }
    }

    if (planned.some(p => p.outcome === 'capped')) {
      this.logger.warn(`daily cap reached for a plan (incident ${input.incidentId}); the user must be told`);
    }
    return planned;
  }

  plan(input: PlanInput): Promise<PlannedAttempt[]> {
    return this.prisma.$transaction(tx => this.planIn(tx, input));
  }
}
