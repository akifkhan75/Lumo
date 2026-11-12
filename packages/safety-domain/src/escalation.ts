import { CHANNEL_CAPABILITIES } from './capabilities';
import { CHANNELS, type Channel, type SessionKind } from './types';

/**
 * Escalation policy and the evaluator that runs it
 * (docs/specs/ESCALATION_POLICY.md, RES-4).
 *
 * The evaluator is a pure function of (policy, state, event, injected clock,
 * recipient directory, spend headroom). It never sends anything: it returns
 * DECISIONS, and the notifications module executes them. A given policy plus
 * event sequence plus clock therefore always yields the same decisions, on a
 * phone and on a server.
 *
 * It never decides whether something is an emergency. It executes what the
 * session or the trigger has already determined (ADR-0013, ADR-0014).
 */

export const MIN_GRACE_SECONDS = 60;
export const DEFAULT_GRACE_SECONDS = 300;
export const DEFAULT_STEP_TIMEOUT_SECONDS = 120;
export const DEFAULT_MAX_RECIPIENTS = 5;
export const DEFAULT_DEVIATION_GRACE_SECONDS = 180;

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export interface RecipientRef {
  readonly kind: 'contact' | 'circle';
  readonly id: string;
}

export interface EscalationStep {
  readonly order: number;
  readonly recipients: readonly RecipientRef[];
  /** Preference order; the fallback chain runs within a step. */
  readonly channels: readonly Channel[];
  /** How long to wait before advancing to the next step. */
  readonly timeoutSeconds: number;
  /**
   * Carried through to the dispatch decision unchanged. The spec gives this field
   * no defined behaviour beyond a default of true, so the evaluator does not
   * interpret it (see KNOWN_ISSUES).
   */
  readonly requireAck: boolean;
}

export interface EscalationPolicy {
  readonly id: string;
  readonly name: string;
  /** Time after a missed check-in before escalation starts. Never below the minimum. */
  readonly graceSeconds: number;
  readonly steps: readonly EscalationStep[];
  readonly maxRecipientsPerIncident: number;
  readonly stopOnAcknowledgement: boolean;
  readonly resumeOnUnacknowledge: boolean;
  readonly promptEmergencyNumberOnFailure: boolean;
  /** Route deviation, not check-in. */
  readonly deviationGraceSeconds: number;
}

export type PolicyIssueCode =
  | 'GRACE_TOO_SHORT'
  | 'NO_STEPS'
  | 'STEP_ORDER'
  | 'STEP_NO_RECIPIENTS'
  | 'STEP_NO_CHANNELS'
  | 'STEP_UNKNOWN_CHANNEL'
  | 'STEP_NO_EMERGENCY_CHANNEL'
  | 'STEP_TIMEOUT_INVALID'
  | 'MAX_RECIPIENTS_INVALID'
  | 'DEVIATION_GRACE_INVALID';

export interface PolicyIssue {
  readonly code: PolicyIssueCode;
  readonly path: string;
  readonly message: string;
}

/**
 * Everything wrong with a policy, or an empty list. A zero or near-zero grace is
 * how a safety app turns traffic into an emergency and gets uninstalled, so the
 * minimum is enforced rather than advised.
 */
