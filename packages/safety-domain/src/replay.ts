import { apply, type Machine, type Rejection, type Snapshot, type TransitionRecord } from './machine';
import type { Actor } from './types';

/**
 * Offline reconciliation, as a pure fold (docs/specs/SAFETY_STATE_MACHINES.md §5).
 *
 * When a suspended session or a locally queued incident regains connectivity:
 *  1. replay the queued events in ORIGINAL OCCURRENCE ORDER, each carrying its true
 *     `at` — never the sync time;
 *  2. deduplicate by idempotency key;
 *  3. an event that is illegal on arrival is logged as RECONCILIATION_CONFLICT and
 *     surfaced — never silently dropped;
 *  4. a long-delayed event is still applied, and its delay is stated. A late alert
 *     beats no alert; the recipient is told how old it is.
 *
 * Because the client and the server run this same code over the same tables, they
 * cannot disagree about which transitions were legal.
 */

export interface QueuedEvent<E extends string, C> {
  readonly event: E;
  /** When it actually happened, by the device clock at the time. */
  readonly at: number;
  readonly by: Actor;
  readonly reason?: string | null;
  readonly ctx: C;
  /** Events sharing a key are the same event retried. Absent means never deduplicated. */
  readonly idempotencyKey?: string;
}

export interface Conflict<S extends string, E extends string> {
  readonly code: 'RECONCILIATION_CONFLICT';
  readonly rejection: Rejection;
  readonly from: S;
  readonly event: E;
  readonly at: number;
  readonly by: Actor;
  readonly reason: string | null;
}

export type AppliedRecord<S extends string, E extends string> = TransitionRecord<S, E> & {
  /** How long after it happened it was applied. Zero if it was not late. */
  readonly delayedMs: number;
};

export interface ReplayResult<S extends string, E extends string> {
  readonly snapshot: Snapshot<S>;
  readonly applied: readonly AppliedRecord<S, E>[];
  readonly conflicts: readonly Conflict<S, E>[];
  /** Retries dropped because an event with the same key came first. */
  readonly duplicates: number;
}

export function replay<S extends string, E extends string, C>(
  machine: Machine<S, E, C>,
  start: Snapshot<S>,
  queue: readonly QueuedEvent<E, C>[],
  replayedAt: number,
): ReplayResult<S, E> {
  // Original occurrence order. Array sort is stable, so equal timestamps keep
  // their queue order.
  const ordered = [...queue].sort((a, b) => a.at - b.at);

  const seen = new Set<string>();
  const unique: QueuedEvent<E, C>[] = [];
  let duplicates = 0;
  for (const q of ordered) {
    if (q.idempotencyKey !== undefined) {
      if (seen.has(q.idempotencyKey)) {
        duplicates++;
        continue;
      }
      seen.add(q.idempotencyKey);
    }
    unique.push(q);
  }

  let snapshot = start;
  const applied: AppliedRecord<S, E>[] = [];
  const conflicts: Conflict<S, E>[] = [];
  for (const q of unique) {
    const out = apply(machine, snapshot, q.event, { at: q.at, by: q.by, reason: q.reason }, q.ctx);
    if (out.ok) {
      snapshot = out.snapshot;
      applied.push({ ...out.record, delayedMs: Math.max(0, replayedAt - q.at) });
    } else {
      conflicts.push({
        code: 'RECONCILIATION_CONFLICT',
        rejection: out.rejection,
        from: out.from,
        event: out.event,
        at: out.at,
        by: out.by,
        reason: out.reason,
      });
    }
  }

  return { snapshot, applied, conflicts, duplicates };
}
