import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  apply,
  atDestination,
  policyFromTemplate,
  sessionContext,
  SESSION_MACHINE,
  SESSION_TERMINAL,
  TEMPLATE_DEFAULTS,
  type Actor,
  type Rejection,
  type SessionContext,
  type SessionEvent,
  type SessionKind,
  type SessionState,
} from '@lumo/safety-domain';
import { IncidentService } from '../incidents/incident.service';
import { LocationService, type SnapshotInput } from '../location/location.service';
import { NotificationQueue } from '../notifications/queue';
import { PUSH_PROVIDER, type PushProvider } from '../notifications/push/push-provider';
import { PrismaService } from '../prisma/prisma.service';
import { resolveRecipients } from '../trusted-contacts/recipients';
import { TrustedContactsService } from '../trusted-contacts/trusted-contacts.service';
import { Inject } from '@nestjs/common';

/**
 * Journeys (docs/specs/JOURNEY_GUARDIAN.md, SAFETY_CHECK.md). `apply` is the ONLY code that changes a session's state: it locks the
 * row, runs the state machine, appends an event WITH its order, and updates the state, in one transaction.
 *
 * EVERY DEADLINE THAT MUST ESCALATE LIVES ON THE SERVER, as a queue job (SAFETY_CHECK.md): a locally scheduled timer is a convenience,
 * never the safety mechanism, because Doze, Low Power Mode and a killed app all stop it. A job carries the check-in time it was set
 * for, and does nothing if the session's check-in has since moved (the person checked in, or extended): that is how one session has
 * many timers and no stale one can act.
 *
 * The path is the spec's, and it never skips a step: deadline → the PERSON is prompted (only them) → a short prompt window → grace →
 * only then the contacts, as an incident. An overdue journey is not an emergency, and a late bus must not alert anyone in the first
 * minutes.
 */

export type Tx = Prisma.TransactionClient;
export const LIVE_STATES: SessionState[] = ['CREATED', 'ACTIVE', 'CHECK_IN_DUE', 'GRACE', 'ESCALATING', 'ALERTED', 'SUSPENDED'];
const MIN_LEAD_MS = 60_000;
/** The longest a journey of each kind may run, so an abandoned one cannot hold a live session (and its alerts) forever. */
const MAX_DURATION_MS: Record<SessionKind, number> = {
  walk_home: 12 * 3600_000, ride: 12 * 3600_000, date: 24 * 3600_000, travel: 7 * 86_400_000, outdoor: 7 * 86_400_000, custom: 7 * 86_400_000,
};
const sec = (ms: number) => Math.ceil(ms / 1000);

export interface CreateInput {
  readonly kind: SessionKind;
  readonly expectedArrivalAt: Date;
  readonly destination?: { latitude: number; longitude: number; label?: string | null } | null;
  readonly shareLocation?: boolean;
}

export interface SessionView {
  readonly id: string;
  readonly kind: SessionKind;
  readonly state: SessionState;
  readonly expectedArrivalAt: Date | null;
  readonly checkInDueAt: Date | null;
  readonly destination: { latitude: number; longitude: number; label: string | null } | null;
  readonly shareLocation: boolean;
  /** What happens if the check-in is missed, in plain words ("will try to", never a promise). */
  readonly plan: { graceSeconds: number; contacts: string[] };
  /** The person is being asked "are you OK?" right now. */
  readonly needsAnswer: boolean;
  readonly incidentId: string | null;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
}

export type ApplyResult = { applied: true; from: SessionState; to: SessionState } | { applied: false; why: 'NOT_FOUND' | Rejection; state?: SessionState };

@Injectable()
export class SessionService implements OnModuleInit {
  private readonly logger = new Logger('Sessions');

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: NotificationQueue,
    private readonly contacts: TrustedContactsService,
    private readonly incidents: IncidentService,
    private readonly locations: LocationService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  onModuleInit() {
    this.queue.setHandlers({ session: (id, step, dueAt) => this.tick(id, step, dueAt), sweep: async () => { await this.sweep(); } });
    this.incidents.setSessionHooks({
      sosRaised: (sessionId, incidentId, now) => this.onSos(sessionId, incidentId, now),
      incidentResolved: (sessionId, now) => this.onIncidentResolved(sessionId, now),
    });
  }

  // ------------------------------------------------------------------ the one writer

