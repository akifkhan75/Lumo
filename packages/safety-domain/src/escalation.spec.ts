import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRACE_SECONDS, INITIAL_LADDER, MIN_GRACE_SECONDS, TEMPLATE_DEFAULTS,
  describePolicy, policyFromTemplate, stepLadder, validatePolicy,
  type Decision, type Directory, type EscalationPolicy, type LadderEvent, type LadderInput, type LadderState,
} from './escalation';
import { SESSION_KINDS } from './types';

const T0 = 1_000_000;
const contact = (id: string) => ({ kind: 'contact' as const, id });
const everyoneConsents = (...ids: string[]): Directory => ({
  contacts: Object.fromEntries(ids.map((id) => [id, { consented: true }])),
  circles: {},
});

const policy = (overrides: Partial<EscalationPolicy> = {}): EscalationPolicy => ({
  id: 'p1', name: 'Test', graceSeconds: 300,
  steps: [
    { order: 1, recipients: [contact('maya')], channels: ['push', 'sms'], timeoutSeconds: 120, requireAck: true },
    { order: 2, recipients: [contact('dad')], channels: ['push', 'sms'], timeoutSeconds: 120, requireAck: true },
    { order: 3, recipients: [contact('mum')], channels: ['sms'], timeoutSeconds: 120, requireAck: true },
  ],
  maxRecipientsPerIncident: 5, stopOnAcknowledgement: true, resumeOnUnacknowledge: true,
  promptEmergencyNumberOnFailure: true, deviationGraceSeconds: 180,
  ...overrides,
});

const input = (p: EscalationPolicy, extra: Partial<LadderInput> = {}): LadderInput => ({
  policy: p, directory: everyoneConsents('maya', 'dad', 'mum', 'gran'), now: T0, spendCapRecipientsRemaining: null, ...extra,
});

/** Feed events in, collecting every decision, failing on any rejected event. */
function drive(p: EscalationPolicy, events: [LadderEvent, number?, Partial<LadderInput>?][], start: LadderState = INITIAL_LADDER) {
  let state = start;
  const all: Decision[] = [];
  for (const [event, now, extra] of events) {
    const r = stepLadder(state, event, input(p, { now: now ?? T0, ...extra }));
    if (!r.ok) throw new Error(`${event.type} rejected: ${r.error}`);
    state = r.state;
    all.push(...r.decisions);
  }
  return { state, decisions: all };
}
const of = <T extends Decision['type']>(ds: readonly Decision[], type: T) => ds.filter((d): d is Extract<Decision, { type: T }> => d.type === type);
const dispatched = (ds: readonly Decision[]) => of(ds, 'DISPATCH').map((d) => d.recipientId);

