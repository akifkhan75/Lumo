import { sha256Hex } from './sha256';
import type { TriggerType } from './types';

/**
 * The idempotency key (docs/specs/SAFETY_STATE_MACHINES.md §4).
 *
 *   sha256(userId · triggerType · floor(triggerAtMs / 60000) · sessionId?)
 *
 * Minted on the DEVICE before the first attempt, so every retry of one
 * activation carries the same key. A repeat key returns the existing incident
 * with HTTP 200 instead of creating another, which is what stops a phone that
 * loses signal and retries three times from raising three incidents, three
 * fan-outs and three sets of SMS charges.
 *
 * WHAT THE KEY DOES, AND DOES NOT, GUARANTEE
 *
 * It collapses RETRIES OF THE SAME ACTIVATION: the same triggerAtMs always
 * yields the same key, however many times it is sent and however skewed the
 * device clock is. It does NOT merge two separate activations that are close in
 * time. The one-minute bucket has a boundary, so two triggers two seconds apart
 * that straddle it get different keys. The spec's "two triggers within 60s → one
 * incident" therefore cannot be met by the key alone; it needs a server-side rule
 * (an open incident absorbing a new trigger). See KNOWN_ISSUES.
 */

export const IDEMPOTENCY_BUCKET_MS = 60_000;

/**
 * Fields are joined with a delimiter that cannot appear in them. The spec writes
 * the formula with `+`, which is ambiguous: ("ab","c") and ("a","bc") would
 * concatenate identically. U+001F is the ASCII unit separator.
 */
export const KEY_FIELD_SEPARATOR = '\u001f';

export interface IdempotencyInput {
  readonly userId: string;
  readonly triggerType: TriggerType;
  /** When the trigger fired, by the DEVICE clock. Epoch milliseconds. */
  readonly triggerAtMs: number;
  readonly sessionId?: string | null;
}

export const idempotencyBucket = (triggerAtMs: number): number => Math.floor(triggerAtMs / IDEMPOTENCY_BUCKET_MS);

/**
 * Throws RangeError on input that would produce a colliding or meaningless key,
 * because failing loudly beats two different activations silently sharing one.
 */
export function idempotencyKey(input: IdempotencyInput): string {
  if (!Number.isFinite(input.triggerAtMs)) throw new RangeError('triggerAtMs must be a finite number');
  const sessionId = input.sessionId ?? '';
  for (const field of [input.userId, input.triggerType, sessionId]) {
    if (field.includes(KEY_FIELD_SEPARATOR)) throw new RangeError('A key field may not contain the field separator');
  }
  return sha256Hex(
    [input.userId, input.triggerType, String(idempotencyBucket(input.triggerAtMs)), sessionId].join(KEY_FIELD_SEPARATOR),
  );
}
