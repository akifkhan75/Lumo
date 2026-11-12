import { describe, expect, it } from 'vitest';
import { replay, type QueuedEvent } from './replay';
import { initialSnapshot } from './machine';
import { SESSION_MACHINE, sessionContext, type SessionContext, type SessionEvent } from './session';
import { INCIDENT_MACHINE, incidentContext, type IncidentContext, type IncidentEvent } from './incident';
import { idempotencyKey } from './idempotency';

const NOW = 1_000_000;
const s = (event: SessionEvent, at: number, ctx: Partial<SessionContext> = {}, extra: Partial<QueuedEvent<SessionEvent, SessionContext>> = {}): QueuedEvent<SessionEvent, SessionContext> =>
  ({ event, at, by: 'system', ctx: sessionContext(ctx), ...extra });

describe('replay (offline reconciliation, §5)', () => {
  describe('order', () => {
    it('applies events in original OCCURRENCE order, not the order they were queued', () => {
      const queue = [
        s('CONNECTIVITY_RESTORED', 300),
        s('CONNECTIVITY_LOST', 100),
      ];
      const r = replay(SESSION_MACHINE, initialSnapshot('ACTIVE'), queue, NOW);
      expect(r.applied.map((a) => a.event)).toEqual(['CONNECTIVITY_LOST', 'CONNECTIVITY_RESTORED']);
      expect(r.snapshot.state).toBe('ACTIVE');
      expect(r.conflicts).toEqual([]);
    });

    it('keeps queue order for events with the same timestamp', () => {
      const queue = [s('CHECK_IN_DEADLINE_REACHED', 100), s('NO_RESPONSE', 100, { promptUnanswered: true })];
      expect(replay(SESSION_MACHINE, initialSnapshot('ACTIVE'), queue, NOW).snapshot.state).toBe('GRACE');
    });

    it('does not mutate the queue it was given', () => {
      const queue = Object.freeze([s('CONNECTIVITY_RESTORED', 300), s('CONNECTIVITY_LOST', 100)]);
      expect(() => replay(SESSION_MACHINE, initialSnapshot('ACTIVE'), queue, NOW)).not.toThrow();
    });
  });

  describe('a late event is still applied, and its delay is stated', () => {
    it('grace expiring while offline escalates on reconnect, marked delayed', () => {
      const queue = [
        s('CONNECTIVITY_LOST', 1_000),
        s('GRACE_EXPIRED', 2_000, { graceElapsedMs: 300_000, graceMs: 300_000 }),
      ];
      const r = replay(SESSION_MACHINE, initialSnapshot('GRACE'), queue, 902_000);
      expect(r.snapshot.state).toBe('ESCALATING');
      const escalation = r.applied.find((a) => a.event === 'GRACE_EXPIRED')!;
      expect(escalation.effects).toContain('queueEscalation');
      expect(escalation.delayedMs).toBe(900_000);
      expect(escalation.at).toBe(2_000); // the true occurrence time, never the sync time
    });

    it('an event that is not late is not marked as delayed', () => {
      const r = replay(SESSION_MACHINE, initialSnapshot('ACTIVE'), [s('CONNECTIVITY_LOST', NOW)], NOW);
      expect(r.applied[0].delayedMs).toBe(0);
    });

    it('never reports a negative delay when the device clock ran ahead', () => {
      const r = replay(SESSION_MACHINE, initialSnapshot('ACTIVE'), [s('CONNECTIVITY_LOST', NOW + 50_000)], NOW);
      expect(r.applied[0].delayedMs).toBe(0);
    });
  });

  describe('a session suspended then resumed', () => {
    it('returns to the prior state with no spurious escalation', () => {
      const queue = [s('CONNECTIVITY_LOST', 100), s('CONNECTIVITY_RESTORED', 200)];
      const r = replay(SESSION_MACHINE, initialSnapshot('GRACE'), queue, NOW);
      expect(r.snapshot).toEqual({ state: 'GRACE', priorState: null });
      expect(r.applied.flatMap((a) => a.effects)).not.toContain('beginEscalation');
    });
  });

  describe('events illegal on arrival are never silently dropped', () => {
    it('are reported as RECONCILIATION_CONFLICT, with why, and the rest still apply', () => {
      const queue = [
        s('CONNECTIVITY_LOST', 100),
        s('CHECK_IN_DEADLINE_REACHED', 150), // illegal while suspended: no such row
        s('CONNECTIVITY_RESTORED', 200),
      ];
      const r = replay(SESSION_MACHINE, initialSnapshot('ACTIVE'), queue, NOW, );
      expect(r.conflicts).toEqual([{
        code: 'RECONCILIATION_CONFLICT', rejection: 'ILLEGAL_TRANSITION', from: 'SUSPENDED',
        event: 'CHECK_IN_DEADLINE_REACHED', at: 150, by: 'system', reason: null,
      }]);
      expect(r.snapshot.state).toBe('ACTIVE');
      expect(r.applied).toHaveLength(2);
    });

    it('carries the reason of the rejected event so it can be shown in the timeline', () => {
      const r = replay(SESSION_MACHINE, initialSnapshot('CLOSED'), [s('CANCEL', 10, {}, { by: 'user', reason: 'user tapped cancel offline' })], NOW);
      expect(r.conflicts[0]).toMatchObject({ rejection: 'ILLEGAL_TRANSITION', reason: 'user tapped cancel offline' });
    });

    it('a guard that fails on arrival is a conflict too', () => {
      const r = replay(SESSION_MACHINE, initialSnapshot('GRACE'), [s('GRACE_EXPIRED', 10, { graceElapsedMs: 1, graceMs: 300_000 })], NOW);
      expect(r.conflicts[0].rejection).toBe('GUARD_FAILED');
    });
  });

  describe('deduplication by idempotency key', () => {
    const inc = (event: IncidentEvent, at: number, ctx: Partial<IncidentContext>, key?: string): QueuedEvent<IncidentEvent, IncidentContext> =>
      ({ event, at, by: 'system', ctx: incidentContext(ctx), idempotencyKey: key });

    it('the same activation retried five times, offline then online, applies exactly once', () => {
      const key = idempotencyKey({ userId: 'u1', triggerType: 'shake', triggerAtMs: 1_700_000_000_000 });
      const queue = Array.from({ length: 5 }, (_, i) => inc('COUNTDOWN_ELAPSED', 100 + i, {}, key));
      const r = replay(INCIDENT_MACHINE, initialSnapshot('CREATED'), queue, NOW);
      expect(r.applied).toHaveLength(1);
      expect(r.duplicates).toBe(4);
      expect(r.conflicts).toEqual([]);
      expect(r.snapshot.state).toBe('LOCATING');
    });

    it('keeps the earliest occurrence of a duplicated key', () => {
      const queue = [inc('COUNTDOWN_ELAPSED', 300, {}, 'k'), inc('COUNTDOWN_ELAPSED', 100, {}, 'k')];
      expect(replay(INCIDENT_MACHINE, initialSnapshot('CREATED'), queue, NOW).applied[0].at).toBe(100);
    });

    it('never deduplicates events that carry no key', () => {
      const queue = [inc('ATTEMPT_SETTLED', 1, { pending: 1 }), inc('ATTEMPT_SETTLED', 2, { pending: 1 })];
      const r = replay(INCIDENT_MACHINE, initialSnapshot('NOTIFYING'), queue, NOW);
      expect(r.applied).toHaveLength(2);
      expect(r.duplicates).toBe(0);
    });

    it('does not merge different keys', () => {
      const queue = [inc('ATTEMPT_SETTLED', 1, { pending: 1 }, 'a'), inc('ATTEMPT_SETTLED', 2, { pending: 1 }, 'b')];
      expect(replay(INCIDENT_MACHINE, initialSnapshot('NOTIFYING'), queue, NOW).applied).toHaveLength(2);
    });
  });

  describe('required scenarios (§7) that the domain can prove', () => {
    it('location never acquired: the incident still dispatches, with "location unavailable"', () => {
      const queue: QueuedEvent<IncidentEvent, IncidentContext>[] = [
        { event: 'COUNTDOWN_ELAPSED', at: 1, by: 'system', ctx: incidentContext() },
        { event: 'LOCATION_TIMEOUT', at: 5_001, by: 'system', ctx: incidentContext() },
        { event: 'RECIPIENTS_RESOLVED', at: 5_002, by: 'system', ctx: incidentContext({ consentedRecipients: 2 }) },
      ];
      const r = replay(INCIDENT_MACHINE, initialSnapshot('CREATED'), queue, NOW);
      expect(r.snapshot.state).toBe('NOTIFYING');
      expect(r.applied.flatMap((a) => a.effects)).toContain('markLocationUnavailable');
    });

    it('all channels fail: the incident ends in ALL_CHANNELS_FAILED, prompting a call, never in success', () => {
      const queue: QueuedEvent<IncidentEvent, IncidentContext>[] = [
        { event: 'ALL_SETTLED', at: 1, by: 'system', ctx: incidentContext({ pending: 0, reached: 0, failed: 3, moreStepsRemain: false }) },
      ];
      const r = replay(INCIDENT_MACHINE, initialSnapshot('NOTIFYING'), queue, NOW);
      expect(r.snapshot.state).toBe('ALL_CHANNELS_FAILED');
      expect(r.applied[0].effects).toEqual(['pageOnCall', 'promptUserToDial']);
    });

    it('an acknowledgement during escalation halts the ladder', () => {
      const r = replay(INCIDENT_MACHINE, initialSnapshot('NOTIFYING'), [{ event: 'ACK_RECEIVED', at: 1, by: 'contact', ctx: incidentContext() }], NOW);
      expect(r.applied[0].effects).toContain('haltEscalation');
    });
  });
});
