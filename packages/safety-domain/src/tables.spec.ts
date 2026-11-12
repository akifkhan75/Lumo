import { describe, expect, it } from 'vitest';
import { ACTORS, CHANNELS, type Actor } from './types';
import { apply, type Machine } from './machine';
import { SESSION_MACHINE, SESSION_STATES, SESSION_EVENTS, sessionContext } from './session';
import { INCIDENT_MACHINE, INCIDENT_STATES, INCIDENT_EVENTS, incidentContext } from './incident';
import { ATTEMPT_MACHINE, ATTEMPT_EVENTS } from './attempt';
import { ATTEMPT_STATES, CHANNEL_CAPABILITIES } from './capabilities';

/**
 * The tables, checked two independent ways.
 *
 * 1. EXPECTED: the rows of docs/specs/SAFETY_STATE_MACHINES.md §6a transcribed by
 *    hand below, compared to what the code defines. A row added, dropped or
 *    redirected in transitions fails here. That makes the spec the thing being
 *    tested, not the code testing itself.
 * 2. EXHAUSTIVE: every (state × event) pair is either a row or an explicit
 *    rejection. There is no default-allow (SAFETY_STATE_MACHINES.md §6).
 */

type Triple = readonly [string, string, string];
const fmt = (rows: readonly { from: string; event: string; to: string }[]) =>
  rows.map((r) => `${r.from} --${r.event}--> ${r.to}`).sort();
const fmtExpected = (rows: readonly Triple[]) => rows.map(([f, e, t]) => `${f} --${e}--> ${t}`).sort();

// §6a SafetySession, row for row.
const EXPECTED_SESSION: Triple[] = [
  ['CREATED', 'START', 'ACTIVE'],
  ['CREATED', 'CANCEL', 'CANCELLED'],
  ['ACTIVE', 'CHECK_IN_DEADLINE_REACHED', 'CHECK_IN_DUE'],
  ['ACTIVE', 'ARRIVAL_DETECTED', 'ARRIVED'],
  ['ACTIVE', 'ARRIVAL_CONFIRMED', 'ARRIVED'],
  ['ACTIVE', 'DEVIATION_DETECTED', 'ACTIVE'],
  ['ACTIVE', 'SOS_RAISED', 'ALERTED'],
  ['ACTIVE', 'CONNECTIVITY_LOST', 'SUSPENDED'],
  ['ACTIVE', 'CANCEL', 'CANCELLED'],
  ['ACTIVE', 'EXPIRE', 'EXPIRED'],
  ['CHECK_IN_DUE', 'USER_RESPONDED', 'ACTIVE'],
  ['CHECK_IN_DUE', 'NO_RESPONSE', 'GRACE'],
  ['CHECK_IN_DUE', 'ARRIVAL_CONFIRMED', 'ARRIVED'],
  ['CHECK_IN_DUE', 'CONNECTIVITY_LOST', 'SUSPENDED'],
  ['CHECK_IN_DUE', 'CANCEL', 'CANCELLED'],
  ['GRACE', 'USER_RESPONDED', 'ACTIVE'],
  ['GRACE', 'GRACE_EXPIRED', 'ESCALATING'],
  ['GRACE', 'ARRIVAL_CONFIRMED', 'ARRIVED'],
  ['GRACE', 'CONNECTIVITY_LOST', 'SUSPENDED'],
  ['GRACE', 'CANCEL', 'CANCELLED'],
  ['ESCALATING', 'USER_RESPONDED', 'ACTIVE'],
  ['ESCALATING', 'ARRIVAL_CONFIRMED', 'ARRIVED'],
  ['ESCALATING', 'INCIDENT_RAISED', 'ALERTED'],
  ['ALERTED', 'INCIDENT_RESOLVED', 'CLOSED'],
  ['ALERTED', 'ARRIVAL_CONFIRMED', 'CLOSED'],
  ['ARRIVED', 'CLOSE', 'CLOSED'],
  ['SUSPENDED', 'CONNECTIVITY_RESTORED', '@prior'],
  ['SUSPENDED', 'ARRIVAL_CONFIRMED', 'ARRIVED'],
  ['SUSPENDED', 'CANCEL', 'CANCELLED'],
  ['SUSPENDED', 'GRACE_EXPIRED', 'ESCALATING'],
];