export function validatePolicy(policy: EscalationPolicy): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const add = (code: PolicyIssueCode, path: string, message: string) => issues.push({ code, path, message });

  if (!(policy.graceSeconds >= MIN_GRACE_SECONDS)) {
    add('GRACE_TOO_SHORT', 'graceSeconds', `Grace must be at least ${MIN_GRACE_SECONDS} seconds`);
  }
  if (!Number.isInteger(policy.maxRecipientsPerIncident) || policy.maxRecipientsPerIncident < 1) {
    add('MAX_RECIPIENTS_INVALID', 'maxRecipientsPerIncident', 'Must be a whole number of at least 1');
  }
  if (!(policy.deviationGraceSeconds > 0)) {
    add('DEVIATION_GRACE_INVALID', 'deviationGraceSeconds', 'Must be greater than zero');
  }
  if (policy.steps.length === 0) {
    add('NO_STEPS', 'steps', 'A policy needs at least one step');
  }

  policy.steps.forEach((step, i) => {
    const at = `steps[${i}]`;
    if (step.order !== i + 1) {
      add('STEP_ORDER', `${at}.order`, `Steps must be numbered 1, 2, 3… in sequence; found ${step.order} at position ${i + 1}`);
    }
    if (step.recipients.length === 0) add('STEP_NO_RECIPIENTS', `${at}.recipients`, 'A step needs at least one recipient');
    if (!(step.timeoutSeconds > 0)) add('STEP_TIMEOUT_INVALID', `${at}.timeoutSeconds`, 'Must be greater than zero');
    if (step.channels.length === 0) {
      add('STEP_NO_CHANNELS', `${at}.channels`, 'A step needs at least one channel');
    } else {
      const unknown = step.channels.filter((c) => !CHANNELS.includes(c));
      if (unknown.length > 0) add('STEP_UNKNOWN_CHANNEL', `${at}.channels`, `Unknown channel: ${unknown.join(', ')}`);
      // A step that can only email is not an emergency alert (email is supplementary).
      const known = step.channels.filter((c) => CHANNELS.includes(c));
      if (known.length > 0 && !known.some((c) => CHANNEL_CAPABILITIES[c].isEmergencyGrade)) {
        add('STEP_NO_EMERGENCY_CHANNEL', `${at}.channels`, 'At least one channel must be emergency-grade; email alone is not');
      }
    }
  });

  return issues;
}

// ---------------------------------------------------------------------------
// Per-template defaults (docs/specs/ESCALATION_POLICY.md)
// ---------------------------------------------------------------------------

interface TemplateDefaults {
  readonly label: string;
  readonly graceSeconds: number;
  readonly stepTimeoutSeconds: number;
  /** How many contacts, each its own step, before the ladder ends. */
  readonly contactSteps: number;
  readonly promptEmergencyNumberOnFailure: boolean;
}

/**
 * A hiking session tolerating hours without signal and a walk home tolerating
 * three minutes are both correct; one policy for both is not.
 */
export const TEMPLATE_DEFAULTS: Readonly<Record<SessionKind, TemplateDefaults>> = {
  walk_home: { label: 'Walk Home', graceSeconds: 180, stepTimeoutSeconds: 90, contactSteps: 2, promptEmergencyNumberOnFailure: true },
  date: { label: 'Date Check-In', graceSeconds: 300, stepTimeoutSeconds: 120, contactSteps: 2, promptEmergencyNumberOnFailure: true },
  ride: { label: 'Ride Check-In', graceSeconds: 180, stepTimeoutSeconds: 90, contactSteps: 2, promptEmergencyNumberOnFailure: true },
  travel: { label: 'Travel Check-In', graceSeconds: 1800, stepTimeoutSeconds: 300, contactSteps: 2, promptEmergencyNumberOnFailure: false },
  outdoor: { label: 'Outdoor Activity', graceSeconds: 3600, stepTimeoutSeconds: 600, contactSteps: 2, promptEmergencyNumberOnFailure: false },
  custom: {
    label: 'Custom',
    graceSeconds: DEFAULT_GRACE_SECONDS,
    stepTimeoutSeconds: DEFAULT_STEP_TIMEOUT_SECONDS,
    contactSteps: 2,
    promptEmergencyNumberOnFailure: true,
  },
};

export interface TemplateOptions {
  readonly id: string;
  /** Contacts in priority order. Each of the first few becomes its own step. */
  readonly contactIds: readonly string[];
  readonly channels?: readonly Channel[];
}

