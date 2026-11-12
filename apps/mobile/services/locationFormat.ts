import { CURRENT_FIX_MAX_AGE_MS, describeAge } from '@lumo/region-profiles';

/**
 * How a position is shown (docs/specs/LOCATION.md).
 *
 * The rule is that a position is NEVER bare. It always states how old it is and how
 * precise it is, and a fix older than the freshness limit is called "last known" and
 * says it is not where the person is now. A pin ten minutes stale, or off by a
 * kilometre, sends someone to the wrong place with false confidence; that is worse than
 * showing nothing.
 *
 * Pure: the clock is passed in. No coordinates are produced as text here, so none can
 * end up on screen or in a log by this route.
 */

export interface Fix {
  readonly latitude: number;
  readonly longitude: number;
  /** Required, and never defaulted. A fix whose accuracy is unknown is not a fix. */
  readonly accuracyM: number;
  /** Epoch ms, by the device clock. */
  readonly capturedAt: number;
}

export const fixAgeMs = (fix: Fix, now: number): number => Math.max(0, now - fix.capturedAt);

/** One definition of "current", shared with the region resolver. */
export const isStale = (fix: Fix, now: number): boolean => fixAgeMs(fix, now) > CURRENT_FIX_MAX_AGE_MS;

export function formatAccuracy(metres: number): string {
  if (metres < 1000) return `±${Math.round(metres)} m`;
  const km = metres / 1000;
  return `±${km >= 10 ? Math.round(km) : Math.round(km * 10) / 10} km`;
}

const ageText = (ageMs: number): string => (ageMs < 60_000 ? 'just now' : `${describeAge(ageMs)} ago`);

export function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export interface FixDescription {
  readonly stale: boolean;
  /** "Location 9:41 PM (just now), ±18 m" or "Last known location 9:41 PM (12 minutes ago), ±18 m". */
  readonly text: string;
  /** Only for a stale fix: the sentence that stops it being read as the present. */
  readonly warning: string | null;
}

export function describeFix(fix: Fix, now: number): FixDescription {
  const age = fixAgeMs(fix, now);
  const stale = isStale(fix, now);
  const when = `${formatClock(fix.capturedAt)} (${ageText(age)}), ${formatAccuracy(fix.accuracyM)}`;
  return stale
    ? { stale, text: `Last known location ${when}`, warning: "This is not where you are now." }
    : { stale, text: `Location ${when}`, warning: null };
}