  async apply(sessionId: string, event: SessionEvent, by: Actor, reason: string | null = null, ctx: Partial<SessionContext> = {}, now: Date = new Date(), tx?: Tx): Promise<ApplyResult> {
    if (!tx) return this.prisma.$transaction(t => this.apply(sessionId, event, by, reason, ctx, now, t));
    const rows = await tx.$queryRaw<{ state: SessionState; priorState: SessionState | null }[]>`
      SELECT "state", "priorState" FROM "SafetySession" WHERE "id" = ${sessionId} FOR UPDATE`;
    if (rows.length === 0) return { applied: false, why: 'NOT_FOUND' };

    const out = apply(SESSION_MACHINE, { state: rows[0].state, priorState: rows[0].priorState }, event, { at: now.getTime(), by, reason }, sessionContext(ctx));
    if (!out.ok) return { applied: false, why: out.rejection, state: rows[0].state };

    const to = out.snapshot.state;
    await tx.sessionEvent.create({ data: { sessionId, fromState: out.record.from, toState: to, event, actor: by, reason, occurredAt: now } });
    await tx.safetySession.update({
      where: { id: sessionId },
      data: {
        state: to, priorState: out.snapshot.priorState,
        ...(to === 'ACTIVE' && rows[0].state === 'CREATED' ? { startedAt: now } : {}),
        ...(SESSION_TERMINAL.includes(to) || to === 'ARRIVED' ? { endedAt: now } : {}),
      },
    });
    return { applied: true, from: out.record.from, to };
  }

  // ---------------------------------------------------------------------- starting

  private async consentedContacts(tx: Tx, userId: string) {
    return resolveRecipients(await this.contacts.list(tx, userId)).eligible;
  }

