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

export const SKIP_TO_REASON: Record<SkipReason, string> = {
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

  /**
   * Plan ONE recipient inside the caller's transaction: an attempt per channel, each queued, gated by region, checked for an
   * address, and counted against the daily cap, or settled at once as "never attempted" with the reason. A recipient who may
   * not be alerted at all (`skipReason`) is ledgered the same way, spending no budget.
   *
   * The cap is read and spent under a per-user advisory lock, so two concurrent plans cannot both read the same budget.
   * The step it belongs to is recorded on the attempt (`escalationStep`), which is how the ladder knows whether a step failed.
   */
  async planRecipientIn(
    tx: Tx,
    input: { incidentId: string; userId: string; recipientId: string; channels: readonly Channel[]; stepOrder: number; skipReason?: string; now?: Date },
  ): Promise<PlannedAttempt[]> {
    const now = input.now ?? new Date();
    const incident = await tx.emergencyIncident.findUniqueOrThrow({ where: { id: input.incidentId }, select: { userId: true, regionProfileId: true } });
    if (incident.userId !== input.userId) throw new Error('The incident does not belong to this user.');

    // Region of the INCIDENT (where the device was), not of the account.
    const profile = this.regions.profileFor(incident.regionProfileId);
    if (!profile) this.ledger.counters.set('plan.no_region_profile', (this.ledger.counters.get('plan.no_region_profile') ?? 0) + 1);

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lumo.cap:${input.userId}`}))`;
    const planned: PlannedAttempt[] = [];
    const create = async (channel: Channel, reserved: boolean) => {
      const attempt = await tx.notificationAttempt.create({
        data: { incidentId: input.incidentId, recipientId: input.recipientId, channel, escalationStep: input.stepOrder, queuedAt: now, reservedAt: reserved ? now : null },
      });
      await tx.notificationEvent.create({ data: { attemptId: attempt.id, toState: 'QUEUED', reason: 'PLANNED', occurredAt: now } });
      return attempt.id;
    };
    const settle = async (channel: Channel, event: 'NOT_ATTEMPTED' | 'SPEND_CAP_REACHED', by: 'system' | 'policy', reason: string) => {
      const attemptId = await create(channel, false);
      await this.ledger.apply(attemptId, [{ event, by, reason }], now, tx);
      planned.push({ attemptId, recipientId: input.recipientId, channel, outcome: event === 'SPEND_CAP_REACHED' ? 'capped' : 'not_attempted', reason });
    };

    for (const channel of input.channels) {
      if (input.skipReason) { await settle(channel, 'NOT_ATTEMPTED', 'policy', input.skipReason); continue; }
      const gate = profile ? channelGate(profile, channel) : ({ allowed: true } as const);
      if (!gate.allowed) { await settle(channel, 'NOT_ATTEMPTED', 'policy', gate.reason); continue; }
      if (!SENDABLE.has(channel)) { await settle(channel, 'NOT_ATTEMPTED', 'system', 'NO_ADDRESS'); continue; } // no sender for this channel yet (web)
      // No claimed account or no live device: nothing to send to, so nothing is reserved. The worker checks again at send time.
      if (channel === 'push' && !(await this.hasPushAddress(tx, input.recipientId))) { await settle(channel, 'NOT_ATTEMPTED', 'system', 'NO_ADDRESS'); continue; }

      const cap = this.capFor(profile, channel);
      if (cap !== null) {
        const used = await tx.notificationAttempt.count({ where: { channel, reservedAt: { gt: new Date(now.getTime() - DAY_MS) }, incident: { userId: input.userId } } });
        if (used >= cap) { await settle(channel, 'SPEND_CAP_REACHED', 'system', 'SPEND_CAP'); continue; }
      }
      const attemptId = await create(channel, true);
      await this.queue.enqueueSend(tx, attemptId);
      await this.queue.enqueueExpiry(tx, attemptId, ttlSeconds(channel));
      if (channel === 'push') await this.queue.enqueueReceipts(tx, attemptId, PUSH_RECEIPT_CHECK_SECONDS);
      planned.push({ attemptId, recipientId: input.recipientId, channel, outcome: 'queued' });
    }
    if (planned.some(p => p.outcome === 'capped')) this.logger.warn(`daily cap reached for a plan (incident ${input.incidentId}); the user must be told`);
    return planned;
  }

  /** Plan every contact at once, in priority order (no ladder). The ladder uses planRecipientIn one step at a time. */
  async planIn(tx: Tx, input: PlanInput): Promise<PlannedAttempt[]> {
    const now = input.now ?? new Date();
    const { eligible, skipped } = resolveRecipients(await this.contacts.list(tx, input.userId));
    const planned: PlannedAttempt[] = [];
    for (const contact of eligible) {
      planned.push(...(await this.planRecipientIn(tx, { incidentId: input.incidentId, userId: input.userId, recipientId: contact.id, channels: input.channels, stepOrder: 0, now })));
    }
    for (const skip of skipped) {
      planned.push(...(await this.planRecipientIn(tx, { incidentId: input.incidentId, userId: input.userId, recipientId: skip.contactId, channels: input.channels, stepOrder: 0, skipReason: SKIP_TO_REASON[skip.reason], now })));
    }
    return planned;
  }

  /**
   * Tell contacts an incident ENDED (docs/specs/INCIDENTS.md): one RESOLVED attempt for each contact
   * whose alert actually went, on the channel it went by. A contact who was never alerted is not told.
   * Exempt from the daily cap — it is bounded by the alerts already sent, and leaving contacts in the dark is
   * its own harm — and it never counts in the incident's rollup (purpose RESOLVED).
   */
  async planResolutionIn(tx: Tx, incidentId: string, now: Date = new Date()): Promise<PlannedAttempt[]> {
    const went = await tx.notificationAttempt.findMany({
      where: { incidentId, purpose: 'ALERT', state: { in: ['SENT', 'DELIVERED', 'ACKNOWLEDGED', 'UNKNOWN'] } },
      orderBy: { queuedAt: 'asc' },
    });
    const best = new Map<string, Channel>();
    for (const a of went) if (!best.has(a.recipientId) && (a.channel === 'sms' || a.channel === 'push')) best.set(a.recipientId, a.channel);

    const planned: PlannedAttempt[] = [];
    for (const [recipientId, channel] of best) {
      const attempt = await tx.notificationAttempt.create({
        data: { incidentId, recipientId, channel, purpose: 'RESOLVED', escalationStep: 0, queuedAt: now },
      });
      await tx.notificationEvent.create({ data: { attemptId: attempt.id, toState: 'QUEUED', reason: 'PLANNED', occurredAt: now } });
      await this.queue.enqueueSend(tx, attempt.id);
      await this.queue.enqueueExpiry(tx, attempt.id, ttlSeconds(channel));
      planned.push({ attemptId: attempt.id, recipientId, channel, outcome: 'queued' });
    }
    return planned;
  }

  plan(input: PlanInput): Promise<PlannedAttempt[]> {
    return this.prisma.$transaction(tx => this.planIn(tx, input));
  }
}
