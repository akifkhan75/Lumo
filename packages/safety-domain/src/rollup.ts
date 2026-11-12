import { CHANNEL_CAPABILITIES, type AttemptState } from './capabilities';
import { attemptStanding, type AttemptStanding } from './attempt';
import type { Channel } from './types';

/**
 * Per-attempt truth rolled up to the incident without inventing certainty
 * (docs/specs/DELIVERY_LEDGER.md §3).
 *
 * Rolled up PER RECIPIENT first. A fallback is a new attempt on the same
 * recipient, so "push failed, then SMS sent" is a recipient who was reached.
 * Counting attempts instead would report "couldn't reach Dad" for someone the
 * fallback did reach — or, worse, hide a real failure behind another
 * recipient's success.
 */

export interface AttemptView {
  readonly recipientId: string;
  readonly channel: Channel;
  readonly state: AttemptState;
}

export type RollupOutcome =
  | 'NOTIFYING'
  | 'NOTIFIED'
  | 'PARTIALLY_NOTIFIED'
  | 'ALL_CHANNELS_FAILED'
  | 'ACKNOWLEDGED';

export interface Rollup {
  readonly outcome: RollupOutcome;
  /** Named, so a failure is never collapsed into "2 of 3" without saying who. */
  readonly acknowledged: readonly string[];
  readonly reached: readonly string[];
  readonly pending: readonly string[];
  readonly failed: readonly string[];
}

// Best standing wins: one acknowledged channel makes the recipient acknowledged.
const RANK: Record<AttemptStanding, number> = { acknowledged: 3, reached: 2, pending: 1, failed: 0 };

export function rollupIncident(attempts: readonly AttemptView[]): Rollup {
  const best = new Map<string, AttemptStanding>();
  for (const a of attempts) {
    const standing = attemptStanding(a.state, CHANNEL_CAPABILITIES[a.channel]);
    const current = best.get(a.recipientId);
    if (current === undefined || RANK[standing] > RANK[current]) best.set(a.recipientId, standing);
  }

  const group = (s: AttemptStanding) => [...best].filter(([, v]) => v === s).map(([id]) => id);
  const acknowledged = group('acknowledged');
  const reached = group('reached');
  const pending = group('pending');
  const failed = group('failed');

  let outcome: RollupOutcome;
  if (acknowledged.length > 0) outcome = 'ACKNOWLEDGED';
  else if (pending.length > 0) outcome = 'NOTIFYING';
  else if (reached.length > 0) outcome = failed.length > 0 ? 'PARTIALLY_NOTIFIED' : 'NOTIFIED';
  else outcome = 'ALL_CHANNELS_FAILED'; // nobody reached — including nobody to reach

  return { outcome, acknowledged, reached, pending, failed };
}