export function policyFromTemplate(kind: SessionKind, options: TemplateOptions): EscalationPolicy {
  const t = TEMPLATE_DEFAULTS[kind];
  const channels = options.channels ?? (['push', 'sms'] as const);
  return {
    id: options.id,
    name: t.label,
    graceSeconds: t.graceSeconds,
    steps: options.contactIds.slice(0, t.contactSteps).map((id, i) => ({
      order: i + 1,
      recipients: [{ kind: 'contact', id }],
      channels,
      timeoutSeconds: t.stepTimeoutSeconds,
      requireAck: true,
    })),
    maxRecipientsPerIncident: DEFAULT_MAX_RECIPIENTS,
    stopOnAcknowledgement: true,
    resumeOnUnacknowledge: true,
    promptEmergencyNumberOnFailure: t.promptEmergencyNumberOnFailure,
    deviationGraceSeconds: DEFAULT_DEVIATION_GRACE_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// Showing the policy before it runs (RES-4)
// ---------------------------------------------------------------------------

const CHANNEL_WORDS: Readonly<Record<Channel, string>> = {
  push: 'a push notification',
  sms: 'an SMS',
  voice: 'a phone call',
  device_direct_sms: 'a text from your own phone',
  email: 'an email',
  web: 'a web link',
};

function duration(seconds: number): string {
  if (seconds % 3600 === 0) return seconds === 3600 ? '1 hour' : `${seconds / 3600} hours`;
  if (seconds % 60 === 0) return seconds === 60 ? '1 minute' : `${seconds / 60} minutes`;
  return seconds === 1 ? '1 second' : `${seconds} seconds`;
}

/**
 * The policy in plain words, shown to the user BEFORE it runs. A person who
 * cannot predict what their app will do cannot trust it. Wording is deliberately
 * "will try to": nothing here claims a message arrives.
 */
export function describePolicy(policy: EscalationPolicy, names: Readonly<Record<string, string>> = {}): string[] {
  const nameOf = (r: RecipientRef) => (r.kind === 'circle' ? `the circle ${names[r.id] ?? r.id}` : (names[r.id] ?? r.id));
  const lines = [`If you do not respond ${duration(policy.graceSeconds)} after a missed check-in, Lumo will:`];

  policy.steps.forEach((step) => {
    const who = step.recipients.map(nameOf).join(' and ');
    const how = step.channels.map((c) => CHANNEL_WORDS[c]).join(', then ');
    lines.push(`${step.order}. Try to alert ${who} with ${how}, then wait ${duration(step.timeoutSeconds)}.`);
  });

  if (policy.stopOnAcknowledgement) lines.push('It stops as soon as someone says they are responding.');
  if (policy.resumeOnUnacknowledge) lines.push('If they then say they cannot help, it carries on.');
  lines.push(`It will contact at most ${policy.maxRecipientsPerIncident} people.`);
  if (policy.promptEmergencyNumberOnFailure) {
    lines.push('If it runs out of people to try, it shows you the emergency number to call.');
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The evaluator
// ---------------------------------------------------------------------------

export interface DirectoryEntry {
  readonly consented: boolean;
}

/** Who exists and who has agreed to be alerted. Supplied by the caller. */
export interface Directory {
  readonly contacts: Readonly<Record<string, DirectoryEntry>>;
  readonly circles: Readonly<Record<string, readonly string[]>>;
}

export type SkipReason = 'NOT_CONSENTED' | 'UNKNOWN_RECIPIENT' | 'ALREADY_CONTACTED' | 'MAX_RECIPIENTS' | 'SPEND_CAP';

/** Executed by the caller, never by the evaluator. */
export type Decision =
  | { readonly type: 'DISPATCH'; readonly stepOrder: number; readonly recipientId: string; readonly channels: readonly Channel[]; readonly requireAck: boolean }
  // Ledgered with its reason — a skip is never hidden.
  | { readonly type: 'SKIP'; readonly stepOrder: number; readonly recipientId: string; readonly reason: SkipReason }
  | { readonly type: 'SCHEDULE_TIMEOUT'; readonly stepOrder: number; readonly at: number }
  // A cap truncated the ladder; the user is told, not left to assume.
  | { readonly type: 'NOTIFY_USER_CAP'; readonly cap: 'MAX_RECIPIENTS' | 'SPEND_CAP' }
  | { readonly type: 'HALT'; readonly reason: 'ACKNOWLEDGED' }
  | { readonly type: 'ACK_RECORDED' }
  | { readonly type: 'RESUME'; readonly stepOrder: number }
  | { readonly type: 'PROMPT_EMERGENCY_NUMBER' }
  | { readonly type: 'EXHAUSTED' };

export type LadderPhase = 'IDLE' | 'RUNNING' | 'HALTED' | 'EXHAUSTED';

export interface LadderState {
  readonly phase: LadderPhase;
  /** Index into policy.steps of the step in flight (or last run). */
  readonly stepIndex: number;
  /** When the step in flight times out, by the injected clock. */
  readonly deadline: number | null;
  /** Distinct people dispatched to so far; counts toward the maximum. */
  readonly contacted: readonly string[];
  /** The step that was in flight when an acknowledgement halted the ladder. */
  readonly resumeStepIndex: number | null;
  readonly acknowledged: boolean;
}

export const INITIAL_LADDER: LadderState = {
  phase: 'IDLE',
  stepIndex: 0,
  deadline: null,
  contacted: [],
  resumeStepIndex: null,
  acknowledged: false,
};

export type LadderEvent =
  | { readonly type: 'START' }
  /** Carries which step's timer fired, so a stale job from before an ack/resume is ignored. */
  | { readonly type: 'STEP_TIMEOUT'; readonly stepOrder: number }
  | { readonly type: 'ACK' }
  | { readonly type: 'UNACK' };

export interface LadderInput {
  readonly policy: EscalationPolicy;
  readonly directory: Directory;
  /** Injected clock, epoch milliseconds. The evaluator never reads one. */
  readonly now: number;
  /**
   * How many MORE recipients the spend cap permits right now; null if uncapped.
   * Whichever of this and the policy maximum binds first is ledgered as the reason.
   */
  readonly spendCapRecipientsRemaining: number | null;
}

export type LadderError = 'INVALID_POLICY' | 'ALREADY_STARTED' | 'NOT_STARTED' | 'NOT_RUNNING' | 'NOT_HALTED';

export type LadderResult =
  | { readonly ok: true; readonly state: LadderState; readonly decisions: readonly Decision[] }
  | { readonly ok: false; readonly error: LadderError; readonly state: LadderState };

/** The people a step addresses, circles expanded, in order, with no repeats. */
function expand(step: EscalationStep, directory: Directory): { ids: string[]; unknownCircles: string[] } {
  const ids: string[] = [];
  const unknownCircles: string[] = [];
  for (const ref of step.recipients) {
    if (ref.kind === 'contact') {
      if (!ids.includes(ref.id)) ids.push(ref.id);
    } else {
      const members = directory.circles[ref.id];
      if (members === undefined) unknownCircles.push(ref.id);
      else for (const id of members) if (!ids.includes(id)) ids.push(id);
    }
  }
  return { ids, unknownCircles };
}

/**
 * Run steps from `fromIndex` until one actually dispatches to someone, or the
 * ladder is out of steps. A step where every recipient is skipped does not wait
 * out its timeout — there is nobody to wait for.
 */
function advance(state: LadderState, fromIndex: number, input: LadderInput): { state: LadderState; decisions: Decision[] } {
  const { policy, directory, now } = input;
  const decisions: Decision[] = [];
  let contacted = state.contacted;
  let capNotified = false;

  for (let i = fromIndex; i < policy.steps.length; i++) {
    const step = policy.steps[i];
    const { ids, unknownCircles } = expand(step, directory);
    for (const id of unknownCircles) decisions.push({ type: 'SKIP', stepOrder: step.order, recipientId: id, reason: 'UNKNOWN_RECIPIENT' });

    let dispatched = 0;
    for (const id of ids) {
      const entry = directory.contacts[id];
      const policyRoom = policy.maxRecipientsPerIncident - contacted.length;
      const capRoom = input.spendCapRecipientsRemaining === null ? Number.POSITIVE_INFINITY : input.spendCapRecipientsRemaining - dispatchedSoFar(state, contacted);

      let skip: SkipReason | null = null;
      if (contacted.includes(id)) skip = 'ALREADY_CONTACTED';
      else if (entry === undefined) skip = 'UNKNOWN_RECIPIENT';
      else if (!entry.consented) skip = 'NOT_CONSENTED';
      else if (Math.min(policyRoom, capRoom) <= 0) skip = policyRoom <= capRoom ? 'MAX_RECIPIENTS' : 'SPEND_CAP';

      if (skip !== null) {
        decisions.push({ type: 'SKIP', stepOrder: step.order, recipientId: id, reason: skip });
        if ((skip === 'MAX_RECIPIENTS' || skip === 'SPEND_CAP') && !capNotified) {
          capNotified = true;
          decisions.push({ type: 'NOTIFY_USER_CAP', cap: skip });
        }
        continue;
      }

      contacted = [...contacted, id];
      dispatched++;
      decisions.push({ type: 'DISPATCH', stepOrder: step.order, recipientId: id, channels: step.channels, requireAck: step.requireAck });
    }

    if (dispatched > 0) {
      const deadline = now + step.timeoutSeconds * 1000;
      decisions.push({ type: 'SCHEDULE_TIMEOUT', stepOrder: step.order, at: deadline });
      return { state: { ...state, phase: 'RUNNING', stepIndex: i, deadline, contacted }, decisions };
    }
  }

  // Out of steps with nobody left to try.
  if (policy.promptEmergencyNumberOnFailure) decisions.push({ type: 'PROMPT_EMERGENCY_NUMBER' });
  decisions.push({ type: 'EXHAUSTED' });
  return { state: { ...state, phase: 'EXHAUSTED', deadline: null, contacted }, decisions };
}

// The spend cap is measured against what THIS incident has already used.
const dispatchedSoFar = (start: LadderState, now: readonly string[]) => now.length - start.contacted.length;

export function stepLadder(state: LadderState, event: LadderEvent, input: LadderInput): LadderResult {
  const { policy, now } = input;
  const fail = (error: LadderError): LadderResult => ({ ok: false, error, state });
  const done = (next: LadderState, decisions: readonly Decision[] = []): LadderResult => ({ ok: true, state: next, decisions });

  switch (event.type) {
    case 'START': {
      if (state.phase !== 'IDLE') return fail('ALREADY_STARTED');
      if (validatePolicy(policy).length > 0) return fail('INVALID_POLICY');
      const r = advance(state, 0, input);
      return done(r.state, r.decisions);
    }

    case 'STEP_TIMEOUT': {
      if (state.phase === 'IDLE') return fail('NOT_STARTED');
      if (state.phase !== 'RUNNING') return fail('NOT_RUNNING'); // halted or finished: a late timer is harmless
      const step = policy.steps[state.stepIndex];
      // A timer from a step that is no longer in flight, or one that fired early,
      // changes nothing.
      if (event.stepOrder !== step.order || state.deadline === null || now < state.deadline) return done(state);
      const r = advance(state, state.stepIndex + 1, input);
      return done(r.state, r.decisions);
    }

    case 'ACK': {
      if (state.phase === 'IDLE') return fail('NOT_STARTED');
      if (state.phase === 'HALTED') return done(state); // a second responder; already halted
      if (state.phase === 'EXHAUSTED') return done({ ...state, acknowledged: true }, [{ type: 'ACK_RECORDED' }]);
      // RUNNING
      if (!policy.stopOnAcknowledgement) return done({ ...state, acknowledged: true }, [{ type: 'ACK_RECORDED' }]);
      // In-flight attempts are not cancelled, but no new step begins.
      return done({ ...state, phase: 'HALTED', deadline: null, resumeStepIndex: state.stepIndex, acknowledged: true }, [
        { type: 'HALT', reason: 'ACKNOWLEDGED' },
      ]);
    }

    case 'UNACK': {
      if (state.phase !== 'HALTED') return fail('NOT_HALTED');
      if (!policy.resumeOnUnacknowledge) return done(state);
      // Resume from the step that was in flight — not from the beginning. Its
      // recipients were already contacted, so re-arm its timeout rather than
      // dispatching to them again.
      const index = state.resumeStepIndex ?? state.stepIndex;
      const step = policy.steps[index];
      const deadline = now + step.timeoutSeconds * 1000;
      return done({ ...state, phase: 'RUNNING', stepIndex: index, deadline, resumeStepIndex: null, acknowledged: false }, [
        { type: 'RESUME', stepOrder: step.order },
        { type: 'SCHEDULE_TIMEOUT', stepOrder: step.order, at: deadline },
      ]);
    }
  }
}