// §6a EmergencyIncident. Rows listing several source states are expanded.
const ACK_FROM = ['NOTIFYING', 'PARTIALLY_NOTIFIED', 'NOTIFIED', 'ALL_CHANNELS_FAILED'];
const RESOLVE_FROM = [...ACK_FROM, 'ACKNOWLEDGED'];
const EXPECTED_INCIDENT: Triple[] = [
  ['CREATED', 'CANCEL', 'CANCELLED'],
  ['CREATED', 'DURESS_CANCEL', 'LOCATING'],
  ['CREATED', 'COUNTDOWN_ELAPSED', 'LOCATING'],
  ['CREATED', 'COUNTDOWN_SKIPPED', 'LOCATING'],
  ['LOCATING', 'LOCATION_ACQUIRED', 'DISPATCHING'],
  ['LOCATING', 'LOCATION_TIMEOUT', 'DISPATCHING'],
  ['DISPATCHING', 'RECIPIENTS_RESOLVED', 'NOTIFYING'],
  ['DISPATCHING', 'NO_RECIPIENTS', 'ALL_CHANNELS_FAILED'],
  ['NOTIFYING', 'ATTEMPT_SETTLED', 'NOTIFYING'],
  ['NOTIFYING', 'ALL_SETTLED', 'NOTIFIED'],
  ['NOTIFYING', 'ALL_SETTLED', 'PARTIALLY_NOTIFIED'],
  ['NOTIFYING', 'ALL_SETTLED', 'ALL_CHANNELS_FAILED'],
  ['NOTIFYING', 'STEP_TIMEOUT', 'NOTIFYING'],
  ...ACK_FROM.map((s): Triple => [s, 'ACK_RECEIVED', 'ACKNOWLEDGED']),
  ['ACKNOWLEDGED', 'UNACK_RECEIVED', '@prior'],
  ...RESOLVE_FROM.map((s): Triple => [s, 'RESOLVE', 'RESOLVING']),
  ['RESOLVING', 'CLOSE', 'CLOSED'],
];

// §6a NotificationAttempt.
const EXPECTED_ATTEMPT: Triple[] = [
  ['QUEUED', 'PROVIDER_ACCEPTED', 'SENT'],
  ['QUEUED', 'PROVIDER_REJECTED', 'FAILED'],
  ['QUEUED', 'TTL_ELAPSED', 'EXPIRED'],
  ['QUEUED', 'SPEND_CAP_REACHED', 'FAILED'],
  ['SENT', 'RECEIPT_DELIVERED', 'DELIVERED'],
  ['SENT', 'ACK', 'ACKNOWLEDGED'],
  ['SENT', 'CHANNEL_CANNOT_REPORT', 'UNKNOWN'],
  ['SENT', 'TTL_ELAPSED', 'EXPIRED'],
  ['SENT', 'TTL_ELAPSED', 'UNKNOWN'],
  ['DELIVERED', 'ACK', 'ACKNOWLEDGED'],
];

describe('the tables match the spec, row for row', () => {
  it('SafetySession', () => {
    expect(fmt(SESSION_MACHINE.rows)).toEqual(fmtExpected(EXPECTED_SESSION));
  });
  it('EmergencyIncident', () => {
    expect(fmt(INCIDENT_MACHINE.rows)).toEqual(fmtExpected(EXPECTED_INCIDENT));
  });
  it('NotificationAttempt', () => {
    expect(fmt(ATTEMPT_MACHINE.rows)).toEqual(fmtExpected(EXPECTED_ATTEMPT));
  });
});

describe('every state and event a row uses is a declared one', () => {
  const cases: [string, Machine<any, any, any>][] = [
    ['SafetySession', SESSION_MACHINE],
    ['EmergencyIncident', INCIDENT_MACHINE],
    ['NotificationAttempt', ATTEMPT_MACHINE],
  ];
  it.each(cases)('%s', (_n, m) => {
    for (const r of m.rows) {
      expect(m.states).toContain(r.from);
      expect(m.events).toContain(r.event);
      expect(r.to === '@prior' || m.states.includes(r.to)).toBe(true);
      expect(r.actor.length).toBeGreaterThan(0);
    }
  });
});

describe('no default-allow: every (state × event) is a row or a rejection', () => {
  // Contexts that make every guard true, so a rejection can only be structural.
  const sessionAll = sessionContext({
    consentedContactCount: 1, withinDestinationGeofence: true, deviationForMs: 1e9, deviationGraceMs: 1,
    offRouteDistanceM: 1e6, gpsAccuracyM: 1, resolutionImpossible: true, promptUnanswered: true,
    graceElapsedMs: 1e9, graceMs: 1, noIncidentRaisedYet: true, incidentTerminal: true,
  });
  const incidentAll = incidentContext({
    withinCountdown: true, duressCodeMatched: true, manualOrSafeword: true, consentedRecipients: 1,
    pending: 1, reached: 1, failed: 0, moreStepsRemain: true,
  });

  function sweep<S extends string, E extends string, C>(machine: Machine<S, E, C>, ctx: C) {
    for (const state of machine.states) {
      for (const event of machine.events) {
        const hasRow = machine.rows.some((r) => r.from === state && r.event === event);
        for (const by of ACTORS) {
          const out = apply(machine, { state, priorState: state }, event, { at: 1, by }, ctx);
          if (!hasRow) {
            expect(out.ok, `${state} --${event}--> should be rejected`).toBe(false);
            if (!out.ok) expect(out.rejection).toBe('ILLEGAL_TRANSITION');
          }
          if (!out.ok) expect(out.snapshot).toEqual({ state, priorState: state }); // never mutated
        }
      }
    }
  }

  it('SafetySession', () => sweep(SESSION_MACHINE, sessionAll));
  it('EmergencyIncident', () => sweep(INCIDENT_MACHINE, incidentAll));
  it('NotificationAttempt', () => {
    for (const ch of CHANNELS) {
      sweep(ATTEMPT_MACHINE, { capability: CHANNEL_CAPABILITIES[ch], evidence: CHANNEL_CAPABILITIES[ch].deliveredEvidence === 'none' ? undefined : CHANNEL_CAPABILITIES[ch].deliveredEvidence });
    }
  });
});