describe('policy validation', () => {
  it('accepts a sound policy', () => {
    expect(validatePolicy(policy())).toEqual([]);
  });

  it('rejects a grace below the minimum — it is enforced, not advised', () => {
    for (const graceSeconds of [0, 1, 59, -5, NaN]) {
      expect(validatePolicy(policy({ graceSeconds })).map((i) => i.code), String(graceSeconds)).toContain('GRACE_TOO_SHORT');
    }
    expect(validatePolicy(policy({ graceSeconds: MIN_GRACE_SECONDS }))).toEqual([]);
  });

  it('refuses to START a policy that fails validation', () => {
    const r = stepLadder(INITIAL_LADDER, { type: 'START' }, input(policy({ graceSeconds: 0 })));
    expect(r).toMatchObject({ ok: false, error: 'INVALID_POLICY' });
  });

  it.each([
    ['no steps', { steps: [] }, 'NO_STEPS'],
    ['out-of-order steps', { steps: [{ order: 2, recipients: [contact('a')], channels: ['push'], timeoutSeconds: 60, requireAck: true }] }, 'STEP_ORDER'],
    ['a step with nobody in it', { steps: [{ order: 1, recipients: [], channels: ['push'], timeoutSeconds: 60, requireAck: true }] }, 'STEP_NO_RECIPIENTS'],
    ['a step with no channel', { steps: [{ order: 1, recipients: [contact('a')], channels: [], timeoutSeconds: 60, requireAck: true }] }, 'STEP_NO_CHANNELS'],
    ['an unknown channel', { steps: [{ order: 1, recipients: [contact('a')], channels: ['carrier-pigeon' as never], timeoutSeconds: 60, requireAck: true }] }, 'STEP_UNKNOWN_CHANNEL'],
    ['an email-only step, which is not an emergency alert', { steps: [{ order: 1, recipients: [contact('a')], channels: ['email'], timeoutSeconds: 60, requireAck: true }] }, 'STEP_NO_EMERGENCY_CHANNEL'],
    ['a zero step timeout', { steps: [{ order: 1, recipients: [contact('a')], channels: ['push'], timeoutSeconds: 0, requireAck: true }] }, 'STEP_TIMEOUT_INVALID'],
    ['a non-integer recipient cap', { maxRecipientsPerIncident: 2.5 }, 'MAX_RECIPIENTS_INVALID'],
    ['a zero recipient cap', { maxRecipientsPerIncident: 0 }, 'MAX_RECIPIENTS_INVALID'],
    ['a zero deviation grace', { deviationGraceSeconds: 0 }, 'DEVIATION_GRACE_INVALID'],
  ] as const)('flags %s', (_name, overrides, code) => {
    expect(validatePolicy(policy(overrides as Partial<EscalationPolicy>)).map((i) => i.code)).toContain(code);
  });

  it('allows email alongside an emergency-grade channel', () => {
    const p = policy({ steps: [{ order: 1, recipients: [contact('a')], channels: ['email', 'sms'], timeoutSeconds: 60, requireAck: true }] });
    expect(validatePolicy(p)).toEqual([]);
  });

  it('reports every problem with where it is, not just the first', () => {
    const issues = validatePolicy(policy({ graceSeconds: 0, steps: [] }));
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(['graceSeconds', 'steps']));
  });
});

