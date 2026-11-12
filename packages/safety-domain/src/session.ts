import { rowsFrom, type Machine, type Row } from './machine';

/**
 * SafetySession — the plan: a journey, a check-in, an activity
 * (docs/specs/SAFETY_STATE_MACHINES.md §1, §6a).
 *
 * An overdue journey is NOT an emergency, and an SOS can exist with no journey at
 * all, which is why this is a separate machine from EmergencyIncident (ADR-0008).
 * `ACTIVE → ESCALATING` is deliberately absent: a session must pass through
 * CHECK_IN_DUE and GRACE, because skipping grace is how an app escalates a late bus.
 */

export const SESSION_STATES = [
  'CREATED',
  'ACTIVE',
  'CHECK_IN_DUE',
  'GRACE',
  'ESCALATING',
  'ALERTED',
  'ARRIVED',
  'CLOSED',
  'SUSPENDED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const SESSION_EVENTS = [
  'START',
  'CANCEL',
  'CHECK_IN_DEADLINE_REACHED',
  'ARRIVAL_DETECTED',
  'ARRIVAL_CONFIRMED',
  'DEVIATION_DETECTED',
  'SOS_RAISED',
  'CONNECTIVITY_LOST',
  'EXPIRE',
  'USER_RESPONDED',
  'NO_RESPONSE',
  'GRACE_EXPIRED',
  'INCIDENT_RAISED',
  'INCIDENT_RESOLVED',
  'CLOSE',
  'CONNECTIVITY_RESTORED',
] as const;
export type SessionEvent = (typeof SESSION_EVENTS)[number];

/** Terminal: nothing leaves these. Reopening would corrupt the audit record. */
export const SESSION_TERMINAL: readonly SessionState[] = ['CLOSED', 'CANCELLED', 'EXPIRED'];

/**
 * Facts the guards read, supplied by the caller. Every field defaults to the
 * value that makes its guard FAIL, so a context the caller forgot to fill in
 * rejects the transition instead of allowing it.
 */
export interface SessionContext {
  readonly consentedContactCount: number;
  readonly withinDestinationGeofence: boolean;
  /** How long the user has been off the expected route, and the allowed grace. */
  readonly deviationForMs: number;
  readonly deviationGraceMs: number;
  /** Off-route distance must exceed GPS error, or it is noise (A: GPS drift). */
  readonly offRouteDistanceM: number;
  readonly gpsAccuracyM: number;
  readonly resolutionImpossible: boolean;
  readonly promptUnanswered: boolean;
  readonly graceElapsedMs: number;
  readonly graceMs: number;
  readonly noIncidentRaisedYet: boolean;
  readonly incidentTerminal: boolean;
}

export const DEFAULT_SESSION_CONTEXT: SessionContext = {
  consentedContactCount: 0,
  withinDestinationGeofence: false,
  deviationForMs: 0,
  deviationGraceMs: Number.POSITIVE_INFINITY,
  offRouteDistanceM: 0,
  gpsAccuracyM: Number.POSITIVE_INFINITY,
  resolutionImpossible: false,
  promptUnanswered: false,
  graceElapsedMs: 0,
  graceMs: Number.POSITIVE_INFINITY,
  noIncidentRaisedYet: false,
  incidentTerminal: false,
};

export const sessionContext = (partial: Partial<SessionContext> = {}): SessionContext => ({
  ...DEFAULT_SESSION_CONTEXT,
  ...partial,
});

type R = Row<SessionState, SessionEvent, SessionContext>;
const row = (
  from: SessionState | readonly SessionState[],
  event: SessionEvent,
  to: SessionState | '@prior',
  actor: readonly ('user' | 'system' | 'policy' | 'contact')[],
  options: { guard?: (c: SessionContext) => boolean; effects?: readonly string[] } = {},
): R[] => rowsFrom<SessionState, SessionEvent, SessionContext>(from, event, to, actor, options);

const hasContact = (c: SessionContext) => c.consentedContactCount >= 1;
const inGeofence = (c: SessionContext) => c.withinDestinationGeofence;
// A single off-route fix is GPS drift or a shop. It must persist beyond the grace
// AND be further out than the fix's own error before it is a deviation.
const deviated = (c: SessionContext) => c.deviationForMs > c.deviationGraceMs && c.offRouteDistanceM > c.gpsAccuracyM;
const noResolution = (c: SessionContext) => c.resolutionImpossible;
const unanswered = (c: SessionContext) => c.promptUnanswered;
const graceUp = (c: SessionContext) => c.graceElapsedMs >= c.graceMs;
const notRaised = (c: SessionContext) => c.noIncidentRaisedYet;
const incidentDone = (c: SessionContext) => c.incidentTerminal;