  /**
   * Start a journey. It needs at least one contact who has AGREED (the machine's START guard): a journey no one could be told about is
   * a promise the app cannot keep. Its escalation policy is its template's (grace, timeouts, who first), stored as the journey's own
   * row so editing the person's default later changes nothing about it.
   */
  async create(userId: string, input: CreateInput, now: Date = new Date()): Promise<SessionView> {
    if (!this.queue.running) throw new ServiceUnavailableException('Journeys cannot be started right now, because their timers cannot be kept.');

    const lead = input.expectedArrivalAt.getTime() - now.getTime();
    if (!(lead >= MIN_LEAD_MS)) throw new BadRequestException('The arrival time must be at least a minute from now.');
    if (lead > MAX_DURATION_MS[input.kind]) throw new BadRequestException(`A ${TEMPLATE_DEFAULTS[input.kind].label} cannot be longer than ${Math.round(MAX_DURATION_MS[input.kind] / 3600_000)} hours.`);

    try {
      const id = await this.prisma.$transaction(async tx => {
        const consented = await this.consentedContacts(tx, userId);
        const all = await this.contacts.list(tx, userId);
        const policy = policyFromTemplate(input.kind, { id: 'session', contactIds: all.map(c => c.id) });
        const row = await tx.escalationPolicy.create({
          data: {
            userId, isDefault: false, name: policy.name, graceSeconds: policy.graceSeconds, steps: JSON.parse(JSON.stringify(policy.steps)),
            maxRecipientsPerIncident: policy.maxRecipientsPerIncident, stopOnAcknowledgement: true, resumeOnUnacknowledge: true,
            promptEmergencyNumberOnFailure: policy.promptEmergencyNumberOnFailure, deviationGraceSeconds: policy.deviationGraceSeconds,
          },
        });
        const session = await tx.safetySession.create({
          data: {
            userId, kind: input.kind, escalationPolicyId: row.id, shareLocation: input.shareLocation ?? true,
            expectedArrivalAt: input.expectedArrivalAt, checkInDueAt: input.expectedArrivalAt,
            destinationLat: input.destination?.latitude, destinationLng: input.destination?.longitude, destinationLabel: input.destination?.label ?? null,
          },
        });
        await tx.sessionEvent.create({ data: { sessionId: session.id, fromState: null, toState: 'CREATED', event: 'CREATED', actor: 'user', reason: input.kind, occurredAt: now } });
        const started = await this.apply(session.id, 'START', 'user', null, { consentedContactCount: consented.length }, now, tx);
        if (!started.applied) throw new ConflictException('None of your contacts has agreed to be alerted yet, so a journey cannot be started. Ask someone to agree first.');
        await this.queue.enqueueSessionTick(tx, session.id, 'deadline', input.expectedArrivalAt.getTime(), sec(lead));
        return session.id;
      });
      return this.view(userId, id, now);
    } catch (e) {
      // The partial unique index: one journey in progress per person.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const live = await this.prisma.safetySession.findFirst({ where: { userId, state: { in: LIVE_STATES } }, select: { id: true } });
        throw new ConflictException({ message: 'You already have a journey in progress. Finish or cancel it first.', sessionId: live?.id });
      }
      throw e;
    }
  }

  // ----------------------------------------------------------------- the timers

  /**
   * A journey timer fired. Stale (the check-in moved), early, repeated, or for a session no longer live: nothing happens. Safe to
   * run any number of times.
   */
  async tick(sessionId: string, step: 'deadline' | 'prompt' | 'grace', dueAt: number, now: Date = new Date()): Promise<void> {
    const s = await this.prisma.safetySession.findUnique({ where: { id: sessionId } });
    if (!s || SESSION_TERMINAL.includes(s.state) || s.checkInDueAt?.getTime() !== dueAt) return; // stale: the check-in has moved
    if (now.getTime() < dueAt) return; // early

    const graceMs = (await this.graceSeconds(s.escalationPolicyId)) * 1000;
    const promptMs = Math.min(60_000, Math.floor(graceMs / 2));

    if (step === 'deadline') {
      const r = await this.apply(sessionId, 'CHECK_IN_DEADLINE_REACHED', 'system', null, {}, now);
      if (r.applied) {
        await this.promptUser(s.userId, 'Check-in due', 'Are you OK? Open Lumo to answer. If you do not, your contacts may be alerted.');
        await this.prisma.$transaction(async tx => {
          await this.queue.enqueueSessionTick(tx, sessionId, 'prompt', dueAt, sec(promptMs));
          await this.queue.enqueueSessionTick(tx, sessionId, 'grace', dueAt, sec(graceMs));
        });
      }
      return;
    }
    if (step === 'prompt') {
      await this.apply(sessionId, 'NO_RESPONSE', 'system', 'PROMPT_UNANSWERED', { promptUnanswered: true }, now);
      return;
    }
    // grace: nobody answered. Walk the machine through every step it requires (a lost earlier job must not skip one).
    const elapsed = now.getTime() - dueAt;
    await this.apply(sessionId, 'NO_RESPONSE', 'system', 'PROMPT_UNANSWERED', { promptUnanswered: true }, now); // a no-op unless still CHECK_IN_DUE
    const g = await this.apply(sessionId, 'GRACE_EXPIRED', 'system', 'GRACE_ELAPSED', { graceElapsedMs: elapsed, graceMs }, now);
    // Already ESCALATING means an earlier run got this far and then failed (the queue was down): carry on from there, do not stall.
    const now2 = g.applied ? 'ESCALATING' : (await this.prisma.safetySession.findUnique({ where: { id: sessionId }, select: { state: true } }))?.state;
    if (now2 === 'ESCALATING') await this.escalate(sessionId, dueAt, now);
  }

  /**
   * The backstop. Every deadline is a queue job, and a job can be lost (a purge, a restore, a bug). A journey that is overdue and was
   * never advanced would sit ACTIVE forever with nobody told, so once a minute this finds them and fires what should have fired. It does
   * nothing a timer would not have done, only later: ticks are idempotent and check their own staleness.
   */
  async sweep(now: Date = new Date()): Promise<number> {
    const live = await this.prisma.safetySession.findMany({
      where: { state: { in: ['ACTIVE', 'CHECK_IN_DUE', 'GRACE', 'ESCALATING'] }, checkInDueAt: { lte: now } },
      select: { id: true, state: true, checkInDueAt: true, escalationPolicyId: true },
    });
    let fired = 0;
    for (const s of live) {
      const dueAt = (s.checkInDueAt as Date).getTime();
      const graceMs = (await this.graceSeconds(s.escalationPolicyId)) * 1000;
      const step: 'deadline' | 'prompt' | 'grace' =
        s.state === 'ACTIVE' ? 'deadline' : now.getTime() >= dueAt + graceMs || s.state === 'ESCALATING' ? 'grace' : 'prompt';
      await this.tick(s.id, step, dueAt, now).catch(() => undefined);
      fired += 1;
    }
    return fired;
  }

  private async graceSeconds(policyId: string): Promise<number> {
    const p = await this.prisma.escalationPolicy.findUnique({ where: { id: policyId }, select: { graceSeconds: true } });
    return p?.graceSeconds ?? 300;
  }

  /** ESCALATING: raise the incident (idempotent on the session and its due time), then record that it was raised. */
  private async escalate(sessionId: string, dueAt: number, now: Date) {
    const s = await this.prisma.safetySession.findUniqueOrThrow({ where: { id: sessionId } });
    const incidentId = await this.incidents.raiseForSession(s.userId, sessionId, `session:${sessionId}:${dueAt}`, now);
    await this.apply(sessionId, 'INCIDENT_RAISED', 'system', null, {}, now);
    return incidentId;
  }

  /** Ask the PERSON, on their own devices, and nobody else. Best effort: the app also shows it from the session's state. */
  private async promptUser(userId: string, title: string, body: string): Promise<void> {
    try {
      if (!this.push.configured()) return;
      const devices = await this.prisma.device.findMany({ where: { userId, revokedAt: null, pushToken: { not: null } }, select: { pushToken: true } });
      const tokens = devices.flatMap(d => (d.pushToken ? [d.pushToken] : []));
      if (tokens.length > 0) await this.push.send({ tokens, title, body, attemptId: 'self-prompt' });
    } catch {
      this.logger.warn('could not prompt the user; the app shows the question from the journey state');
    }
  }

  // ----------------------------------------------------------- what the person does

  private async owned(userId: string, id: string) {
    const s = await this.prisma.safetySession.findFirst({ where: { id, userId } });
    if (!s) throw new NotFoundException();
    return s;
  }

  /**
   * "I'm OK" / "I need longer": answers a due check-in, or moves a running journey's arrival. The new time must be in the future and
   * within the kind's limit. Everything scheduled for the old time goes stale by itself.
   */
  async checkIn(userId: string, id: string, newArrival: Date, now: Date = new Date()): Promise<SessionView> {
    const s = await this.owned(userId, id);
    const lead = newArrival.getTime() - now.getTime();
    if (!(lead >= MIN_LEAD_MS)) throw new BadRequestException('The new arrival time must be at least a minute from now.');
    if (lead > MAX_DURATION_MS[s.kind]) throw new BadRequestException('That is longer than this kind of journey allows.');

    await this.prisma.$transaction(async tx => {
      const noIncidentYet = (await tx.emergencyIncident.count({ where: { sessionId: id } })) === 0;
      // From ACTIVE the journey simply gets a new time; from a due/grace/escalating one it is the person ANSWERING.
      if (s.state === 'ACTIVE') {
        await tx.sessionEvent.create({ data: { sessionId: id, fromState: 'ACTIVE', toState: 'ACTIVE', event: 'CHECKED_IN', actor: 'user', reason: 'EXTENDED', occurredAt: now } });
      } else {
        const r = await this.apply(id, 'USER_RESPONDED', 'user', 'CHECKED_IN', { noIncidentRaisedYet: noIncidentYet }, now, tx);
        if (!r.applied) throw new ConflictException(s.state === 'ALERTED' ? 'An alert has already gone out. End it from the emergency screen.' : 'This journey cannot be checked in right now.');
      }
      await tx.safetySession.update({ where: { id }, data: { expectedArrivalAt: newArrival, checkInDueAt: newArrival } });
      await this.queue.enqueueSessionTick(tx, id, 'deadline', newArrival.getTime(), sec(lead));
    });
    return this.view(userId, id, now);
  }

  /** "I've arrived." Confirmation by the person: never a timer. If an alert already went out, it is resolved and the contacts told. */
  async arrive(userId: string, id: string, now: Date = new Date()): Promise<SessionView> {
    const s = await this.owned(userId, id);
    if (SESSION_TERMINAL.includes(s.state)) return this.view(userId, id, now); // idempotent
    const incident = await this.prisma.emergencyIncident.findFirst({ where: { sessionId: id }, orderBy: { createdAt: 'desc' }, select: { id: true, state: true } });
    const out = await this.apply(id, 'ARRIVAL_CONFIRMED', 'user', 'USER_CONFIRMED', { noIncidentRaisedYet: !incident }, now);
    if (!out.applied) throw new ConflictException('This journey cannot be ended from where it is.');
    if (out.to === 'ARRIVED') await this.apply(id, 'CLOSE', 'system', 'ARRIVED', {}, now);
    // The machine's ALERTED → CLOSED row DECLARES "resolve the incident": do it, so the contacts who were alerted are told it ended.
    if (out.from === 'ALERTED' && incident) await this.incidents.resolve({ id: userId, via: 'login' }, incident.id, now).catch(() => undefined);
    return this.view(userId, id, now);
  }

  async cancel(userId: string, id: string, now: Date = new Date()): Promise<SessionView> {
    const s = await this.owned(userId, id);
    if (SESSION_TERMINAL.includes(s.state)) return this.view(userId, id, now);
    const out = await this.apply(id, 'CANCEL', 'user', 'USER_CANCELLED', {}, now);
    if (!out.applied) throw new ConflictException('An alert is already in progress for this journey. End it from the emergency screen.');
    return this.view(userId, id, now);
  }

  // -------------------------------------------------------------------- location

  /**
   * Store the journey's positions, and say whether the latest puts the person at the destination. Arrival is closed automatically ONLY
   * from ACTIVE; in any other state the app is told and the person confirms ("never a timer alone", and not a stray fix either).
   */
  async recordLocation(userId: string, id: string, snapshots: readonly SnapshotInput[], now: Date = new Date()): Promise<{ stored: number; duplicates: number; atDestination: boolean; arrived: boolean }> {
    const s = await this.owned(userId, id);
    if (!s.shareLocation) throw new ConflictException('Location sharing is off for this journey.');
    const result = await this.locations.recordForSession(userId, id, snapshots, now.getTime());

    const latest = [...snapshots].filter(x => typeof x.accuracyM === 'number').sort((a, b) => b.capturedAt - a.capturedAt)[0];
    const here = Boolean(latest && s.destinationLat !== null && s.destinationLng !== null &&
      atDestination({ latitude: latest.latitude, longitude: latest.longitude, accuracyM: latest.accuracyM as number }, { latitude: s.destinationLat, longitude: s.destinationLng }));
    let arrived = false;
    if (here && s.state === 'ACTIVE') {
      const r = await this.apply(id, 'ARRIVAL_DETECTED', 'system', 'GEOFENCE', { withinDestinationGeofence: true }, now);
      if (r.applied) { await this.apply(id, 'CLOSE', 'system', 'ARRIVED', {}, now); arrived = true; }
    }
    return { ...result, atDestination: here, arrived };
  }

  // ------------------------------------------------- what the incident tells the journey

  private async onSos(sessionId: string, incidentId: string, now: Date) {
    await this.apply(sessionId, 'SOS_RAISED', 'user', 'SOS_DURING_JOURNEY', {}, now);
    void incidentId;
  }

  private async onIncidentResolved(sessionId: string, now: Date) {
    await this.apply(sessionId, 'INCIDENT_RESOLVED', 'system', 'INCIDENT_RESOLVED', { incidentTerminal: true }, now);
  }

  // --------------------------------------------------------------------- reading

  async view(userId: string, id: string, now: Date = new Date()): Promise<SessionView> {
    const s = await this.owned(userId, id);
    const policy = await this.prisma.escalationPolicy.findUnique({ where: { id: s.escalationPolicyId } });
    const steps = (policy?.steps ?? []) as unknown as { recipients: { id: string }[] }[];
    const list = await this.contacts.list(this.prisma, userId);
    const names = new Map(list.map(c => [c.id, c.name]));
    const incident = await this.prisma.emergencyIncident.findFirst({ where: { sessionId: id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    void now;
    return {
      id: s.id, kind: s.kind, state: s.state, expectedArrivalAt: s.expectedArrivalAt, checkInDueAt: s.checkInDueAt,
      destination: s.destinationLat !== null && s.destinationLng !== null ? { latitude: s.destinationLat, longitude: s.destinationLng, label: s.destinationLabel } : null,
      shareLocation: s.shareLocation,
      plan: { graceSeconds: policy?.graceSeconds ?? 0, contacts: steps.flatMap(st => st.recipients.map(r => names.get(r.id) ?? 'A contact')) },
      needsAnswer: s.state === 'CHECK_IN_DUE' || s.state === 'GRACE',
      incidentId: incident?.id ?? null, startedAt: s.startedAt, endedAt: s.endedAt,
    };
  }

  async active(userId: string, now: Date = new Date()): Promise<SessionView | null> {
    const s = await this.prisma.safetySession.findFirst({ where: { userId, state: { in: LIVE_STATES } }, select: { id: true } });
    return s ? this.view(userId, s.id, now) : null;
  }
}