describe('the ladder', () => {
  describe('running', () => {
    it('starts at step 1: dispatches to its recipients and schedules the timeout', () => {
      const { state, decisions } = drive(policy(), [[{ type: 'START' }]]);
      expect(dispatched(decisions)).toEqual(['maya']);
      expect(of(decisions, 'SCHEDULE_TIMEOUT')).toEqual([{ type: 'SCHEDULE_TIMEOUT', stepOrder: 1, at: T0 + 120_000 }]);
      expect(state).toMatchObject({ phase: 'RUNNING', stepIndex: 0, deadline: T0 + 120_000, contacted: ['maya'] });
    });

    it('carries each step’s channels and requireAck through to the dispatch', () => {
      const { decisions } = drive(policy(), [[{ type: 'START' }]]);
      expect(of(decisions, 'DISPATCH')[0]).toEqual({ type: 'DISPATCH', stepOrder: 1, recipientId: 'maya', channels: ['push', 'sms'], requireAck: true });
    });

    it('advances to the next step when the timeout fires', () => {
      const { decisions, state } = drive(policy(), [[{ type: 'START' }], [{ type: 'STEP_TIMEOUT', stepOrder: 1 }, T0 + 120_000]]);
      expect(dispatched(decisions)).toEqual(['maya', 'dad']);
      expect(state.stepIndex).toBe(1);
    });

    it('walks every step in order', () => {
      const { decisions } = drive(policy(), [
        [{ type: 'START' }],
        [{ type: 'STEP_TIMEOUT', stepOrder: 1 }, T0 + 120_000],
        [{ type: 'STEP_TIMEOUT', stepOrder: 2 }, T0 + 240_000],
      ]);
      expect(dispatched(decisions)).toEqual(['maya', 'dad', 'mum']);
    });

    it('addresses several people in one step, in order', () => {
      const p = policy({ steps: [{ order: 1, recipients: [contact('maya'), contact('dad')], channels: ['push'], timeoutSeconds: 60, requireAck: true }] });
      expect(dispatched(drive(p, [[{ type: 'START' }]]).decisions)).toEqual(['maya', 'dad']);
    });

    it('cannot be started twice', () => {
      const { state } = drive(policy(), [[{ type: 'START' }]]);
      expect(stepLadder(state, { type: 'START' }, input(policy()))).toMatchObject({ ok: false, error: 'ALREADY_STARTED' });
    });
  });

  describe('stale and early timers change nothing', () => {
    const running = () => drive(policy(), [[{ type: 'START' }]]).state;

    it('a timer for a step that is no longer in flight', () => {
      const r = stepLadder(running(), { type: 'STEP_TIMEOUT', stepOrder: 2 }, input(policy(), { now: T0 + 999_999 }));
      expect(r).toMatchObject({ ok: true, decisions: [] });
      expect(r.state).toEqual(running());
    });

    it('a timer that fires before the deadline', () => {
      const r = stepLadder(running(), { type: 'STEP_TIMEOUT', stepOrder: 1 }, input(policy(), { now: T0 + 119_999 }));
      expect(r).toMatchObject({ ok: true, decisions: [] });
      expect(r.state.stepIndex).toBe(0);
    });

    it('a timeout before the ladder has started is a fault, not a no-op', () => {
      expect(stepLadder(INITIAL_LADDER, { type: 'STEP_TIMEOUT', stepOrder: 1 }, input(policy()))).toMatchObject({ ok: false, error: 'NOT_STARTED' });
    });
  });

  describe('acknowledgement', () => {
    it('an ack at step 2 prevents step 3', () => {
      const { decisions, state } = drive(policy(), [
        [{ type: 'START' }],
        [{ type: 'STEP_TIMEOUT', stepOrder: 1 }, T0 + 120_000],
        [{ type: 'ACK' }, T0 + 130_000],
      ]);
      expect(state.phase).toBe('HALTED');
      expect(of(decisions, 'HALT')).toHaveLength(1);

      // Step 2's timer fires anyway. In-flight attempts are not cancelled, but no
      // new step begins: the late timer is refused and the state does not move.
      const late = stepLadder(state, { type: 'STEP_TIMEOUT', stepOrder: 2 }, input(policy(), { now: T0 + 240_000 }));
      expect(late).toMatchObject({ ok: false, error: 'NOT_RUNNING' });
      expect(late.state).toBe(state);
      expect(dispatched(decisions)).toEqual(['maya', 'dad']); // never mum
    });

    it('halts immediately, remembering which step was in flight', () => {
      const { state } = drive(policy(), [[{ type: 'START' }], [{ type: 'STEP_TIMEOUT', stepOrder: 1 }, T0 + 120_000], [{ type: 'ACK' }]]);
      expect(state).toMatchObject({ phase: 'HALTED', resumeStepIndex: 1, acknowledged: true, deadline: null });
    });

    it('a second responder after the halt changes nothing', () => {
      const { state, decisions } = drive(policy(), [[{ type: 'START' }], [{ type: 'ACK' }], [{ type: 'ACK' }]]);
      expect(state.phase).toBe('HALTED');
      expect(of(decisions, 'HALT')).toHaveLength(1);
    });

    it('an ack before the ladder starts is a fault', () => {
      expect(stepLadder(INITIAL_LADDER, { type: 'ACK' }, input(policy()))).toMatchObject({ ok: false, error: 'NOT_STARTED' });
    });

    it('with stopOnAcknowledgement off, the ack is recorded and the ladder carries on', () => {
      const p = policy({ stopOnAcknowledgement: false });
      const { state, decisions } = drive(p, [[{ type: 'START' }], [{ type: 'ACK' }], [{ type: 'STEP_TIMEOUT', stepOrder: 1 }, T0 + 120_000]]);
      expect(of(decisions, 'ACK_RECORDED')).toHaveLength(1);
      expect(of(decisions, 'HALT')).toHaveLength(0);
      expect(dispatched(decisions)).toEqual(['maya', 'dad']);
      expect(state.phase).toBe('RUNNING');
    });

    it('an ack after the ladder has run out is recorded', () => {
      const p = policy({ steps: [policy().steps[0]] });
      const { state, decisions } = drive(p, [[{ type: 'START' }], [{ type: 'STEP_TIMEOUT', stepOrder: 1 }, T0 + 120_000], [{ type: 'ACK' }]]);
      expect(state).toMatchObject({ phase: 'EXHAUSTED', acknowledged: true });
      expect(of(decisions, 'ACK_RECORDED')).toHaveLength(1);
    });
  });

  describe('un-acknowledgement resumes the user’s plan (invariant: never strand them)', () => {
    const halted = () => drive(policy(), [[{ type: 'START' }], [{ type: 'STEP_TIMEOUT', stepOrder: 1 }, T0 + 120_000], [{ type: 'ACK' }, T0 + 130_000]]).state;

    it('resumes at step 2, not step 1, and does not re-contact people already tried', () => {
      const r = stepLadder(halted(), { type: 'UNACK' }, input(policy(), { now: T0 + 200_000 }));
      expect(r.ok).toBe(true);
      expect(r.ok && r.decisions).toEqual([
        { type: 'RESUME', stepOrder: 2 },
        { type: 'SCHEDULE_TIMEOUT', stepOrder: 2, at: T0 + 200_000 + 120_000 },
      ]);
      expect(r.state).toMatchObject({ phase: 'RUNNING', stepIndex: 1, resumeStepIndex: null, acknowledged: false });
      expect(r.ok && dispatched(r.decisions)).toEqual([]);
    });

    it('then carries on to step 3 when the resumed step times out', () => {
      const resumed = stepLadder(halted(), { type: 'UNACK' }, input(policy(), { now: T0 + 200_000 }));
      expect(resumed.ok).toBe(true);
      const next = stepLadder(resumed.state, { type: 'STEP_TIMEOUT', stepOrder: 2 }, input(policy(), { now: T0 + 320_000 }));
      expect(next.ok && dispatched(next.decisions)).toEqual(['mum']);
    });

    it('stays halted if the policy says not to resume', () => {
      const p = policy({ resumeOnUnacknowledge: false });
      const state = drive(p, [[{ type: 'START' }], [{ type: 'ACK' }]]).state;
      const r = stepLadder(state, { type: 'UNACK' }, input(p));
      expect(r).toMatchObject({ ok: true, decisions: [] });
      expect(r.state.phase).toBe('HALTED');
    });

    it('falls back to the current step if no resume point was recorded', () => {
      const r = stepLadder({ ...halted(), resumeStepIndex: null }, { type: 'UNACK' }, input(policy(), { now: T0 + 1 }));
      expect(r.ok && r.decisions[0]).toEqual({ type: 'RESUME', stepOrder: 2 });
    });

    it('an un-ack when nothing is halted is a fault', () => {
      expect(stepLadder(INITIAL_LADDER, { type: 'UNACK' }, input(policy()))).toMatchObject({ ok: false, error: 'NOT_HALTED' });
    });
  });

  describe('consent is never bypassed (RES-7)', () => {
    const directory: Directory = { contacts: { maya: { consented: false }, dad: { consented: true } }, circles: {} };

    it('a non-consented recipient is skipped, and the skip is ledgered with its reason', () => {
      const p = policy({ steps: [{ order: 1, recipients: [contact('maya'), contact('dad')], channels: ['push'], timeoutSeconds: 60, requireAck: true }] });
      const { decisions } = drive(p, [[{ type: 'START' }, T0, { directory }]]);
      expect(of(decisions, 'SKIP')).toEqual([{ type: 'SKIP', stepOrder: 1, recipientId: 'maya', reason: 'NOT_CONSENTED' }]);
      expect(dispatched(decisions)).toEqual(['dad']);
    });

    it('a recipient who is not in the directory at all is skipped, not assumed', () => {
      const { decisions } = drive(policy(), [[{ type: 'START' }, T0, { directory: { contacts: {}, circles: {} } }]]);
      expect(of(decisions, 'SKIP')[0]).toMatchObject({ recipientId: 'maya', reason: 'UNKNOWN_RECIPIENT' });
    });

    it('moves straight on when a whole step is skipped — there is nobody to wait for', () => {
      const dir: Directory = { contacts: { maya: { consented: false }, dad: { consented: true } }, circles: {} };
      const { decisions, state } = drive(policy(), [[{ type: 'START' }, T0, { directory: dir }]]);
      expect(dispatched(decisions)).toEqual(['dad']);
      expect(state.stepIndex).toBe(1);
      expect(of(decisions, 'SCHEDULE_TIMEOUT')).toHaveLength(1);
    });
  });

  describe('circles', () => {
    const directory: Directory = {
      contacts: { maya: { consented: true }, dad: { consented: true }, gran: { consented: false } },
      circles: { family: ['maya', 'dad', 'gran', 'maya'] },
    };
    const circleStep = (id: string) => policy({ steps: [{ order: 1, recipients: [{ kind: 'circle', id }], channels: ['push'], timeoutSeconds: 60, requireAck: true }] });

    it('expands to its members, once each, in order', () => {
      const { decisions } = drive(circleStep('family'), [[{ type: 'START' }, T0, { directory }]]);
      expect(dispatched(decisions)).toEqual(['maya', 'dad']);
      expect(of(decisions, 'SKIP')).toEqual([{ type: 'SKIP', stepOrder: 1, recipientId: 'gran', reason: 'NOT_CONSENTED' }]);
    });

    it('an unknown circle is ledgered, not silently ignored', () => {
      const { decisions } = drive(circleStep('ghost'), [[{ type: 'START' }, T0, { directory }]]);
      expect(of(decisions, 'SKIP')).toEqual([{ type: 'SKIP', stepOrder: 1, recipientId: 'ghost', reason: 'UNKNOWN_RECIPIENT' }]);
    });

    it('a person named twice in the same step is contacted once', () => {
      const p = policy({ steps: [{ order: 1, recipients: [contact('maya'), contact('maya')], channels: ['push'], timeoutSeconds: 60, requireAck: true }] });
      expect(dispatched(drive(p, [[{ type: 'START' }, T0, { directory }]]).decisions)).toEqual(['maya']);
    });

    it('a person named directly and through a circle is contacted once', () => {
      const p = policy({ steps: [{ order: 1, recipients: [contact('maya'), { kind: 'circle', id: 'family' }], channels: ['push'], timeoutSeconds: 60, requireAck: true }] });
      expect(dispatched(drive(p, [[{ type: 'START' }, T0, { directory }]]).decisions).filter((id) => id === 'maya')).toHaveLength(1);
    });

    it('does not contact someone already contacted in an earlier step', () => {
      const p = policy({ steps: [
        { order: 1, recipients: [contact('maya')], channels: ['push'], timeoutSeconds: 60, requireAck: true },
        { order: 2, recipients: [contact('maya'), contact('dad')], channels: ['push'], timeoutSeconds: 60, requireAck: true },
      ] });
      const { decisions } = drive(p, [[{ type: 'START' }, T0, { directory }], [{ type: 'STEP_TIMEOUT', stepOrder: 1 }, T0 + 60_000, { directory }]]);
      expect(of(decisions, 'SKIP')).toContainEqual({ type: 'SKIP', stepOrder: 2, recipientId: 'maya', reason: 'ALREADY_CONTACTED' });
      expect(dispatched(decisions)).toEqual(['maya', 'dad']);
    });
  });

  describe('fan-out is bounded (PLAT-5)', () => {
    const wide = (n: number) => policy({
      steps: [{ order: 1, recipients: Array.from({ length: n }, (_, i) => contact(`c${i}`)), channels: ['push'], timeoutSeconds: 60, requireAck: true }],
    });
    const dirOf = (n: number): Directory => everyoneConsents(...Array.from({ length: n }, (_, i) => `c${i}`));

    it('stops at the policy maximum and says so', () => {
      const p = { ...wide(8), maxRecipientsPerIncident: 3 };
      const { decisions } = drive(p, [[{ type: 'START' }, T0, { directory: dirOf(8) }]]);
      expect(dispatched(decisions)).toHaveLength(3);
      expect(of(decisions, 'SKIP').map((s) => s.reason)).toEqual(Array(5).fill('MAX_RECIPIENTS'));
      expect(of(decisions, 'NOTIFY_USER_CAP')).toEqual([{ type: 'NOTIFY_USER_CAP', cap: 'MAX_RECIPIENTS' }]);
    });

    it('stops at the spend cap and tells the user — the ladder is truncated, not silently shortened', () => {
      const { decisions } = drive(wide(8), [[{ type: 'START' }, T0, { directory: dirOf(8), spendCapRecipientsRemaining: 2 }]]);
      expect(dispatched(decisions)).toHaveLength(2);
      expect(of(decisions, 'SKIP').every((s) => s.reason === 'SPEND_CAP')).toBe(true);
      expect(of(decisions, 'NOTIFY_USER_CAP')).toEqual([{ type: 'NOTIFY_USER_CAP', cap: 'SPEND_CAP' }]);
    });

    it('records whichever limit binds first as the reason', () => {
      const p = { ...wide(6), maxRecipientsPerIncident: 4 };
      expect(of(drive(p, [[{ type: 'START' }, T0, { directory: dirOf(6), spendCapRecipientsRemaining: 2 }]]).decisions, 'SKIP')[0].reason).toBe('SPEND_CAP');
      expect(of(drive({ ...wide(6), maxRecipientsPerIncident: 2 }, [[{ type: 'START' }, T0, { directory: dirOf(6), spendCapRecipientsRemaining: 4 }]]).decisions, 'SKIP')[0].reason).toBe('MAX_RECIPIENTS');
    });

    it('a tie is attributed to the policy maximum', () => {
      const p = { ...wide(4), maxRecipientsPerIncident: 2 };
      expect(of(drive(p, [[{ type: 'START' }, T0, { directory: dirOf(4), spendCapRecipientsRemaining: 2 }]]).decisions, 'SKIP')[0].reason).toBe('MAX_RECIPIENTS');
    });

    it('counts people contacted in earlier steps against the maximum', () => {
      const p = policy({ maxRecipientsPerIncident: 2 });
      const { decisions } = drive(p, [[{ type: 'START' }], [{ type: 'STEP_TIMEOUT', stepOrder: 1 }, T0 + 120_000], [{ type: 'STEP_TIMEOUT', stepOrder: 2 }, T0 + 240_000]]);
      expect(dispatched(decisions)).toEqual(['maya', 'dad']);
      expect(of(decisions, 'SKIP')).toContainEqual({ type: 'SKIP', stepOrder: 3, recipientId: 'mum', reason: 'MAX_RECIPIENTS' });
    });

    it('tells the user about a cap once per advance, not once per skipped person', () => {
      const p = { ...wide(8), maxRecipientsPerIncident: 1 };
      expect(of(drive(p, [[{ type: 'START' }, T0, { directory: dirOf(8) }]]).decisions, 'NOTIFY_USER_CAP')).toHaveLength(1);
    });
  });

  describe('running out of people', () => {
    it('exhausting every step prompts the user to call the emergency number', () => {
      const { state, decisions } = drive(policy(), [
        [{ type: 'START' }],
        [{ type: 'STEP_TIMEOUT', stepOrder: 1 }, T0 + 120_000],
        [{ type: 'STEP_TIMEOUT', stepOrder: 2 }, T0 + 240_000],
        [{ type: 'STEP_TIMEOUT', stepOrder: 3 }, T0 + 360_000],
      ]);
      expect(state.phase).toBe('EXHAUSTED');
      expect(decisions.slice(-2)).toEqual([{ type: 'PROMPT_EMERGENCY_NUMBER' }, { type: 'EXHAUSTED' }]);
    });

    it('does not prompt when the policy says not to', () => {
      const p = policy({ promptEmergencyNumberOnFailure: false, steps: [policy().steps[0]] });
      const { decisions } = drive(p, [[{ type: 'START' }], [{ type: 'STEP_TIMEOUT', stepOrder: 1 }, T0 + 120_000]]);
      expect(of(decisions, 'PROMPT_EMERGENCY_NUMBER')).toHaveLength(0);
      expect(decisions.at(-1)).toEqual({ type: 'EXHAUSTED' });
    });

    it('a ladder where nobody can be contacted at all exhausts at once, and prompts', () => {
      const none: Directory = { contacts: { maya: { consented: false }, dad: { consented: false }, mum: { consented: false } }, circles: {} };
      const { state, decisions } = drive(policy(), [[{ type: 'START' }, T0, { directory: none }]]);
      expect(state.phase).toBe('EXHAUSTED');
      expect(dispatched(decisions)).toEqual([]);
      expect(of(decisions, 'SKIP')).toHaveLength(3);
      expect(of(decisions, 'PROMPT_EMERGENCY_NUMBER')).toHaveLength(1);
    });

    it('a late timer after exhaustion is harmless', () => {
      const p = policy({ steps: [policy().steps[0]] });
      const done = drive(p, [[{ type: 'START' }], [{ type: 'STEP_TIMEOUT', stepOrder: 1 }, T0 + 120_000]]).state;
      expect(stepLadder(done, { type: 'STEP_TIMEOUT', stepOrder: 1 }, input(p, { now: T0 + 999_999 }))).toMatchObject({ ok: false, error: 'NOT_RUNNING' });
    });
  });

  it('is deterministic: identical policy, events and clock give identical decisions', () => {
    const events: [LadderEvent, number?][] = [[{ type: 'START' }], [{ type: 'STEP_TIMEOUT', stepOrder: 1 }, T0 + 120_000], [{ type: 'ACK' }, T0 + 130_000], [{ type: 'UNACK' }, T0 + 140_000]];
    expect(drive(policy(), events)).toEqual(drive(policy(), events));
  });

  it('never mutates the state it was given', () => {
    const before = Object.freeze({ ...INITIAL_LADDER, contacted: Object.freeze([]) as readonly string[] });
    expect(() => stepLadder(before, { type: 'START' }, input(policy()))).not.toThrow();
    expect(before).toEqual(INITIAL_LADDER);
  });
});

