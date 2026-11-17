import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { resolveRegion, type RegionRegistry } from '@lumo/region-profiles';
import {
  apply,
  incidentContext,
  INCIDENT_MACHINE,
  INCIDENT_TERMINAL,
  rollupIncident,
  type Actor,
  type IncidentContext,
  type IncidentEvent,
  type IncidentState,
  type Rejection,
} from '@lumo/safety-domain';
import { DispatchService, type PlannedAttempt } from '../notifications/dispatch.service';
import { LedgerService } from '../notifications/ledger.service';
import { NotificationQueue } from '../notifications/queue';
import { LocationService, validateSnapshots } from '../location/location.service';
import { PrismaService } from '../prisma/prisma.service';
import { REGION_REGISTRY } from '../regions/regions.module';

/**
 * Incidents (docs/specs/INCIDENTS.md). `apply` is the ONLY code that changes an incident's state: it
 * locks the incident row, runs the state machine, appends an event WITH its order (`seq`) and updates
 * the state, in one transaction. Lock order everywhere is incident, then user-cap, then attempt.
 */

export type Tx = Prisma.TransactionClient;
export type Caller = { readonly id: string; readonly via: 'login' | 'token' };

export const SOS_TRIGGERS = ['manual', 'shake', 'voice', 'safeword', 'crash', 'fall'] as const;
export type SosTrigger = (typeof SOS_TRIGGERS)[number];

/**
 * The countdown the SERVER will allow, whatever the client asks: a deliberate act is 0–3 s, a safeword
 * 0–10 s, and an automatic trigger a fixed 10 s. A buggy or hostile client cannot make a long one.
 */
export function clampCountdown(trigger: SosTrigger, requested: number | undefined): number {
  const asked = Number.isFinite(requested) ? Math.trunc(requested as number) : undefined;
  switch (trigger) {
    case 'manual':
      return Math.min(Math.max(asked ?? 0, 0), 3);
    case 'safeword':
      return Math.min(Math.max(asked ?? 0, 0), 10);
    default:
      return 10;
  }
}

export interface SosInput {
  readonly triggerType: SosTrigger;
  readonly triggeredAt: Date;
  readonly countdownSeconds?: number;
  readonly location?: { latitude: number; longitude: number; accuracyM: number | null; capturedAt: number } | null;
  readonly place?: { country: string; subdivision?: string | null } | null;
}

export interface IncidentView {
  readonly id: string;
  readonly state: IncidentState;
  readonly triggerType: string;
  readonly countdownEndsAt: Date | null;
  readonly locationAvailable: boolean;
  readonly outcome: string;
  /** More than one channel can reach one contact, so these are per contact. */
  readonly reached: readonly string[];
  readonly acknowledged: readonly string[];
  readonly failed: readonly string[];
  readonly pending: readonly string[];
  /** Attempts the daily cap stopped. The caller MUST tell the user. */
  readonly capped: readonly string[];
  readonly attempts: readonly {
    id: string; recipientId: string; recipientName?: string; channel: string; purpose: string; state: string; reason: string | null;
    queuedAt: Date; sentAt: Date | null; deliveredAt: Date | null; acknowledgedAt: Date | null; failedAt: Date | null;
  }[];
}

export type ApplyResult =
  | { applied: true; from: IncidentState; to: IncidentState; effects: readonly string[] }
  | { applied: false; why: 'NOT_FOUND' | Rejection; state?: IncidentState };

