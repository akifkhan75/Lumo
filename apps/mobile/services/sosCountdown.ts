/**
 * The countdown, mirrored from the server (apps/api incident.service `clampCountdown`) so the screen can show
 * the right number before the server answers. The SERVER is the authority: it clamps whatever is asked, owns the
 * deadline, and dispatches even if this app is killed. This only decides what to ASK for and what to display.
 */
export type SosTrigger = 'manual' | 'shake' | 'voice' | 'crash';

export const MANUAL_COUNTDOWN_SECONDS = 3;
export const AUTOMATIC_COUNTDOWN_SECONDS = 10;

export const countdownFor = (trigger: SosTrigger): number => (trigger === 'manual' ? MANUAL_COUNTDOWN_SECONDS : AUTOMATIC_COUNTDOWN_SECONDS);

/** Whole seconds left, never negative; null if there is no deadline. */
export function secondsLeft(endsAtMs: number | null, nowMs: number): number | null {
  if (endsAtMs === null) return null;
  return Math.max(0, Math.ceil((endsAtMs - nowMs) / 1000));
}

export const TERMINAL = ['CLOSED', 'CANCELLED'] as const;
