import { ApiError } from '@lumo/api-client';

/**
 * When an SOS could not reach Lumo (docs/specs/OFFLINE_SOS.md). Pure: no clock, no I/O.
 *
 * Whether to keep trying depends on WHY it failed. No signal, a timeout, a server that is down: try again, with the same key, so a request
 * that did get through is returned and not repeated. Being refused is different: signed out, too long ago, a key clash: trying again
 * cannot change the answer, so the person is told instead.
 */

/** Seconds between automatic tries: quick at first (a lift, a tunnel), then no slower than half a minute. */
export const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 30000] as const;
export const retryDelayMs = (attempt: number): number => RETRY_DELAYS_MS[Math.min(Math.max(0, attempt), RETRY_DELAYS_MS.length - 1)];

export type FailureKind =
  /** Could not reach Lumo, or Lumo failed: nothing is known to have been sent. Keep trying. */
  | 'retry'
  /** Refused as too long ago. Nothing was sent. */
  | 'tooLate'
  /** The credential was rejected. */
  | 'signedOut'
  /** Refused for another reason (a clash, a bad request). Said as the server said it; not retried. */
  | 'refused';

export function classifyFailure(e: unknown): FailureKind {
  if (!(e instanceof ApiError)) return 'retry';
  if (e.kind === 'network' || e.kind === 'timeout') return 'retry';
  if (e.tooLate) return 'tooLate';
  if (e.status === 401 || e.status === 403) return 'signedOut';
  if (e.status !== null && (e.status >= 500 || e.status === 408 || e.status === 429)) return 'retry';
  return 'refused';
}