describe('per-template defaults', () => {
  const contacts = ['maya', 'dad', 'mum'];
  const expected = {
    walk_home: [180, 90, true], date: [300, 120, true], ride: [180, 90, true],
    travel: [1800, 300, false], outdoor: [3600, 600, false], custom: [DEFAULT_GRACE_SECONDS, 120, true],
  } as const;

  it.each(SESSION_KINDS)('%s uses its own grace, step timeout and dial prompt', (kind) => {
    const p = policyFromTemplate(kind, { id: 'x', contactIds: contacts });
    const [grace, timeout, prompt] = expected[kind];
    expect(p.graceSeconds).toBe(grace);
    expect(p.steps.every((s) => s.timeoutSeconds === timeout)).toBe(true);
    expect(p.promptEmergencyNumberOnFailure).toBe(prompt);
    expect(validatePolicy(p)).toEqual([]);
  });

  it('a walk home tolerates minutes; a hike tolerates an hour — one policy for both would be wrong', () => {
    expect(policyFromTemplate('outdoor', { id: 'x', contactIds: contacts }).graceSeconds).toBeGreaterThan(policyFromTemplate('walk_home', { id: 'x', contactIds: contacts }).graceSeconds * 10);
  });

  it('gives each of the first contacts its own step, in priority order', () => {
    const p = policyFromTemplate('walk_home', { id: 'x', contactIds: contacts });
    expect(p.steps.map((s) => s.recipients[0].id)).toEqual(['maya', 'dad']);
    expect(p.steps.map((s) => s.order)).toEqual([1, 2]);
  });

  it('uses push then SMS unless told otherwise', () => {
    expect(policyFromTemplate('walk_home', { id: 'x', contactIds: ['a'] }).steps[0].channels).toEqual(['push', 'sms']);
    expect(policyFromTemplate('walk_home', { id: 'x', contactIds: ['a'], channels: ['sms'] }).steps[0].channels).toEqual(['sms']);
  });

  it('with no contacts, produces a policy that validation refuses — it never pretends to be usable', () => {
    expect(validatePolicy(policyFromTemplate('walk_home', { id: 'x', contactIds: [] })).map((i) => i.code)).toContain('NO_STEPS');
  });

  it('every template respects the grace minimum', () => {
    for (const kind of SESSION_KINDS) expect(TEMPLATE_DEFAULTS[kind].graceSeconds).toBeGreaterThanOrEqual(MIN_GRACE_SECONDS);
  });
});

