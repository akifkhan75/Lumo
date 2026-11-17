import type { AttemptState } from './capabilities';
import type { Channel } from './types';

/**
 * Practice Mode's ledger (docs/specs/PRACTICE_MODE.md). Pure and deterministic: no clock, no randomness, no I/O. It is imported by the
 * server (which stores the result) and by the app (which shows the same thing offline), so the two cannot disagree about what a
 * practice run looks like.
 *
 * NOTHING HERE SENDS ANYTHING, and nothing here can: it returns rows describing what a real run might look like. Every row is
 * `simulated: true`, and the reason of a failure says so ("SIMULATED_FAILURE"), so a practice ledger can never be read as a real one.
 *
 * The shape is chosen to teach reading the real ledger: a message that reached a phone (DELIVERED), one that was handed to a carrier
 * and is not confirmed (SENT), a person who could not be tried and why, and, whenever there are two or more attempts, one failure.
 */

export interface PracticeRecipient {
  readonly id: string;
  /** Alertable now: a contact who agreed, in order. Otherwise they are shown as not tried, with the reason. */
  readonly eligible: boolean;
  /** Why they could not be tried, when `eligible` is false. */
  readonly skipReason?: string;
  /** The channels the escalation step would use for them: one row each. */
  readonly channels: readonly Channel[];
}

export interface PracticeAttempt {
  readonly recipientId: string;
  readonly channel: Channel;
  readonly state: AttemptState;
  readonly reason: string | null;
  readonly simulated: true;
  /** Seconds after the run started that this row's state was reached (queued is 0). Fixed, so the timeline is stable. */
  readonly sentAfterS: number | null;
  readonly deliveredAfterS: number | null;
  readonly failedAfterS: number | null;
}

export const SIMULATED_FAILURE = 'SIMULATED_FAILURE';
export const PRACTICE_NOT_TRIED = 'CONSENT_NOT_AGREED';

const row = (recipientId: string, channel: Channel, state: AttemptState, reason: string | null, t: { s?: number; d?: number; f?: number }): PracticeAttempt => ({
  recipientId, channel, state, reason, simulated: true, sentAfterS: t.s ?? null, deliveredAfterS: t.d ?? null, failedAfterS: t.f ?? null,
});

/**
 * One row per recipient and channel, in order. Channels with a device receipt (push) show DELIVERED; one without (sms, voice, ...) shows
 * SENT, because that is all those channels can truthfully say. When two or more attempts would be made, the LAST one is a simulated
 * failure, so the person sees what a failure looks like and that the rest still stand.
 */
export function simulatePractice(recipients: readonly PracticeRecipient[]): PracticeAttempt[] {
  const out: PracticeAttempt[] = [];
  const tried: number[] = []; // indexes into `out` that are real-looking attempts, not "not tried"
  for (const r of recipients) {
    for (const channel of r.channels) {
      if (!r.eligible) {
        out.push(row(r.id, channel, 'FAILED', r.skipReason ?? PRACTICE_NOT_TRIED, { f: 0 }));
        continue;
      }
      tried.push(out.length);
      out.push(channel === 'push' ? row(r.id, channel, 'DELIVERED', null, { s: 1, d: 3 }) : row(r.id, channel, 'SENT', null, { s: 2 }));
    }
  }
  if (tried.length >= 2) {
    const last = tried[tried.length - 1];
    out[last] = row(out[last].recipientId, out[last].channel, 'FAILED', SIMULATED_FAILURE, { s: 2, f: 20 });
  }
  return out;
}
