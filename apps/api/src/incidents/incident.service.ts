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
import { EscalationService } from '../escalation/escalation.service';
import { DispatchService } from '../notifications/dispatch.service';
import { LedgerService } from '../notifications/ledger.service';
import { NotificationQueue } from '../notifications/queue';
import { LocationService, validateSnapshots } from '../location/location.service';
import { PrismaService } from '../prisma/prisma.service';
import { REGION_REGISTRY } from '../regions/regions.module';
import { PracticeService } from './practice.service';

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

/**
 * The longest ago a press may have been and still be sent (docs/specs/OFFLINE_SOS.md). Same window as resuming a shown SOS. Beyond it the
 * request is refused and NOTHING is sent: an alert that old is more likely stale than urgent, and the contact cannot tell.
 */
export const MAX_LATE_SOS_SECONDS = 6 * 60 * 60;

export interface SosInput {
  readonly triggerType: SosTrigger;
  readonly triggeredAt: Date;
  readonly countdownSeconds?: number;
  /**
   * How long ago the person pressed, measured ON THE DEVICE (docs/specs/OFFLINE_SOS.md). The server derives the press time from its own
   * clock minus this, so a wrong phone clock cannot make a late alert read as on time, or the reverse. Absent: the press is now.
   */
  readonly elapsedSeconds?: number;
  readonly location?: { latitude: number; longitude: number; accuracyM: number | null; capturedAt: number } | null;
  readonly place?: { country: string; subdivision?: string | null } | null;
  /** The journey this SOS belongs to, if any. Honoured only if it is the caller's own, live journey. */
  readonly sessionId?: string | null;
  /** `practice` rehearses the whole path and contacts nobody (docs/specs/PRACTICE_MODE.md). Default `real`. */
  readonly mode?: 'real' | 'practice';
}

/** What a journey needs to hear about its incidents. Registered by the session service. */
export interface SessionHooks {
  /** An SOS was raised during the journey. */
  sosRaised(sessionId: string, incidentId: string, now: Date): Promise<void>;
  /** The incident that a journey raised (or was linked to) has been resolved. */
  incidentResolved(sessionId: string, now: Date): Promise<void>;
}

export interface IncidentView {
  readonly id: string;
  readonly state: IncidentState;
  /** `practice`: a rehearsal. Nothing was sent, and every attempt below is simulated. */
  readonly mode: 'real' | 'practice';
  readonly triggerType: string;
  readonly countdownEndsAt: Date | null;
  /** Seconds between when the alert should have gone and when the server got it. 0 for an ordinary SOS. */
  readonly lateBySeconds: number;
  readonly locationAvailable: boolean;
  readonly outcome: string;
  /** The ladder: which step is in flight, of how many, and when it gives way to the next. */
  readonly escalation: { phase: string; stepOrder: number | null; steps: number; nextStepAt: number | null } | null;
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
    /** True for every row of a practice run. */
    simulated: boolean;
  }[];
}

export type ApplyResult =
  | { applied: true; from: IncidentState; to: IncidentState; effects: readonly string[] }
  | { applied: false; why: 'NOT_FOUND' | Rejection; state?: IncidentState };

@Injectable()
export class IncidentService implements OnModuleInit {
  private readonly logger = new Logger('Incidents');
  private sessionHooks: SessionHooks | null = null;

  setSessionHooks(h: SessionHooks) {
    this.sessionHooks = h;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchSvc: DispatchService,
    private readonly escalation: EscalationService,
    private readonly ledger: LedgerService,
    private readonly queue: NotificationQueue,
    private readonly locations: LocationService,
    private readonly practice: PracticeService,
    @Inject(REGION_REGISTRY) private readonly regions: RegionRegistry,
  ) {}

