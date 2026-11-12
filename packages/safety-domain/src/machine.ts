import type { Actor } from './types';

/**
 * The generic reducer behind all three machines (ADR-0008, ADR-0009).
 *
 * Pure: no I/O, no clock — `at` is passed in — and no randomness. The same
 * (machine, snapshot, event, meta, ctx) always yields the same outcome, on a
 * phone and on a server. That equality is the entire point of PLAT-7.
 *
 * Effects are DECLARED, as strings in the transition record, and executed by the
 * caller. The machine never sends anything.
 *
 * There is no default-allow. A (state, event) pair that is not a row is a
 * rejection, and the caller logs it as ILLEGAL_TRANSITION.
 */

/** Marks "return to the state we left", used by SUSPENDED and ACKNOWLEDGED. */
export const PRIOR_STATE = '@prior' as const;

export interface Row<S extends string, E extends string, C> {
  readonly from: S;
  readonly event: E;
  readonly to: S | typeof PRIOR_STATE;
  /** Who may cause it. An event from any other actor is rejected. */
  readonly actor: readonly Actor[];
  /** Absent means unconditional. Rows sharing (from, event) must be mutually exclusive. */
  readonly guard?: (ctx: C) => boolean;
  /** Declared for the caller to perform. */
  readonly effects: readonly string[];
}

export interface Machine<S extends string, E extends string, C> {
  readonly name: string;
  readonly states: readonly S[];
  readonly events: readonly E[];
  readonly rows: readonly Row<S, E, C>[];
  /** Entering one of these remembers the state we came from. */
  readonly rememberPriorOn: readonly S[];
}

/** The machine's whole mutable state: where it is, and where to return to. */
export interface Snapshot<S extends string> {
  readonly state: S;
  readonly priorState: S | null;
}

/** Every transition records when, by whom, and why (invariant 10). */
export interface TransitionRecord<S extends string, E extends string> {
  readonly from: S;
  readonly event: E;
  readonly to: S;
  readonly at: number;
  readonly by: Actor;
  readonly reason: string | null;
  readonly effects: readonly string[];
}

/**
 * Why a transition was refused. Distinct on purpose: an actor that is not
 * permitted is a different fault from an event that does not exist.
 */
export type Rejection =
  | 'ILLEGAL_TRANSITION' // no row for this (state, event)
  | 'ACTOR_NOT_PERMITTED' // a row exists, but not for this actor
  | 'GUARD_FAILED' // a row exists for this actor, but its condition does not hold
  | 'NO_PRIOR_STATE'; // asked to return to a prior state that was never recorded

export interface Meta {
  /** Epoch milliseconds. Injected — the machine never reads a clock. */
  readonly at: number;
  readonly by: Actor;
  readonly reason?: string | null;
}

export type Outcome<S extends string, E extends string> =
  | { readonly ok: true; readonly snapshot: Snapshot<S>; readonly record: TransitionRecord<S, E> }
  | {
      readonly ok: false;
      readonly rejection: Rejection;
      readonly snapshot: Snapshot<S>; // unchanged
      readonly from: S;
      readonly event: E;
      readonly at: number;
      readonly by: Actor;
      readonly reason: string | null;
    };

/** Expand a row written with several source states into one row per state. */
export function rowsFrom<S extends string, E extends string, C>(
  from: S | readonly S[],
  event: E,
  to: S | typeof PRIOR_STATE,
  actor: readonly Actor[],
  options: { guard?: (ctx: C) => boolean; effects?: readonly string[] } = {},
): Row<S, E, C>[] {
  const sources: readonly S[] = typeof from === 'string' ? [from] : from;
  return sources.map((source) => ({
    from: source,
    event,
    to,
    actor,
    guard: options.guard,
    effects: options.effects ?? [],
  }));
}

export function initialSnapshot<S extends string>(state: S): Snapshot<S> {
  return { state, priorState: null };
}

export function apply<S extends string, E extends string, C>(
  machine: Machine<S, E, C>,
  snapshot: Snapshot<S>,
  event: E,
  meta: Meta,
  ctx: C,
): Outcome<S, E> {
  const reason = meta.reason ?? null;
  const reject = (rejection: Rejection): Outcome<S, E> => ({
    ok: false,
    rejection,
    snapshot,
    from: snapshot.state,
    event,
    at: meta.at,
    by: meta.by,
    reason,
  });

  const candidates = machine.rows.filter((r) => r.from === snapshot.state && r.event === event);
  if (candidates.length === 0) return reject('ILLEGAL_TRANSITION');

  const permitted = candidates.filter((r) => r.actor.includes(meta.by));
  if (permitted.length === 0) return reject('ACTOR_NOT_PERMITTED');

  const row = permitted.find((r) => r.guard === undefined || r.guard(ctx));
  if (row === undefined) return reject('GUARD_FAILED');

  let target: S;
  if (row.to === PRIOR_STATE) {
    if (snapshot.priorState === null) return reject('NO_PRIOR_STATE');
    target = snapshot.priorState;
  } else {
    target = row.to;
  }

  return {
    ok: true,
    snapshot: {
      state: target,
      priorState: machine.rememberPriorOn.includes(target) ? snapshot.state : null,
    },
    record: {
      from: snapshot.state,
      event,
      to: target,
      at: meta.at,
      by: meta.by,
      reason,
      effects: row.effects,
    },
  };
}