const rows: R[] = [
  ...row('CREATED', 'START', 'ACTIVE', ['user'], { guard: hasContact, effects: ['startTimers', 'notifyContactsSessionStarted'] }),
  ...row('CREATED', 'CANCEL', 'CANCELLED', ['user']),

  ...row('ACTIVE', 'CHECK_IN_DEADLINE_REACHED', 'CHECK_IN_DUE', ['system'], { effects: ['promptUser'] }),
  ...row('ACTIVE', 'ARRIVAL_DETECTED', 'ARRIVED', ['system'], { guard: inGeofence, effects: ['stopTimers'] }),
  ...row('ACTIVE', 'ARRIVAL_CONFIRMED', 'ARRIVED', ['user'], { effects: ['stopTimers'] }),
  ...row('ACTIVE', 'DEVIATION_DETECTED', 'ACTIVE', ['system'], { guard: deviated, effects: ['promptUserDiscreetly'] }),
  ...row('ACTIVE', 'SOS_RAISED', 'ALERTED', ['user'], { effects: ['raiseIncident'] }),
  ...row('ACTIVE', 'CONNECTIVITY_LOST', 'SUSPENDED', ['system'], { effects: ['recordPriorState', 'showOfflineNotice'] }),
  ...row('ACTIVE', 'CANCEL', 'CANCELLED', ['user'], { effects: ['notifyContactsEnded'] }),
  ...row('ACTIVE', 'EXPIRE', 'EXPIRED', ['system'], { guard: noResolution, effects: ['notifyContactsExpired'] }),

  ...row('CHECK_IN_DUE', 'USER_RESPONDED', 'ACTIVE', ['user'], { effects: ['rescheduleDeadline'] }),
  ...row('CHECK_IN_DUE', 'NO_RESPONSE', 'GRACE', ['system'], { guard: unanswered, effects: ['startGraceTimer'] }),
  ...row('CHECK_IN_DUE', 'ARRIVAL_CONFIRMED', 'ARRIVED', ['user'], { effects: ['stopTimers'] }),
  ...row('CHECK_IN_DUE', 'CONNECTIVITY_LOST', 'SUSPENDED', ['system'], { effects: ['recordPriorState'] }),
  ...row('CHECK_IN_DUE', 'CANCEL', 'CANCELLED', ['user'], { effects: ['notifyContactsEnded'] }),

  ...row('GRACE', 'USER_RESPONDED', 'ACTIVE', ['user'], { effects: ['rescheduleDeadline'] }),
  ...row('GRACE', 'GRACE_EXPIRED', 'ESCALATING', ['system'], { guard: graceUp, effects: ['beginEscalation'] }),
  ...row('GRACE', 'ARRIVAL_CONFIRMED', 'ARRIVED', ['user'], { effects: ['stopTimers'] }),
  ...row('GRACE', 'CONNECTIVITY_LOST', 'SUSPENDED', ['system'], { effects: ['recordPriorState'] }),
  ...row('GRACE', 'CANCEL', 'CANCELLED', ['user'], { effects: ['notifyContactsEnded'] }),

  ...row('ESCALATING', 'USER_RESPONDED', 'ACTIVE', ['user'], { guard: notRaised, effects: ['haltEscalation', 'rescheduleDeadline'] }),
  ...row('ESCALATING', 'ARRIVAL_CONFIRMED', 'ARRIVED', ['user'], { guard: notRaised, effects: ['haltEscalation'] }),
  ...row('ESCALATING', 'INCIDENT_RAISED', 'ALERTED', ['system']),

  ...row('ALERTED', 'INCIDENT_RESOLVED', 'CLOSED', ['user', 'system'], { guard: incidentDone, effects: ['notifyContactsResolved'] }),
  ...row('ALERTED', 'ARRIVAL_CONFIRMED', 'CLOSED', ['user'], { effects: ['resolveIncident', 'notifyContactsResolved'] }),

  ...row('ARRIVED', 'CLOSE', 'CLOSED', ['system'], { effects: ['notifyContactsArrived'] }),

  // The session returns to the state it left, unless a queued event has advanced it.
  ...row('SUSPENDED', 'CONNECTIVITY_RESTORED', '@prior', ['system'], { effects: ['reconcileQueue'] }),
  ...row('SUSPENDED', 'ARRIVAL_CONFIRMED', 'ARRIVED', ['user'], { effects: ['queueArrivalNotice'] }),
  ...row('SUSPENDED', 'CANCEL', 'CANCELLED', ['user'], { effects: ['queueEndNotice'] }),
  // Dispatched on reconnect, and marked delayed — a late alert beats no alert.
  ...row('SUSPENDED', 'GRACE_EXPIRED', 'ESCALATING', ['system'], { effects: ['queueEscalation'] }),
];

export const SESSION_MACHINE: Machine<SessionState, SessionEvent, SessionContext> = {
  name: 'SafetySession',
  states: SESSION_STATES,
  events: SESSION_EVENTS,
  rows,
  rememberPriorOn: ['SUSPENDED'],
};
