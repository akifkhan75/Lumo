import { describe, expect, it } from 'vitest';
import { apply, type Snapshot } from './machine';
import { INCIDENT_MACHINE, INCIDENT_STATES, INCIDENT_EVENTS, INCIDENT_TERMINAL, LOCATING_TIMEBOX_MS, incidentContext, type IncidentState, type IncidentEvent, type IncidentContext } from './incident';
import type { Actor } from './types';

type Step = [IncidentEvent, Actor, Partial<IncidentContext>?];
function walk(start: IncidentState, steps: Step[], prior: IncidentState | null = null) {
  let snap: Snapshot<IncidentState> = { state: start, priorState: prior };
  const effects: string[] = [];
  let t = 0;
  for (const [event, by, ctx] of steps) {
    const out = apply(INCIDENT_MACHINE, snap, event, { at: (t += 100), by }, incidentContext(ctx));
    if (!out.ok) throw new Error(`${snap.state} --${event}--> rejected: ${out.rejection}`);
    snap = out.snapshot;
    effects.push(...out.record.effects);
  }
  return { snap, effects };
}
const attempt = (state: IncidentState, event: IncidentEvent, by: Actor, ctx: Partial<IncidentContext> = {}, prior: IncidentState | null = null) =>
  apply(INCIDENT_MACHINE, { state, priorState: prior }, event, { at: 1, by }, incidentContext(ctx));