describe('the actor column is enforced', () => {
  function check<S extends string, E extends string, C>(machine: Machine<S, E, C>, ctx: C) {
    for (const r of machine.rows) {
      for (const by of ACTORS as readonly Actor[]) {
        // Rows sharing (from, event) may allow different actors; test per actor.
        const sameKey = machine.rows.filter((x) => x.from === r.from && x.event === r.event);
        const anyAllows = sameKey.some((x) => x.actor.includes(by));
        const out = apply(machine, { state: r.from, priorState: r.from }, r.event, { at: 1, by }, ctx);
        if (!anyAllows) {
          expect(out.ok).toBe(false);
          if (!out.ok) expect(out.rejection).toBe('ACTOR_NOT_PERMITTED');
        }
      }
    }
  }
  it('SafetySession', () => check(SESSION_MACHINE, sessionContext()));
  it('EmergencyIncident', () => check(INCIDENT_MACHINE, incidentContext()));
  it('NotificationAttempt', () => check(ATTEMPT_MACHINE, { capability: CHANNEL_CAPABILITIES.sms }));
});

describe('rows that share (state, event) never overlap and never leave a gap', () => {
  const bools = [false, true];
  const nums = [0, 1, 2];

  it('EmergencyIncident: ALL_SETTLED has exactly one outcome once the ladder is done, and none while it is not', () => {
    const rows = INCIDENT_MACHINE.rows.filter((r) => r.from === 'NOTIFYING' && r.event === 'ALL_SETTLED');
    expect(rows).toHaveLength(3);
    for (const pending of nums) for (const reached of nums) for (const failed of nums) for (const more of bools) {
      const ctx = incidentContext({ pending, reached, failed, moreStepsRemain: more });
      const matches = rows.filter((r) => r.guard!(ctx));
      expect(matches.length, JSON.stringify(ctx)).toBeLessThanOrEqual(1); // never overlap
      const done = pending === 0 && !more;
      if (done) expect(matches.length, `gap for ${JSON.stringify(ctx)}`).toBe(1); // never a gap
      else expect(matches).toHaveLength(0); // never settles early
    }
  });

  it('NotificationAttempt: SENT + TTL_ELAPSED is EXPIRED or UNKNOWN, never both, never neither', () => {
    const rows = ATTEMPT_MACHINE.rows.filter((r) => r.from === 'SENT' && r.event === 'TTL_ELAPSED');
    expect(rows).toHaveLength(2);
    for (const ch of CHANNELS) {
      const ctx = { capability: CHANNEL_CAPABILITIES[ch] };
      expect(rows.filter((r) => r.guard!(ctx))).toHaveLength(1);
    }
  });

  it('every other (state, event) with several rows has pairwise-exclusive guards', () => {
    const machines: [Machine<any, any, any>, any[]][] = [
      [SESSION_MACHINE, [sessionContext(), sessionContext({ consentedContactCount: 1 })]],
      [INCIDENT_MACHINE, [incidentContext()]],
      [ATTEMPT_MACHINE, CHANNELS.map((c) => ({ capability: CHANNEL_CAPABILITIES[c] }))],
    ];
    for (const [m, ctxs] of machines) {
      for (const s of m.states) for (const e of m.events) {
        const group = m.rows.filter((r: any) => r.from === s && r.event === e);
        if (group.length < 2) continue;
        for (const ctx of ctxs) {
          const hits = group.filter((r: any) => r.guard === undefined || r.guard(ctx));
          expect(hits.length, `${m.name} ${s}/${e}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('enum vocabularies', () => {
  it('have no duplicates', () => {
    for (const list of [SESSION_STATES, SESSION_EVENTS, INCIDENT_STATES, INCIDENT_EVENTS, ATTEMPT_STATES, ATTEMPT_EVENTS]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });
});
