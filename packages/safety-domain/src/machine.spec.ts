import { describe, expect, it } from 'vitest';
import { apply, initialSnapshot, rowsFrom, PRIOR_STATE, type Machine } from './machine';
import { SESSION_MACHINE, sessionContext } from './session';

describe('apply', () => {
  const ctx = sessionContext({ consentedContactCount: 1 });

  it('records when, by whom and why on every transition (invariant 10)', () => {
    const out = apply(SESSION_MACHINE, initialSnapshot('CREATED'), 'START', { at: 1700, by: 'user', reason: 'tapped start' }, ctx);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.record).toEqual({
        from: 'CREATED', event: 'START', to: 'ACTIVE', at: 1700, by: 'user', reason: 'tapped start',
        effects: ['startTimers', 'notifyContactsSessionStarted'],
      });
    }
  });

  it('records a null reason when none is given', () => {
    const out = apply(SESSION_MACHINE, initialSnapshot('CREATED'), 'CANCEL', { at: 1, by: 'user' }, ctx);
    expect(out.ok && out.record.reason).toBe(null);
  });

  it('is deterministic: the same inputs give the same outcome', () => {
    const run = () => apply(SESSION_MACHINE, initialSnapshot('CREATED'), 'START', { at: 9, by: 'user' }, ctx);
    expect(run()).toEqual(run());
  });

  it('does not mutate the snapshot it was given', () => {
    const before = initialSnapshot('CREATED');
    const frozen = Object.freeze({ ...before });
    apply(SESSION_MACHINE, frozen, 'START', { at: 1, by: 'user' }, ctx);
    expect(frozen).toEqual({ state: 'CREATED', priorState: null });
  });

  describe('rejections are distinct and leave the snapshot untouched', () => {
    const snap = initialSnapshot('CREATED');

    it('ILLEGAL_TRANSITION: no row for this (state, event)', () => {
      const out = apply(SESSION_MACHINE, snap, 'CLOSE', { at: 5, by: 'system' }, ctx);
      expect(out).toMatchObject({ ok: false, rejection: 'ILLEGAL_TRANSITION', from: 'CREATED', event: 'CLOSE', at: 5, by: 'system' });
      expect(out.snapshot).toBe(snap);
    });

    it('ACTOR_NOT_PERMITTED: a row exists, but not for this actor', () => {
      const out = apply(SESSION_MACHINE, snap, 'START', { at: 5, by: 'contact' }, ctx);
      expect(out).toMatchObject({ ok: false, rejection: 'ACTOR_NOT_PERMITTED' });
    });

    it('GUARD_FAILED: a row exists for this actor, but its condition does not hold', () => {
      const out = apply(SESSION_MACHINE, snap, 'START', { at: 5, by: 'user' }, sessionContext({ consentedContactCount: 0 }));
      expect(out).toMatchObject({ ok: false, rejection: 'GUARD_FAILED' });
    });

    it('carries the reason through a rejection, so it can be logged', () => {
      const out = apply(SESSION_MACHINE, snap, 'CLOSE', { at: 5, by: 'system', reason: 'late replay' }, ctx);
      expect(out).toMatchObject({ ok: false, reason: 'late replay' });
    });
  });

  describe('the prior state', () => {
    it('is remembered when entering SUSPENDED, and restored on return', () => {
      const active = { state: 'ACTIVE', priorState: null } as const;
      const lost = apply(SESSION_MACHINE, active, 'CONNECTIVITY_LOST', { at: 1, by: 'system' }, ctx);
      expect(lost.ok && lost.snapshot).toEqual({ state: 'SUSPENDED', priorState: 'ACTIVE' });

      const back = lost.ok && apply(SESSION_MACHINE, lost.snapshot, 'CONNECTIVITY_RESTORED', { at: 2, by: 'system' }, ctx);
      expect(back && back.ok && back.snapshot).toEqual({ state: 'ACTIVE', priorState: null });
      expect(back && back.ok && back.record.to).toBe('ACTIVE');
    });

    it('is cleared when leaving for somewhere else', () => {
      const out = apply(SESSION_MACHINE, { state: 'SUSPENDED', priorState: 'GRACE' }, 'CANCEL', { at: 1, by: 'user' }, ctx);
      expect(out.ok && out.snapshot).toEqual({ state: 'CANCELLED', priorState: null });
    });

    it('NO_PRIOR_STATE: refuses to return to a state that was never recorded', () => {
      const out = apply(SESSION_MACHINE, { state: 'SUSPENDED', priorState: null }, 'CONNECTIVITY_RESTORED', { at: 1, by: 'system' }, ctx);
      expect(out).toMatchObject({ ok: false, rejection: 'NO_PRIOR_STATE' });
    });
  });
});

describe('rowsFrom', () => {
  it('expands several source states into one row each', () => {
    const rows = rowsFrom<'A' | 'B' | 'C', 'GO', null>(['A', 'B'], 'GO', 'C', ['user'], { effects: ['x'] });
    expect(rows.map((r) => r.from)).toEqual(['A', 'B']);
    expect(rows.every((r) => r.to === 'C' && r.effects[0] === 'x')).toBe(true);
  });

  it('accepts a single source state, and defaults to no effects and no guard', () => {
    const [r] = rowsFrom<'A' | 'B', 'GO', null>('A', 'GO', PRIOR_STATE, ['system']);
    expect(r).toMatchObject({ from: 'A', to: PRIOR_STATE, effects: [], guard: undefined });
  });
});

describe('a machine with no memory', () => {
  it('has nothing to remember, so priorState stays null', () => {
    const m: Machine<'A' | 'B', 'GO', null> = {
      name: 't', states: ['A', 'B'], events: ['GO'], rememberPriorOn: [],
      rows: rowsFrom('A', 'GO', 'B', ['user']),
    };
    const out = apply(m, initialSnapshot('A'), 'GO', { at: 1, by: 'user' }, null);
    expect(out.ok && out.snapshot).toEqual({ state: 'B', priorState: null });
  });
});
