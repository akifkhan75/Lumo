import { describe, expect, it } from 'vitest';
import { apply, type Snapshot } from './machine';
import { SESSION_MACHINE, SESSION_STATES, SESSION_EVENTS, SESSION_TERMINAL, sessionContext, type SessionState, type SessionEvent, type SessionContext } from './session';

/** Drive the session through a list of steps, failing the test on any rejection. */
function walk(start: SessionState, steps: [SessionEvent, 'user' | 'system' | 'policy' | 'contact', Partial<SessionContext>?][]) {
  let snap: Snapshot<SessionState> = { state: start, priorState: null };
  const effects: string[] = [];
  let t = 1000;
  for (const [event, by, ctx] of steps) {
    const out = apply(SESSION_MACHINE, snap, event, { at: (t += 1000), by }, sessionContext(ctx));
    if (!out.ok) throw new Error(`${snap.state} --${event}--> rejected: ${out.rejection}`);
    snap = out.snapshot;
    effects.push(...out.record.effects);
  }
  return { snap, effects };
}
const reject = (state: SessionState, event: SessionEvent, by: 'user' | 'system' | 'policy' | 'contact' = 'system', ctx: Partial<SessionContext> = {}) =>
  apply(SESSION_MACHINE, { state, priorState: null }, event, { at: 1, by }, sessionContext(ctx));