  onModuleInit() {
    this.queue.setHandlers({ countdown: id => this.dispatch(id), step: (id, order) => this.escalation.timeout(id, order) });
    // After the ladder moves on its own (a step's timer), bring the incident up to date.
    this.escalation.onAdvanced((id, now) => this.recompute(id, now));
    // After an attempt's state changes (committed), bring the incident up to date.
    this.ledger.onApplied(async (attemptId, result) => {
      const attempt = await this.prisma.notificationAttempt.findUnique({ where: { id: attemptId }, select: { incidentId: true, purpose: true } });
      if (!attempt || attempt.purpose !== 'ALERT') return;
      if (result.to === 'ACKNOWLEDGED') await this.apply(attempt.incidentId, 'ACK_RECEIVED', 'contact', 'CONTACT_RESPONDING');
      // Nobody reached in the step in flight: move on to the next person now, not after the timeout.
      if (result.to === 'FAILED' || result.to === 'EXPIRED') await this.escalation.stepMayHaveFailed(attempt.incidentId);
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
    // The machine DECLARES these effects; the ladder is what carries them out, in this same transaction.
    if (event === 'ACK_RECEIVED') await this.escalation.halt(tx, incidentId, now);
    else if (event === 'RESOLVE') await this.escalation.stop(tx, incidentId);
    else if (event === 'UNACK_RECEIVED') await this.escalation.resume(tx, incidentId, now);
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
    const practice = input.mode === 'practice';
    const seconds = clampCountdown(input.triggerType, input.countdownSeconds);
    const elapsed = Math.max(0, Math.trunc(input.elapsedSeconds ?? 0));
    if (elapsed > MAX_LATE_SOS_SECONDS) {
      // Said plainly, and nothing was sent: the device shows it and offers the dialler.
      throw new BadRequestException({ message: 'This was triggered too long ago to alert your contacts. Nothing was sent. Call your local emergency number.', tooLate: true });
    }
    // A rehearsal sends nothing, so it needs the queue only for a countdown. A real alert needs it always.
    if (!this.queue.running && (!practice || seconds > 0)) throw new ServiceUnavailableException(practice ? 'Practice cannot run right now.' : 'Alerts cannot be sent right now. Call your local emergency number.');

    const existing = await this.prisma.emergencyIncident.findUnique({ where: { idempotencyKey: key }, select: { id: true, userId: true } });
    if (existing) return this.replay(caller, existing);

    const user = await this.prisma.user.findUnique({ where: { id: caller.id }, select: { regionProfileId: true } });
    // A journey link is honoured only for the caller's own live journey; anything else is ignored, never an error: an SOS must not fail over it.
    const linked = input.sessionId && !practice
      ? await this.prisma.safetySession.findFirst({ where: { id: input.sessionId, userId: caller.id, state: { notIn: ['CLOSED', 'CANCELLED', 'EXPIRED'] } }, select: { id: true } })
      : null;
    // The press, by the SERVER's clock minus the device's elapsed time. Its countdown is measured from the press, so a request that arrives
    // late finds the deadline already passed and dispatches at once ("a late alert beats no alert"), saying how late it is.
    const pressedAt = input.elapsedSeconds !== undefined ? new Date(now.getTime() - elapsed * 1000) : input.triggeredAt;
    const countdownEndsAt = seconds > 0 ? new Date(pressedAt.getTime() + seconds * 1000) : null;
    const deadlinePassed = countdownEndsAt !== null && countdownEndsAt.getTime() <= now.getTime();
    const lateBySeconds = input.elapsedSeconds !== undefined ? Math.max(0, elapsed - seconds) : 0;

    let incidentId: string;
    try {
      incidentId = await this.prisma.$transaction(async tx => {
        const created = await tx.emergencyIncident.create({
          data: {
            userId: caller.id, idempotencyKey: key, triggerType: input.triggerType, triggeredAt: pressedAt,
            countdownEndsAt, lateBySeconds, regionProfileId: this.regionFor(input, user?.regionProfileId ?? null, now), mode: practice ? 'practice' : 'real', isDuress: false,
            ...(linked ? { sessionId: linked.id } : {}),
          },
        });
        await tx.incidentEvent.create({ data: { incidentId: created.id, fromState: null, toState: 'CREATED', event: 'CREATED', actor: 'user', reason: input.triggerType, occurredAt: now } });
        if (seconds > 0 && !deadlinePassed) await this.queue.enqueueCountdown(tx, created.id, Math.max(1, Math.ceil((countdownEndsAt!.getTime() - now.getTime()) / 1000)));
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
    const usableFix = input.location && validateSnapshots([{ ...input.location, source: 'gps' }], now.getTime()).length === 0;
    if (usableFix && practice) {
      // A rehearsal exercises "a position was available" without keeping where the person was.
      await this.prisma.emergencyIncident.update({ where: { id: incidentId }, data: { locationAvailable: true } });
    } else if (input.location && usableFix) {
      try {
        await this.locations.recordForIncident(caller.id, incidentId, [{ ...input.location, source: 'gps' }], now.getTime());
        await this.prisma.emergencyIncident.update({ where: { id: incidentId }, data: { locationAvailable: true } });
      } catch {
        this.ledger.counters.set('incident.location_dropped', (this.ledger.counters.get('incident.location_dropped') ?? 0) + 1);
      }
    }

    if (seconds === 0 || deadlinePassed) await this.dispatch(incidentId, now);
    if (linked) await this.sessionHooks?.sosRaised(linked.id, incidentId, now).catch(() => undefined);
    return { replay: false, incident: await this.view(caller, incidentId) };
  }

  /**
   * A journey's missed check-in becomes an incident (docs/specs/JOURNEY_GUARDIAN.md). Not a person pressing anything: the
   * grace has run out. Idempotent on `key` (the journey and its due time), so a retried job cannot raise two. The latest position
   * the journey knows is attached, with its own age and accuracy.
   */
  async raiseForSession(userId: string, sessionId: string, key: string, now: Date): Promise<string> {
    const existing = await this.prisma.emergencyIncident.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
    if (existing) return existing.id;
    if (!this.queue.running) throw new ServiceUnavailableException('Alerts cannot be sent right now.');

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { regionProfileId: true } });
    const last = await this.prisma.locationSnapshot.findFirst({ where: { sessionId }, orderBy: { capturedAt: 'desc' } });
    let incidentId: string;
    try {
      incidentId = await this.prisma.$transaction(async tx => {
        const created = await tx.emergencyIncident.create({
          data: {
            userId, sessionId, idempotencyKey: key, triggerType: 'missed_check_in', triggeredAt: now, countdownEndsAt: null,
            regionProfileId: user?.regionProfileId && this.regions.profileFor(user.regionProfileId) ? user.regionProfileId : 'UNRESOLVED',
            mode: 'real', isDuress: false, locationAvailable: last !== null,
          },
        });
        await tx.incidentEvent.create({ data: { incidentId: created.id, fromState: null, toState: 'CREATED', event: 'CREATED', actor: 'system', reason: 'missed_check_in', occurredAt: now } });
        if (last) {
          await tx.locationSnapshot.create({
            data: { incidentId: created.id, latitude: last.latitude, longitude: last.longitude, accuracyM: last.accuracyM, capturedAt: last.capturedAt, batteryPct: last.batteryPct, source: last.source, expiresAt: last.expiresAt },
          });
        }
        return created.id;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const won = await this.prisma.emergencyIncident.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
        if (won) return won.id;
      }
      throw e;
    }
    await this.dispatch(incidentId, now);
    return incidentId;
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
      const practice = inc.mode === 'practice';

      const manualNow = inc.countdownEndsAt === null;
      // A missed check-in is the SYSTEM's doing (the person's grace has run out): the timeline must not say the user pressed anything.
      const first = manualNow && inc.triggerType === 'missed_check_in'
        ? await this.apply(incidentId, 'COUNTDOWN_ELAPSED', 'system', 'GRACE_EXPIRED', {}, now, tx)
        : manualNow
        ? await this.apply(incidentId, 'COUNTDOWN_SKIPPED', 'user', 'NO_COUNTDOWN', { manualOrSafeword: true }, now, tx)
        : await this.apply(incidentId, 'COUNTDOWN_ELAPSED', 'system', 'DEADLINE_PASSED', {}, now, tx);
      if (!first.applied) return; // cancelled, or already taken

      await this.apply(incidentId, inc.locationAvailable ? 'LOCATION_ACQUIRED' : 'LOCATION_TIMEOUT', 'system', inc.locationAvailable ? null : 'NO_FIX_PROVIDED', {}, now, tx);

      // The ladder decides who, in what order, over which channels (the user's own settings bound the channels: SMS is
      // opt-in, default off; push goes to contacts who claimed their invite). A contact who may not be alerted at all is
      // ledgered with the reason and does not count as a recipient.
      // A rehearsal resolves who it WOULD try and writes a simulated ledger. It never reaches the ladder, the planner or the queue.
      if (practice) {
        const sim = await this.practice.run(tx, incidentId, inc.userId, now);
        if (sim.dispatched > 0) {
          await this.apply(incidentId, 'RECIPIENTS_RESOLVED', 'system', null, { consentedRecipients: sim.dispatched }, now, tx);
          await this.apply(incidentId, 'ALL_SETTLED', 'system', null, { pending: 0, reached: sim.reached, failed: sim.failed, moreStepsRemain: false }, now, tx);
        } else {
          await this.apply(incidentId, 'NO_RECIPIENTS', 'system', 'NO_CONSENTED_CONTACT', { consentedRecipients: 0 }, now, tx);
        }
        return;
      }
      const { dispatched } = await this.escalation.start(tx, incidentId, now);
      if (dispatched > 0) {
        await this.apply(incidentId, 'RECIPIENTS_RESOLVED', 'system', null, { consentedRecipients: dispatched }, now, tx);
        await this.recompute(incidentId, now, tx);
      } else {
        await this.apply(incidentId, 'NO_RECIPIENTS', 'system', 'NO_CONSENTED_CONTACT', { consentedRecipients: 0 }, now, tx);
      }
    });
  }

  /**
   * Bring an incident's state in line with its attempts. Idempotent, and run under the incident lock. It emits ONLY
   * "everything has settled"; it NEVER emits an acknowledgement (an attempt stays ACKNOWLEDGED for good, so deriving
   * it would re-acknowledge the incident after an unack). Whether another step remains comes from the ladder.
   */
  async recompute(incidentId: string, now: Date = new Date(), tx?: Tx): Promise<void> {
    if (!tx) return void (await this.prisma.$transaction(t => this.recompute(incidentId, now, t)));
    const locked = await tx.$queryRaw<{ state: IncidentState }[]>`SELECT "state" FROM "EmergencyIncident" WHERE "id" = ${incidentId} FOR UPDATE`;
    if (locked[0]?.state !== 'NOTIFYING') return;

    const attempts = await tx.notificationAttempt.findMany({ where: { incidentId, purpose: 'ALERT' }, select: { recipientId: true, channel: true, state: true } });
    const r = rollupIncident(attempts);
    if (r.pending.length > 0) return; // still in flight

    // More to come only while the ladder is running and another step follows the one in flight.
    const inc = await tx.emergencyIncident.findUniqueOrThrow({ where: { id: incidentId }, select: { ladder: true, policySnapshot: true } });
    const ladder = inc.ladder as unknown as { phase: string; stepIndex: number } | null;
    const policy = inc.policySnapshot as unknown as { steps: unknown[] } | null;
    const moreStepsRemain = Boolean(ladder && policy && ladder.phase === 'RUNNING' && ladder.stepIndex < policy.steps.length - 1);

    await this.apply(incidentId, 'ALL_SETTLED', 'system', null, {
      pending: 0, reached: r.reached.length + r.acknowledged.length, failed: r.failed.length, moreStepsRemain,
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
      // A rehearsal tells nobody it ended: nobody was told it began.
      if (inc.mode === 'real') await this.dispatchSvc.planResolutionIn(tx, id, now);
      await this.apply(id, 'CLOSE', 'system', 'RESOLUTION_QUEUED', {}, now, tx);
    });
    if (inc.sessionId) await this.sessionHooks?.incidentResolved(inc.sessionId, now).catch(() => undefined);
    return this.view(caller, id);
  }

  // ---------------------------------------------------- the contact's actions

  /** The contact record for `userId` among the incident's owner's contacts, if they are a live, consenting, linked contact. */
  private async linkedContact(userId: string, incidentId: string) {
    const inc = await this.prisma.emergencyIncident.findUnique({ where: { id: incidentId }, select: { userId: true, state: true, mode: true } });
    if (!inc || inc.mode !== 'real') return null; // a contact has no part in a rehearsal, and cannot even see that one exists
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
    // A rehearsal's ledger is its own table, and every row says it is simulated. A real incident's is the delivery ledger.
    const attempts = inc.mode === 'practice'
      ? (await this.prisma.practiceAttempt.findMany({ where: { incidentId: id }, orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }] })).map(a => ({
          id: a.id, recipientId: a.recipientId, channel: a.channel, purpose: 'ALERT', state: a.state, stateReason: a.reason,
          queuedAt: a.queuedAt, sentAt: a.sentAt, deliveredAt: a.deliveredAt, acknowledgedAt: null as Date | null, failedAt: a.failedAt, simulated: true,
        }))
      : (await this.prisma.notificationAttempt.findMany({ where: { incidentId: id }, orderBy: { queuedAt: 'asc' } })).map(a => ({ ...a, simulated: false }));
    const roll = rollupIncident(attempts.filter(a => a.purpose === 'ALERT').map(a => ({ recipientId: a.recipientId, channel: a.channel, state: a.state })));

    // Names only for a login. An emergency token reads ids and states, nothing else.
    const names = new Map<string, string>();
    if (caller.via === 'login') {
      const contacts = await this.prisma.trustedContact.findMany({ where: { id: { in: [...new Set(attempts.map(a => a.recipientId))] } }, select: { id: true, name: true } });
      for (const c of contacts) names.set(c.id, c.name);
    }
    return {
      id: inc.id, state: inc.state, mode: inc.mode, triggerType: inc.triggerType, countdownEndsAt: inc.countdownEndsAt, lateBySeconds: inc.lateBySeconds, locationAvailable: inc.locationAvailable,
      outcome: INCIDENT_TERMINAL.includes(inc.state) ? inc.state : roll.outcome,
      escalation: EscalationService.view(inc.ladder, inc.policySnapshot),
      reached: roll.reached, acknowledged: roll.acknowledged, failed: roll.failed, pending: roll.pending,
      capped: [...new Set(attempts.filter(a => a.stateReason === 'SPEND_CAP').map(a => a.recipientId))],
      attempts: attempts.map(a => ({
        id: a.id, recipientId: a.recipientId, ...(names.has(a.recipientId) ? { recipientName: names.get(a.recipientId) } : {}),
        channel: a.channel, purpose: a.purpose, state: a.state, reason: a.stateReason,
        queuedAt: a.queuedAt, sentAt: a.sentAt, deliveredAt: a.deliveredAt, acknowledgedAt: a.acknowledgedAt, failedAt: a.failedAt, simulated: a.simulated,
      })),
    };
  }
}