describe('EmergencyIncident', () => {
  describe('the happy path', () => {
    it('countdown → locating → dispatching → notifying → notified → resolving → closed', () => {
      const { snap } = walk('CREATED', [
        ['COUNTDOWN_ELAPSED', 'system'],
        ['LOCATION_ACQUIRED', 'system'],
        ['RECIPIENTS_RESOLVED', 'system', { consentedRecipients: 2 }],
        ['ALL_SETTLED', 'system', { pending: 0, reached: 2, failed: 0, moreStepsRemain: false }],
        ['RESOLVE', 'user'],
        ['CLOSE', 'system'],
      ]);
      expect(snap.state).toBe('CLOSED');
    });

    it('a manual SOS or a safeword skips the countdown; other triggers cannot', () => {
      expect(walk('CREATED', [['COUNTDOWN_SKIPPED', 'user', { manualOrSafeword: true }]]).snap.state).toBe('LOCATING');
      expect(attempt('CREATED', 'COUNTDOWN_SKIPPED', 'user', { manualOrSafeword: false })).toMatchObject({ rejection: 'GUARD_FAILED' });
    });
  });

  describe('LOCATING never blocks dispatch (invariant 1)', () => {
    it('proceeds with "location unavailable" when no fix arrives', () => {
      const { snap, effects } = walk('LOCATING', [['LOCATION_TIMEOUT', 'system']]);
      expect(snap.state).toBe('DISPATCHING');
      expect(effects).toEqual(['markLocationUnavailable']);
    });

    it('can time out at any moment — a guard on elapsed time could let a skewed clock stall an emergency', () => {
      const row = INCIDENT_MACHINE.rows.find((r) => r.event === 'LOCATION_TIMEOUT')!;
      expect(row.guard).toBeUndefined();
    });

    it('exports the time box so every caller uses the same one', () => {
      expect(LOCATING_TIMEBOX_MS).toBe(5000);
    });

    it('a late fix does not re-enter LOCATING; the snapshot is updated, not the machine', () => {
      expect(attempt('DISPATCHING', 'LOCATION_ACQUIRED', 'system')).toMatchObject({ rejection: 'ILLEGAL_TRANSITION' });
    });
  });

  describe('dispatch', () => {
    it('with no consented recipient, fails loudly instead of notifying nobody quietly', () => {
      const { snap, effects } = walk('DISPATCHING', [['NO_RECIPIENTS', 'system', { consentedRecipients: 0 }]]);
      expect(snap.state).toBe('ALL_CHANNELS_FAILED');
      expect(effects).toEqual(['promptUserToDial']);
    });

    it('cannot claim there are no recipients when there are some, nor resolve recipients when there are none', () => {
      expect(attempt('DISPATCHING', 'NO_RECIPIENTS', 'system', { consentedRecipients: 1 })).toMatchObject({ rejection: 'GUARD_FAILED' });
      expect(attempt('DISPATCHING', 'RECIPIENTS_RESOLVED', 'system', { consentedRecipients: 0 })).toMatchObject({ rejection: 'GUARD_FAILED' });
    });
  });

  describe('settling: the ledger never invents certainty', () => {
    const done = { pending: 0, moreStepsRemain: false };
    it('every recipient reached → NOTIFIED (which is "sent", not "acknowledged")', () => {
      expect(walk('NOTIFYING', [['ALL_SETTLED', 'system', { ...done, reached: 3, failed: 0 }]]).snap.state).toBe('NOTIFIED');
    });
    it('some reached, some not → PARTIALLY_NOTIFIED, never success', () => {
      expect(walk('NOTIFYING', [['ALL_SETTLED', 'system', { ...done, reached: 2, failed: 1 }]]).snap.state).toBe('PARTIALLY_NOTIFIED');
    });
    it('nobody reached → ALL_CHANNELS_FAILED, paging on-call and prompting the user to dial', () => {
      const { snap, effects } = walk('NOTIFYING', [['ALL_SETTLED', 'system', { ...done, reached: 0, failed: 3 }]]);
      expect(snap.state).toBe('ALL_CHANNELS_FAILED');
      expect(effects).toEqual(['pageOnCall', 'promptUserToDial']);
    });
    it('attempts still pending keep the incident in NOTIFYING', () => {
      expect(walk('NOTIFYING', [['ATTEMPT_SETTLED', 'system', { pending: 1 }]]).snap.state).toBe('NOTIFYING');
    });
    it('does not settle while attempts are in flight', () => {
      expect(attempt('NOTIFYING', 'ALL_SETTLED', 'system', { pending: 1, reached: 1, moreStepsRemain: false })).toMatchObject({ rejection: 'GUARD_FAILED' });
    });
    it('does not declare ALL_CHANNELS_FAILED while escalation steps remain — the next step has not run yet', () => {
      // The first step's recipients all failed, but step 2 is still to be dispatched.
      expect(attempt('NOTIFYING', 'ALL_SETTLED', 'system', { pending: 0, reached: 0, failed: 2, moreStepsRemain: true })).toMatchObject({ rejection: 'GUARD_FAILED' });
    });
    it('keeps NOTIFYING through that gap instead, so the ladder can continue', () => {
      expect(walk('NOTIFYING', [['ATTEMPT_SETTLED', 'system', { pending: 0, reached: 0, failed: 2, moreStepsRemain: true }]]).snap.state).toBe('NOTIFYING');
    });
    it('a settle event with nothing left to come is not an ATTEMPT_SETTLED — it is ALL_SETTLED', () => {
      expect(attempt('NOTIFYING', 'ATTEMPT_SETTLED', 'system', { pending: 0, reached: 1, moreStepsRemain: false })).toMatchObject({ rejection: 'GUARD_FAILED' });
    });
    it('advances the ladder on a step timeout only while steps remain', () => {
      expect(walk('NOTIFYING', [['STEP_TIMEOUT', 'policy', { moreStepsRemain: true }]]).effects).toEqual(['advanceEscalationStep']);
      expect(attempt('NOTIFYING', 'STEP_TIMEOUT', 'policy', { moreStepsRemain: false })).toMatchObject({ rejection: 'GUARD_FAILED' });
    });
    it('a step timeout is a policy event, never a user one', () => {
      expect(attempt('NOTIFYING', 'STEP_TIMEOUT', 'user', { moreStepsRemain: true })).toMatchObject({ rejection: 'ACTOR_NOT_PERMITTED' });
    });
  });

  describe('acknowledgement', () => {
    it.each(['NOTIFYING', 'PARTIALLY_NOTIFIED', 'NOTIFIED', 'ALL_CHANNELS_FAILED'] as const)('from %s: halts the ladder immediately and tells the user', (from) => {
      const { snap, effects } = walk(from, [['ACK_RECEIVED', 'contact']]);
      expect(snap).toEqual({ state: 'ACKNOWLEDGED', priorState: from });
      expect(effects).toEqual(['haltEscalation', 'notifyUserOfAck']);
    });

    it('only a contact can acknowledge', () => {
      for (const by of ['user', 'system', 'policy'] as const) {
        expect(attempt('NOTIFYING', 'ACK_RECEIVED', by)).toMatchObject({ rejection: 'ACTOR_NOT_PERMITTED' });
      }
    });

    it('an un-acknowledgement resumes from the state it interrupted, so the user is not stranded', () => {
      const { snap, effects } = walk('NOTIFIED', [['ACK_RECEIVED', 'contact'], ['UNACK_RECEIVED', 'contact']]);
      expect(snap).toEqual({ state: 'NOTIFIED', priorState: null });
      expect(effects).toContain('resumeEscalation');
    });

    it('refuses to resume when it has no recorded state to return to', () => {
      expect(attempt('ACKNOWLEDGED', 'UNACK_RECEIVED', 'contact', {}, null)).toMatchObject({ rejection: 'NO_PRIOR_STATE' });
    });

    it('a second acknowledgement is a rejection the caller must treat as benign, not a new transition', () => {
      // §6a defines no ACKNOWLEDGED + ACK_RECEIVED row. Two contacts answering is normal.
      const out = attempt('ACKNOWLEDGED', 'ACK_RECEIVED', 'contact', {}, 'NOTIFIED');
      expect(out).toMatchObject({ ok: false, rejection: 'ILLEGAL_TRANSITION' });
      expect(out.snapshot).toEqual({ state: 'ACKNOWLEDGED', priorState: 'NOTIFIED' });
    });
  });

  describe('countdown and cancel (invariant 7)', () => {
    it('can be cancelled during the countdown', () => {
      const { snap, effects } = walk('CREATED', [['CANCEL', 'user', { withinCountdown: true }]]);
      expect(snap.state).toBe('CANCELLED');
      expect(effects).toEqual(['stopCountdown']);
    });
    it('cannot be cancelled once the countdown has passed', () => {
      expect(attempt('CREATED', 'CANCEL', 'user', { withinCountdown: false })).toMatchObject({ rejection: 'GUARD_FAILED' });
    });
    it('a contact cannot cancel an incident', () => {
      expect(attempt('CREATED', 'CANCEL', 'contact', { withinCountdown: true })).toMatchObject({ rejection: 'ACTOR_NOT_PERMITTED' });
    });
  });

  describe('duress: the device shows a cancellation, the incident proceeds (invariant 8)', () => {
    it('a duress cancel does NOT go to CANCELLED — it goes on to LOCATING, silently', () => {
      const { snap, effects } = walk('CREATED', [['DURESS_CANCEL', 'user', { duressCodeMatched: true }]]);
      expect(snap.state).toBe('LOCATING');
      expect(snap.state).not.toBe('CANCELLED');
      expect(effects).toEqual(['markDuress', 'suppressAllDeviceUi']);
    });
    it('only with the duress code', () => {
      expect(attempt('CREATED', 'DURESS_CANCEL', 'user', { duressCodeMatched: false })).toMatchObject({ rejection: 'GUARD_FAILED' });
    });
    it('a duress cancel is still only possible at CREATED, like any cancel', () => {
      for (const s of INCIDENT_STATES.filter((s) => s !== 'CREATED')) {
        expect(attempt(s, 'DURESS_CANCEL', 'user', { duressCodeMatched: true }).ok).toBe(false);
      }
    });
  });

  describe('resolution', () => {
    it.each(['NOTIFYING', 'PARTIALLY_NOTIFIED', 'NOTIFIED', 'ALL_CHANNELS_FAILED', 'ACKNOWLEDGED'] as const)('from %s: halts escalation and tells contacts it ended', (from) => {
      const { snap, effects } = walk(from, [['RESOLVE', 'user']]);
      expect(snap.state).toBe('RESOLVING');
      expect(effects).toEqual(['haltEscalation', 'notifyContactsResolved']);
    });
    it('closing seals the timeline', () => {
      expect(walk('RESOLVING', [['CLOSE', 'system']]).effects).toEqual(['sealTimeline']);
    });
  });

  describe('deliberate rejections — each one is a safety decision', () => {
    it('CANCEL from any state after CREATED: after dispatch there is no cancel, only RESOLVE', () => {
      for (const s of INCIDENT_STATES.filter((s) => s !== 'CREATED')) {
        for (const by of ['user', 'system', 'policy', 'contact'] as const) {
          expect(attempt(s, 'CANCEL', by, { withinCountdown: true }).ok, `${s}/${by}`).toBe(false);
        }
      }
    });
    it('LOCATING → CANCELLED: dispatch has begun', () => {
      expect(attempt('LOCATING', 'CANCEL', 'user', { withinCountdown: true })).toMatchObject({ rejection: 'ILLEGAL_TRANSITION' });
    });
    it('any state → LOCATING (re-entry): location refreshes update the snapshot, not the machine', () => {
      for (const s of INCIDENT_STATES.filter((s) => s !== 'CREATED')) {
        for (const e of INCIDENT_EVENTS) {
          const out = attempt(s, e, 'system', { duressCodeMatched: true, manualOrSafeword: true });
          if (out.ok) expect(out.snapshot.state).not.toBe('LOCATING');
        }
      }
    });
    it('ALL_CHANNELS_FAILED → NOTIFIED: a later success is a new attempt, not a rewrite', () => {
      expect(attempt('ALL_CHANNELS_FAILED', 'ALL_SETTLED', 'system', { reached: 1, moreStepsRemain: false })).toMatchObject({ rejection: 'ILLEGAL_TRANSITION' });
    });
    it.each(INCIDENT_TERMINAL)('%s is terminal: the timeline is sealed evidence', (terminal) => {
      for (const e of INCIDENT_EVENTS) for (const by of ['user', 'system', 'policy', 'contact'] as const) {
        expect(attempt(terminal, e, by, { withinCountdown: true, duressCodeMatched: true, manualOrSafeword: true, consentedRecipients: 1 }).ok).toBe(false);
      }
    });
  });

  it('a context nobody filled in cannot cancel, settle, resolve or complete anything', () => {
    // Defaults must fail safe. The guards that ARE true on an empty context are
    // the ones that keep the incident going or fail loudly: "nothing is settled
    // yet, a step remains" (ATTEMPT_SETTLED, STEP_TIMEOUT) and "there is nobody to
    // notify" (NO_RECIPIENTS, which prompts the user to dial).
    const SAFE_TO_PASS_BY_DEFAULT = ['ATTEMPT_SETTLED', 'STEP_TIMEOUT', 'NO_RECIPIENTS'];
    for (const r of INCIDENT_MACHINE.rows.filter((r) => r.guard)) {
      if (r.guard!(incidentContext())) expect(SAFE_TO_PASS_BY_DEFAULT, `${r.from} ${r.event}`).toContain(r.event);
    }
  });
});