describe('SafetySession', () => {
  describe('the journey from start to arrival', () => {
    it('starts only with at least one consented contact', () => {
      expect(reject('CREATED', 'START', 'user', { consentedContactCount: 0 })).toMatchObject({ rejection: 'GUARD_FAILED' });
      expect(walk('CREATED', [['START', 'user', { consentedContactCount: 1 }]]).snap.state).toBe('ACTIVE');
    });

    it('arrival by geofence needs the geofence; arrival by confirmation does not', () => {
      expect(reject('ACTIVE', 'ARRIVAL_DETECTED', 'system', { withinDestinationGeofence: false })).toMatchObject({ rejection: 'GUARD_FAILED' });
      expect(walk('ACTIVE', [['ARRIVAL_DETECTED', 'system', { withinDestinationGeofence: true }]]).snap.state).toBe('ARRIVED');
      expect(walk('ACTIVE', [['ARRIVAL_CONFIRMED', 'user']]).snap.state).toBe('ARRIVED');
    });

    it('arrival is never decided by a timer alone (invariant 4)', () => {
      // Every route into ARRIVED is either geofence detection, which has a guard,
      // or a person confirming. No other event, and no policy/timer actor, gets there.
      const toArrived = SESSION_MACHINE.rows.filter((r) => r.to === 'ARRIVED');
      expect(toArrived.length).toBeGreaterThan(0);
      for (const r of toArrived) {
        if (r.event === 'ARRIVAL_DETECTED') {
          expect(r.guard).toBeDefined();
          expect(r.actor).toEqual(['system']);
        } else {
          expect(r.event).toBe('ARRIVAL_CONFIRMED');
          expect(r.actor).toEqual(['user']);
        }
      }
    });

    it('an arrived session closes and tells contacts', () => {
      const { snap, effects } = walk('ACTIVE', [['ARRIVAL_CONFIRMED', 'user'], ['CLOSE', 'system']]);
      expect(snap.state).toBe('CLOSED');
      expect(effects).toContain('notifyContactsArrived');
    });
  });

  describe('check-in, grace and escalation', () => {
    it('walks CHECK_IN_DUE → GRACE → ESCALATING, never skipping grace', () => {
      const { snap } = walk('ACTIVE', [
        ['CHECK_IN_DEADLINE_REACHED', 'system'],
        ['NO_RESPONSE', 'system', { promptUnanswered: true }],
        ['GRACE_EXPIRED', 'system', { graceElapsedMs: 300_000, graceMs: 300_000 }],
      ]);
      expect(snap.state).toBe('ESCALATING');
    });

    it('grace does not expire early', () => {
      expect(reject('GRACE', 'GRACE_EXPIRED', 'system', { graceElapsedMs: 299_999, graceMs: 300_000 })).toMatchObject({ rejection: 'GUARD_FAILED' });
    });

    it('a prompt the user already answered does not start grace', () => {
      expect(reject('CHECK_IN_DUE', 'NO_RESPONSE', 'system', { promptUnanswered: false })).toMatchObject({ rejection: 'GUARD_FAILED' });
    });

    it('the user responding in CHECK_IN_DUE or GRACE returns to ACTIVE and reschedules', () => {
      for (const from of ['CHECK_IN_DUE', 'GRACE'] as const) {
        const { snap, effects } = walk(from, [['USER_RESPONDED', 'user']]);
        expect(snap.state).toBe('ACTIVE');
        expect(effects).toContain('rescheduleDeadline');
      }
    });

    it('an incident can only be raised through ESCALATING (invariant 3)', () => {
      const raisers = SESSION_MACHINE.rows.filter((r) => r.event === 'INCIDENT_RAISED');
      expect(raisers.map((r) => r.from)).toEqual(['ESCALATING']);
    });

    it('a user can still respond while escalating, but only before an incident exists', () => {
      expect(walk('ESCALATING', [['USER_RESPONDED', 'user', { noIncidentRaisedYet: true }]]).effects).toContain('haltEscalation');
      expect(reject('ESCALATING', 'USER_RESPONDED', 'user', { noIncidentRaisedYet: false })).toMatchObject({ rejection: 'GUARD_FAILED' });
    });

    it('arrival detected while escalating halts the escalation, closes, and tells contacts', () => {
      const { snap, effects } = walk('ESCALATING', [
        ['ARRIVAL_CONFIRMED', 'user', { noIncidentRaisedYet: true }],
        ['CLOSE', 'system'],
      ]);
      expect(snap.state).toBe('CLOSED');
      expect(effects).toEqual(['haltEscalation', 'notifyContactsArrived']);
    });

    it('an alerted session closes when its incident is terminal, or on arrival', () => {
      expect(walk('ALERTED', [['INCIDENT_RESOLVED', 'system', { incidentTerminal: true }]]).snap.state).toBe('CLOSED');
      expect(reject('ALERTED', 'INCIDENT_RESOLVED', 'system', { incidentTerminal: false })).toMatchObject({ rejection: 'GUARD_FAILED' });
      expect(walk('ALERTED', [['ARRIVAL_CONFIRMED', 'user']]).effects).toContain('resolveIncident');
    });

    it('an SOS from an active session raises an incident', () => {
      const { snap, effects } = walk('ACTIVE', [['SOS_RAISED', 'user']]);
      expect(snap.state).toBe('ALERTED');
      expect(effects).toEqual(['raiseIncident']);
    });
  });

  describe('deviation: a single off-route fix is not a diversion', () => {
    const base = { deviationGraceMs: 180_000, gpsAccuracyM: 20 };
    it('needs to persist beyond the grace AND be further out than the fix error', () => {
      expect(reject('ACTIVE', 'DEVIATION_DETECTED', 'system', { ...base, deviationForMs: 60_000, offRouteDistanceM: 500 })).toMatchObject({ rejection: 'GUARD_FAILED' });
      expect(reject('ACTIVE', 'DEVIATION_DETECTED', 'system', { ...base, deviationForMs: 400_000, offRouteDistanceM: 10 })).toMatchObject({ rejection: 'GUARD_FAILED' });
      expect(reject('ACTIVE', 'DEVIATION_DETECTED', 'system', { ...base, deviationForMs: 180_000, offRouteDistanceM: 500 })).toMatchObject({ rejection: 'GUARD_FAILED' });
    });
    it('a real deviation prompts the user discreetly and stays ACTIVE', () => {
      const { snap, effects } = walk('ACTIVE', [['DEVIATION_DETECTED', 'system', { ...base, deviationForMs: 400_000, offRouteDistanceM: 500 }]]);
      expect(snap.state).toBe('ACTIVE');
      expect(effects).toEqual(['promptUserDiscreetly']);
    });
  });

  describe('SUSPENDED: offline is stated, never hidden (invariant 2)', () => {
    it('can be entered from any live monitoring state, with an offline notice', () => {
      for (const from of ['ACTIVE', 'CHECK_IN_DUE', 'GRACE'] as const) {
        const { snap } = walk(from, [['CONNECTIVITY_LOST', 'system']]);
        expect(snap).toEqual({ state: 'SUSPENDED', priorState: from });
      }
      expect(walk('ACTIVE', [['CONNECTIVITY_LOST', 'system']]).effects).toContain('showOfflineNotice');
    });

    it('returns to the state it left, with no spurious escalation', () => {
      for (const from of ['ACTIVE', 'CHECK_IN_DUE', 'GRACE'] as const) {
        const { snap, effects } = walk(from, [['CONNECTIVITY_LOST', 'system'], ['CONNECTIVITY_RESTORED', 'system']]);
        expect(snap).toEqual({ state: from, priorState: null });
        expect(effects).not.toContain('beginEscalation');
        expect(effects).not.toContain('queueEscalation');
      }
    });

    it('grace expiring while offline queues the escalation — dispatched on reconnect', () => {
      const { snap, effects } = walk('GRACE', [['CONNECTIVITY_LOST', 'system'], ['GRACE_EXPIRED', 'system']]);
      expect(snap.state).toBe('ESCALATING');
      expect(effects).toContain('queueEscalation');
    });

    it('arrival or cancellation while offline are queued for sending', () => {
      expect(walk('SUSPENDED', [['ARRIVAL_CONFIRMED', 'user']]).effects).toEqual(['queueArrivalNotice']);
      expect(walk('SUSPENDED', [['CANCEL', 'user']]).effects).toEqual(['queueEndNotice']);
    });
  });

  describe('deliberate rejections — each one is a safety decision', () => {
    it('ARRIVED → anything but CLOSE: arrival is final, a new journey is a new session', () => {
      for (const e of SESSION_EVENTS.filter((e) => e !== 'CLOSE')) {
        expect(reject('ARRIVED', e, 'user')).toMatchObject({ ok: false });
        expect(reject('ARRIVED', e, 'system')).toMatchObject({ ok: false });
      }
    });

    it.each(SESSION_TERMINAL)('%s is terminal: reopening would corrupt the audit record', (terminal) => {
      for (const e of SESSION_EVENTS) for (const by of ['user', 'system', 'policy', 'contact'] as const) {
        expect(reject(terminal, e, by).ok).toBe(false);
      }
    });

    it('CREATED → CHECK_IN_DUE: a session that never started has no deadline', () => {
      expect(reject('CREATED', 'CHECK_IN_DEADLINE_REACHED')).toMatchObject({ rejection: 'ILLEGAL_TRANSITION' });
    });

    it('ACTIVE → ESCALATING: must pass through CHECK_IN_DUE and GRACE — skipping grace escalates a late bus', () => {
      for (const e of SESSION_EVENTS) {
        const out = reject('ACTIVE', e, 'system', { graceElapsedMs: 1e9, graceMs: 1, noIncidentRaisedYet: true, resolutionImpossible: true, withinDestinationGeofence: true });
        if (out.ok) expect(out.snapshot.state).not.toBe('ESCALATING');
      }
    });

    it('SUSPENDED → SUSPENDED: an idempotent no-op, not a transition', () => {
      const out = reject('SUSPENDED', 'CONNECTIVITY_LOST');
      expect(out).toMatchObject({ ok: false, rejection: 'ILLEGAL_TRANSITION' });
      expect(out.snapshot.state).toBe('SUSPENDED');
    });

    it('a contact cannot cancel someone else’s session', () => {
      expect(reject('ACTIVE', 'CANCEL', 'contact')).toMatchObject({ rejection: 'ACTOR_NOT_PERMITTED' });
    });
  });

  it('EXPIRE needs a session that genuinely cannot resolve (e.g. permissions revoked)', () => {
    expect(reject('ACTIVE', 'EXPIRE', 'system', { resolutionImpossible: false })).toMatchObject({ rejection: 'GUARD_FAILED' });
    expect(walk('ACTIVE', [['EXPIRE', 'system', { resolutionImpossible: true }]]).effects).toEqual(['notifyContactsExpired']);
  });

  it('a context nobody filled in rejects rather than allows', () => {
    // sessionContext() defaults every guard to its failing value.
    for (const r of SESSION_MACHINE.rows.filter((r) => r.guard)) {
      expect(r.guard!(sessionContext()), `${r.from} ${r.event}`).toBe(false);
    }
  });

  it('has a state for every vocabulary entry', () => {
    expect(SESSION_STATES).toHaveLength(11);
  });
});