@Injectable()
export class IncidentService implements OnModuleInit {
  private readonly logger = new Logger('Incidents');

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchSvc: DispatchService,
    private readonly ledger: LedgerService,
    private readonly queue: NotificationQueue,
    private readonly locations: LocationService,
    @Inject(REGION_REGISTRY) private readonly regions: RegionRegistry,
  ) {}

  onModuleInit() {
    this.queue.setHandlers({ countdown: id => this.dispatch(id) });
    // After an attempt's state changes (committed), bring the incident up to date.
    this.ledger.onApplied(async (attemptId, result) => {
      const attempt = await this.prisma.notificationAttempt.findUnique({ where: { id: attemptId }, select: { incidentId: true, purpose: true } });
      if (!attempt || attempt.purpose !== 'ALERT') return;
      if (result.to === 'ACKNOWLEDGED') await this.apply(attempt.incidentId, 'ACK_RECEIVED', 'contact', 'CONTACT_RESPONDING');
      await this.recompute(attempt.incidentId);
    });
  }

  // ---------------------------------------------------------------- the one writer

  async apply(incidentId: string, event: IncidentEvent, by: Actor, reason: string | null = null, ctx: Partial<IncidentContext> = {}, now: Date = new Date(), tx?: Tx): Promise<ApplyResult> {
    if (!tx) return this.prisma.$transaction(t => this.apply(incidentId, event, by, reason, ctx, now, t));

    const rows = await tx.$queryRaw<{ state: IncidentState; priorState: IncidentState | null }[]>`
      SELECT "state", "priorState" FROM "EmergencyIncident" WHERE "id" = ${incidentId} FOR UPDATE`;
    if (rows.length === 0) return { applied: false, why: 'NOT_FOUND' };

    const out = apply(INCIDENT_MACHINE, { state: rows[0].state, priorState: rows[0].priorState }, event, { at: now.getTime(), by, reason }, incidentContext(ctx));
    if (!out.ok) return { applied: false, why: out.rejection, state: rows[0].state };

    const to = out.snapshot.state;
    await tx.incidentEvent.create({ data: { incidentId, fromState: out.record.from, toState: to, event, actor: by, reason, occurredAt: now } });
    await tx.emergencyIncident.update({
      where: { id: incidentId },
      data: {
        state: to,
        priorState: out.snapshot.priorState,
        ...(to === 'NOTIFYING' || (to === 'ALL_CHANNELS_FAILED' && rows[0].state === 'DISPATCHING') ? { dispatchedAt: now } : {}),
        ...(to === 'ACKNOWLEDGED' ? { acknowledgedAt: now } : {}),
        ...(to === 'RESOLVING' ? { resolvedAt: now } : {}),
        ...(to === 'CLOSED' ? { closedAt: now } : {}),
      },
    });
    return { applied: true, from: out.record.from, to, effects: out.record.effects };
  }

  // ------------------------------------------------------------------- raising one

  /** Build the region id from what the device reports — never a client string stored as is. */
  regionFor(input: SosInput, accountCountry: string | null, now: Date): string {
    const place = input.place;
    const resolution = resolveRegion(
      {
        now: now.getTime(),
        fix: place && input.location && input.location.accuracyM !== null
          ? { country: place.country, subdivision: place.subdivision ?? null, capturedAt: input.location.capturedAt, accuracyM: input.location.accuracyM }
          : null,
        accountCountry,
      },
      this.regions.profiles,
    );
    return resolution.profile?.id ?? 'UNRESOLVED';
  }

  /** Create (or replay) an incident. A replay by the same user returns the existing one and never re-plans. */
  async raise(caller: Caller, key: string, input: SosInput, now: Date = new Date()): Promise<{ replay: boolean; incident: IncidentView }> {
    // Dispatch needs the queue. Refuse LOUDLY rather than record an alert that can never be sent.
    if (!this.queue.running) throw new ServiceUnavailableException('Alerts cannot be sent right now. Call your local emergency number.');

    const existing = await this.prisma.emergencyIncident.findUnique({ where: { idempotencyKey: key }, select: { id: true, userId: true } });
    if (existing) return this.replay(caller, existing);

    const user = await this.prisma.user.findUnique({ where: { id: caller.id }, select: { regionProfileId: true } });
    const seconds = clampCountdown(input.triggerType, input.countdownSeconds);
    const countdownEndsAt = seconds > 0 ? new Date(now.getTime() + seconds * 1000) : null;

    let incidentId: string;
    try {
      incidentId = await this.prisma.$transaction(async tx => {
        const created = await tx.emergencyIncident.create({
          data: {
            userId: caller.id, idempotencyKey: key, triggerType: input.triggerType, triggeredAt: input.triggeredAt,
            countdownEndsAt, regionProfileId: this.regionFor(input, user?.regionProfileId ?? null, now), mode: 'real', isDuress: false,
          },
        });
        await tx.incidentEvent.create({ data: { incidentId: created.id, fromState: null, toState: 'CREATED', event: 'CREATED', actor: 'user', reason: input.triggerType, occurredAt: now } });
        if (seconds > 0) await this.queue.enqueueCountdown(tx, created.id, seconds);
        return created.id;
      });
    } catch (e) {
      // Two requests with one key at once: the unique key let one through. The other returns it, without planning.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const won = await this.prisma.emergencyIncident.findUnique({ where: { idempotencyKey: key }, select: { id: true, userId: true } });
        if (won) return this.replay(caller, won);
      }
      throw e;
    }

    // A fix is attached if it is a usable one. A bad fix NEVER blocks an SOS: it is dropped, and the message says so.
    if (input.location && validateSnapshots([{ ...input.location, source: 'gps' }], now.getTime()).length === 0) {
      try {
        await this.locations.recordForIncident(caller.id, incidentId, [{ ...input.location, source: 'gps' }], now.getTime());
        await this.prisma.emergencyIncident.update({ where: { id: incidentId }, data: { locationAvailable: true } });
      } catch {
        this.ledger.counters.set('incident.location_dropped', (this.ledger.counters.get('incident.location_dropped') ?? 0) + 1);
      }
    }

    if (seconds === 0) await this.dispatch(incidentId, now);
    return { replay: false, incident: await this.view(caller, incidentId) };
  }

  private async replay(caller: Caller, existing: { id: string; userId: string }) {
    // A key another user already used: no data, no hint of whose it is.
    if (existing.userId !== caller.id) throw new ConflictException('That Idempotency-Key cannot be used.');
    return { replay: true as const, incident: await this.view(caller, existing.id) };
  }

  // ------------------------------------------------------------------- dispatching

  /**
   * Take an incident from CREATED through to its attempts, in ONE transaction under the incident lock, so a
   * cancel cannot interleave. Safe to call twice: it does nothing unless the incident is still CREATED.
   * Nothing here waits on a fix, the queue, AI or evidence.
   */
  async dispatch(incidentId: string, now: Date = new Date()): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const inc = await tx.emergencyIncident.findUnique({ where: { id: incidentId } });
      if (!inc || inc.state !== 'CREATED') return;

      const manualNow = inc.countdownEndsAt === null;
      const first = manualNow
        ? await this.apply(incidentId, 'COUNTDOWN_SKIPPED', 'user', 'NO_COUNTDOWN', { manualOrSafeword: true }, now, tx)
        : await this.apply(incidentId, 'COUNTDOWN_ELAPSED', 'system', 'DEADLINE_PASSED', {}, now, tx);
      if (!first.applied) return; // cancelled, or already taken

      await this.apply(incidentId, inc.locationAvailable ? 'LOCATION_ACQUIRED' : 'LOCATION_TIMEOUT', 'system', inc.locationAvailable ? null : 'NO_FIX_PROVIDED', {}, now, tx);

      // The user's own settings decide the channels. SMS is opt-in (default off); push goes to contacts who claimed their invite.
      const user = await tx.user.findUniqueOrThrow({ where: { id: inc.userId }, select: { sendSmsOnSos: true } });
      const channels = user.sendSmsOnSos ? (['push', 'sms'] as const) : (['push'] as const);
      const planned = await this.dispatchSvc.planIn(tx, { incidentId, userId: inc.userId, channels, now });

      // A contact who may not be alerted at all (no consent) is not a recipient; every other contact is.
      const recipients = new Set(planned.filter(p => !p.reason?.startsWith('CONSENT_')).map(p => p.recipientId));
      if (recipients.size > 0) {
        await this.apply(incidentId, 'RECIPIENTS_RESOLVED', 'system', null, { consentedRecipients: recipients.size }, now, tx);
        await this.recompute(incidentId, now, tx);
      } else {
        await this.apply(incidentId, 'NO_RECIPIENTS', 'system', 'NO_CONSENTED_CONTACT', { consentedRecipients: 0 }, now, tx);
      }
    });
  }

  /**
   * Bring an incident's state in line with its attempts. Idempotent, and run under the incident lock. It emits ONLY
   * "everything has settled"; it NEVER emits an acknowledgement (an attempt stays ACKNOWLEDGED for good, so deriving
   * it would re-acknowledge the incident after an unack). With no escalation engine yet (1.9) nothing more is coming
   * after the single plan, so no step remains.
   */
  async recompute(incidentId: string, now: Date = new Date(), tx?: Tx): Promise<void> {
    if (!tx) return void (await this.prisma.$transaction(t => this.recompute(incidentId, now, t)));
    const locked = await tx.$queryRaw<{ state: IncidentState }[]>`SELECT "state" FROM "EmergencyIncident" WHERE "id" = ${incidentId} FOR UPDATE`;
    if (locked[0]?.state !== 'NOTIFYING') return;

    const attempts = await tx.notificationAttempt.findMany({ where: { incidentId, purpose: 'ALERT' }, select: { recipientId: true, channel: true, state: true } });
    const r = rollupIncident(attempts);
    if (r.pending.length > 0) return; // still in flight
    await this.apply(incidentId, 'ALL_SETTLED', 'system', null, {
      pending: 0, reached: r.reached.length + r.acknowledged.length, failed: r.failed.length, moreStepsRemain: false,
    }, now, tx);
  }

  // ------------------------------------------------------- the person's actions

  private async owned(caller: Caller, id: string) {
    const inc = await this.prisma.emergencyIncident.findFirst({ where: { id, userId: caller.id } });
    if (!inc) throw new NotFoundException(); // someone else's is not found, never forbidden
    return inc;
  }

  async cancel(caller: Caller, id: string, now: Date = new Date()): Promise<IncidentView> {
    const inc = await this.owned(caller, id);
    const withinCountdown = inc.state === 'CREATED' && inc.countdownEndsAt !== null && now < inc.countdownEndsAt;
    const out = await this.apply(id, 'CANCEL', 'user', 'USER_CANCELLED', { withinCountdown }, now);
    if (!out.applied && (out as { state?: IncidentState }).state !== 'CANCELLED') {
      throw new ConflictException('It is too late to cancel: the alert has gone out. Resolve it instead.');
    }
    return this.view(caller, id);
  }

  async resolve(caller: Caller, id: string, now: Date = new Date()): Promise<IncidentView> {
    const inc = await this.owned(caller, id);
    if (inc.state === 'RESOLVING' || inc.state === 'CLOSED') return this.view(caller, id); // idempotent
    await this.prisma.$transaction(async tx => {
      const out = await this.apply(id, 'RESOLVE', 'user', 'USER_RESOLVED', {}, now, tx);
      if (!out.applied) throw new ConflictException('This incident cannot be resolved from where it is.');
      // Contacts whose alert went are told it ended. The incident then closes; those messages are ledgered under RESOLVED.
      await this.dispatchSvc.planResolutionIn(tx, id, now);
      await this.apply(id, 'CLOSE', 'system', 'RESOLUTION_QUEUED', {}, now, tx);
    });
    return this.view(caller, id);
  }

  // ---------------------------------------------------- the contact's actions

  /** The contact record for `userId` among the incident's owner's contacts, if they are a live, consenting, linked contact. */
  private async linkedContact(userId: string, incidentId: string) {
    const inc = await this.prisma.emergencyIncident.findUnique({ where: { id: incidentId }, select: { userId: true, state: true } });
    if (!inc) return null;
    const contact = await this.prisma.trustedContact.findFirst({
      where: { userId: inc.userId, linkedUserId: userId, removedAt: null, consent: { is: { revokedAt: null } } },
      select: { id: true },
    });
    return contact ? { contactId: contact.id, incidentState: inc.state } : null;
  }

  /** "I'm responding" from a linked contact's account. The same 404 for everything that is not theirs. */
  async acknowledge(userId: string, incidentId: string, now: Date = new Date()): Promise<{ recorded: boolean }> {
    const c = await this.linkedContact(userId, incidentId);
    if (!c) throw new NotFoundException();
    const out = await this.apply(incidentId, 'ACK_RECEIVED', 'contact', 'CONTACT_RESPONDING', {}, now);
    return { recorded: out.applied };
  }

  /** "I can't help after all": back to the state before the acknowledgement, so the user is not stranded. */
  async unacknowledge(userId: string, incidentId: string, now: Date = new Date()): Promise<{ recorded: boolean }> {
    const c = await this.linkedContact(userId, incidentId);
    if (!c) throw new NotFoundException();
    const out = await this.apply(incidentId, 'UNACK_RECEIVED', 'contact', 'CONTACT_CANNOT_HELP', {}, now);
    if (out.applied) await this.recompute(incidentId, now);
    return { recorded: out.applied };
  }

  // -------------------------------------------------------------------- reading

  async view(caller: Caller, id: string): Promise<IncidentView> {
    const inc = await this.owned(caller, id);
    const attempts = await this.prisma.notificationAttempt.findMany({ where: { incidentId: id }, orderBy: { queuedAt: 'asc' } });
    const roll = rollupIncident(attempts.filter(a => a.purpose === 'ALERT').map(a => ({ recipientId: a.recipientId, channel: a.channel, state: a.state })));

    // Names only for a login. An emergency token reads ids and states, nothing else.
    const names = new Map<string, string>();
    if (caller.via === 'login') {
      const contacts = await this.prisma.trustedContact.findMany({ where: { id: { in: [...new Set(attempts.map(a => a.recipientId))] } }, select: { id: true, name: true } });
      for (const c of contacts) names.set(c.id, c.name);
    }
    return {
      id: inc.id, state: inc.state, triggerType: inc.triggerType, countdownEndsAt: inc.countdownEndsAt, locationAvailable: inc.locationAvailable,
      outcome: INCIDENT_TERMINAL.includes(inc.state) ? inc.state : roll.outcome,
      reached: roll.reached, acknowledged: roll.acknowledged, failed: roll.failed, pending: roll.pending,
      capped: [...new Set(attempts.filter(a => a.stateReason === 'SPEND_CAP').map(a => a.recipientId))],
      attempts: attempts.map(a => ({
        id: a.id, recipientId: a.recipientId, ...(names.has(a.recipientId) ? { recipientName: names.get(a.recipientId) } : {}),
        channel: a.channel, purpose: a.purpose, state: a.state, reason: a.stateReason,
        queuedAt: a.queuedAt, sentAt: a.sentAt, deliveredAt: a.deliveredAt, acknowledgedAt: a.acknowledgedAt, failedAt: a.failedAt,
      })),
    };
  }
}
