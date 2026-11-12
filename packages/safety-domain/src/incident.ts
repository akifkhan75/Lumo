import { rowsFrom, type Machine, type Row } from './machine';
import type { Actor } from './types';

/**
 * EmergencyIncident — the response (docs/specs/SAFETY_STATE_MACHINES.md §2, §6a).
 *
 * CANCELLED is reachable only during the countdown. After dispatch there is no
 * cancel: contacts already have the alert, so the honest action is RESOLVE,
 * which tells them it ended.
 */

export const INCIDENT_STATES = [
  'CREATED',
  'LOCATING',
  'DISPATCHING',
  'NOTIFYING',
  'PARTIALLY_NOTIFIED',
  'NOTIFIED',
  'ALL_CHANNELS_FAILED',
  'ACKNOWLEDGED',
  'RESOLVING',
  'CLOSED',
  'CANCELLED',
] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];

export const INCIDENT_EVENTS = [
  'CANCEL',
  'DURESS_CANCEL',
  'COUNTDOWN_ELAPSED',
  'COUNTDOWN_SKIPPED',
  'LOCATION_ACQUIRED',
  'LOCATION_TIMEOUT',
  'RECIPIENTS_RESOLVED',
  'NO_RECIPIENTS',
  'ATTEMPT_SETTLED',
  'ALL_SETTLED',
  'STEP_TIMEOUT',
  'ACK_RECEIVED',
  'UNACK_RECEIVED',
  'RESOLVE',
  'CLOSE',
] as const;
export type IncidentEvent = (typeof INCIDENT_EVENTS)[number];

export const INCIDENT_TERMINAL: readonly IncidentState[] = ['CLOSED', 'CANCELLED'];

/**
 * LOCATING is time-boxed so it can never block dispatch (invariant 3). The caller
 * owns the timer and emits LOCATION_TIMEOUT when it fires. The event has NO guard
 * on elapsed time on purpose: a guard that refused an early timeout would let a
 * skewed clock stall an emergency, and dispatching early without a fix is safe.
 */
export const LOCATING_TIMEBOX_MS = 5000;

export interface IncidentContext {
  readonly withinCountdown: boolean;
  readonly duressCodeMatched: boolean;
  /** The trigger was a manual SOS or a safeword, so the countdown is skipped. */
  readonly manualOrSafeword: boolean;
  readonly consentedRecipients: number;
  /** Per-recipient counts from rollupIncident (a fallback is the same recipient). */
  readonly pending: number;
  readonly reached: number;
  readonly failed: number;
  /** More escalation steps remain, or are still scheduled. */
  readonly moreStepsRemain: boolean;
}

export const DEFAULT_INCIDENT_CONTEXT: IncidentContext = {
  withinCountdown: false,
  duressCodeMatched: false,
  manualOrSafeword: false,
  consentedRecipients: 0,
  pending: 0,
  reached: 0,
  failed: 0,
  moreStepsRemain: true, // the conservative default: never declare the ladder finished
};

export const incidentContext = (partial: Partial<IncidentContext> = {}): IncidentContext => ({
  ...DEFAULT_INCIDENT_CONTEXT,
  ...partial,
});

type R = Row<IncidentState, IncidentEvent, IncidentContext>;
const row = (
  from: IncidentState | readonly IncidentState[],
  event: IncidentEvent,
  to: IncidentState | '@prior',
  actor: readonly Actor[],
  options: { guard?: (c: IncidentContext) => boolean; effects?: readonly string[] } = {},
): R[] => rowsFrom<IncidentState, IncidentEvent, IncidentContext>(from, event, to, actor, options);

// The ladder is finished when nothing is in flight and no step remains. Without
// the second half, a first step whose recipients all failed would settle the
// incident as ALL_CHANNELS_FAILED — full-screen alarm, on-call paged — while the
// next step has not even been dispatched. §6a states these guards without it.
const settled = (c: IncidentContext) => c.pending === 0 && !c.moreStepsRemain;