describe('describePolicy: the user sees the plan before it runs', () => {
  const names = { maya: 'Maya', dad: 'Dad', mum: 'Mum' };

  it('says what will happen, in order, in words', () => {
    expect(describePolicy(policy(), names)).toEqual([
      'If you do not respond 5 minutes after a missed check-in, Lumo will:',
      '1. Try to alert Maya with a push notification, then an SMS, then wait 2 minutes.',
      '2. Try to alert Dad with a push notification, then an SMS, then wait 2 minutes.',
      '3. Try to alert Mum with an SMS, then wait 2 minutes.',
      'It stops as soon as someone says they are responding.',
      'If they then say they cannot help, it carries on.',
      'It will contact at most 5 people.',
      'If it runs out of people to try, it shows you the emergency number to call.',
    ]);
  });

  it('promises only that it will try — never that anything arrives', () => {
    const text = describePolicy(policy(), names).join(' ');
    expect(text).toContain('Try to alert');
    expect(text).not.toMatch(/\b(notified|delivered|sent|reached|help is on)\b/i);
  });

  it('omits lines for behaviour the policy does not have', () => {
    const lines = describePolicy(policy({ stopOnAcknowledgement: false, resumeOnUnacknowledge: false, promptEmergencyNumberOnFailure: false }), names);
    expect(lines.join(' ')).not.toContain('stops as soon as');
    expect(lines.join(' ')).not.toContain('carries on');
    expect(lines.join(' ')).not.toContain('emergency number');
  });

  it('names circles and falls back to the id for anyone it has no name for', () => {
    const p = policy({ steps: [{ order: 1, recipients: [contact('maya'), { kind: 'circle', id: 'family' }, contact('stranger')], channels: ['voice', 'device_direct_sms', 'email', 'web'], timeoutSeconds: 45, requireAck: true }] });
    const line = describePolicy(p, { ...names, family: 'Family' })[1];
    expect(line).toContain('Maya and the circle Family and stranger');
    expect(line).toContain('a phone call, then a text from your own phone, then an email, then a web link');
    expect(line).toContain('45 seconds');
  });

  it('works with no names supplied', () => {
    expect(describePolicy(policy())[1]).toContain('maya');
  });

  it('falls back to the id for a circle it has no name for, too', () => {
    const p = policy({ steps: [{ order: 1, recipients: [{ kind: 'circle', id: 'c-17' }], channels: ['push'], timeoutSeconds: 60, requireAck: true }] });
    expect(describePolicy(p)[1]).toContain('the circle c-17');
  });

  it('formats durations in the largest whole unit', () => {
    const wait = (s: number) => describePolicy(policy({ graceSeconds: s }))[0];
    expect(wait(3600)).toContain('1 hour after');
    expect(wait(7200)).toContain('2 hours after');
    expect(wait(60)).toContain('1 minute after');
    expect(wait(300)).toContain('5 minutes after');
    expect(wait(90)).toContain('90 seconds after');
    expect(describePolicy(policy({ steps: [{ ...policy().steps[0], timeoutSeconds: 1 }] }))[1]).toContain('1 second.');
  });
});