const rows: R[] = [
  ...row('CREATED', 'CANCEL', 'CANCELLED', ['user'], { guard: (c) => c.withinCountdown, effects: ['stopCountdown'] }),
  // The device renders a cancellation; the incident proceeds silently (invariant 8).
  ...row('CREATED', 'DURESS_CANCEL', 'LOCATING', ['user'], {
    guard: (c) => c.duressCodeMatched,
    effects: ['markDuress', 'suppressAllDeviceUi'],
  }),
  ...row('CREATED', 'COUNTDOWN_ELAPSED', 'LOCATING', ['system'], { effects: ['startLocationFix'] }),
  ...row('CREATED', 'COUNTDOWN_SKIPPED', 'LOCATING', ['user'], { guard: (c) => c.manualOrSafeword }),

  ...row('LOCATING', 'LOCATION_ACQUIRED', 'DISPATCHING', ['system'], { effects: ['attachLocation'] }),
  ...row('LOCATING', 'LOCATION_TIMEOUT', 'DISPATCHING', ['system'], { effects: ['markLocationUnavailable'] }),

  ...row('DISPATCHING', 'RECIPIENTS_RESOLVED', 'NOTIFYING', ['system'], {
    guard: (c) => c.consentedRecipients >= 1,
    effects: ['createAttempts'],
  }),
  ...row('DISPATCHING', 'NO_RECIPIENTS', 'ALL_CHANNELS_FAILED', ['system'], {
    guard: (c) => c.consentedRecipients === 0,
    effects: ['promptUserToDial'],
  }),

  // Something is still to come: attempts in flight, or a later step not yet run.
  ...row('NOTIFYING', 'ATTEMPT_SETTLED', 'NOTIFYING', ['system'], {
    guard: (c) => !settled(c),
    effects: ['updateLedger'],
  }),
  // The three outcomes share (NOTIFYING, ALL_SETTLED) and are mutually exclusive.
  ...row('NOTIFYING', 'ALL_SETTLED', 'NOTIFIED', ['system'], {
    guard: (c) => settled(c) && c.failed === 0 && c.reached > 0,
    effects: ['updateLedger'],
  }),
  ...row('NOTIFYING', 'ALL_SETTLED', 'PARTIALLY_NOTIFIED', ['system'], {
    guard: (c) => settled(c) && c.failed > 0 && c.reached > 0,
    effects: ['updateLedger'],
  }),
  ...row('NOTIFYING', 'ALL_SETTLED', 'ALL_CHANNELS_FAILED', ['system'], {
    guard: (c) => settled(c) && c.reached === 0,
    effects: ['pageOnCall', 'promptUserToDial'],
  }),
  ...row('NOTIFYING', 'STEP_TIMEOUT', 'NOTIFYING', ['policy'], {
    guard: (c) => c.moreStepsRemain,
    effects: ['advanceEscalationStep'],
  }),

  ...row(['NOTIFYING', 'PARTIALLY_NOTIFIED', 'NOTIFIED', 'ALL_CHANNELS_FAILED'], 'ACK_RECEIVED', 'ACKNOWLEDGED', ['contact'], {
    effects: ['haltEscalation', 'notifyUserOfAck'],
  }),
  ...row('ACKNOWLEDGED', 'UNACK_RECEIVED', '@prior', ['contact'], { effects: ['resumeEscalation'] }),

  ...row(['NOTIFYING', 'PARTIALLY_NOTIFIED', 'NOTIFIED', 'ALL_CHANNELS_FAILED', 'ACKNOWLEDGED'], 'RESOLVE', 'RESOLVING', ['user'], {
    effects: ['haltEscalation', 'notifyContactsResolved'],
  }),
  ...row('RESOLVING', 'CLOSE', 'CLOSED', ['system'], { effects: ['sealTimeline'] }),
];

export const INCIDENT_MACHINE: Machine<IncidentState, IncidentEvent, IncidentContext> = {
  name: 'EmergencyIncident',
  states: INCIDENT_STATES,
  events: INCIDENT_EVENTS,
  rows,
  rememberPriorOn: ['ACKNOWLEDGED'],
};
