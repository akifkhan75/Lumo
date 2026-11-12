import { GLOBAL_DEFAULT } from './profiles/global-default';
import type { EmergencyNumber, RegionProfile, SubdivisionCode } from './types';

/**
 * Which market's rules apply right now (docs/specs/REGION_PROFILES.md §5).
 *
 * The profile in force is a function of where the DEVICE IS, not of who the account
 * belongs to: a Californian in Pakistan must be offered 15; a Pakistani in Illinois
 * must get all-party recording rules.
 *
 * NO GEOCODING HERE. This package takes already-resolved country and subdivision
 * codes and never turns coordinates into places. Approximating a province or state
 * with a bounding box would give a wrong number to someone near a boundary, and a
 * wrong number in an emergency is the failure this whole package exists to prevent.
 * Nothing in the repo yet converts a coordinate to a country and subdivision; that
 * is milestone 1.4's job (KNOWN_ISSUES).
 *
 * EVERY UNCERTAINTY FAILS TOWARD THE SAFER ANSWER, and is STATED, never papered over.
 */

/**
 * How recent a fix must be to count as "where the device is now". The spec uses
 * "current" and "last known" without defining the boundary; five minutes is the
 * choice made here. A phone can cross a border in less than that on a train, and
 * can cross one in an hour on a plane — so a fix older than this is never treated
 * as current, only as a last-known location whose age is shown.
 */
export const CURRENT_FIX_MAX_AGE_MS = 5 * 60 * 1000;

/** A location already resolved to a place by something outside this package. */
export interface LocationFix {
  /** ISO 3166-1 alpha-2. An empty country means the place could not be resolved. */
  readonly country: string;
  readonly subdivision?: SubdivisionCode | null;
  /** Epoch ms of the fix, by the device clock. */
  readonly capturedAt: number;
  readonly accuracyM: number;
}

export interface ResolveInput {
  /** Injected clock, epoch ms. */
  readonly now: number;
  /** The device's most recent fix. Its age decides whether it is current. */
  readonly fix?: LocationFix | null;
  /** Country of the SIM or the network. */
  readonly simCountry?: string | null;
  readonly accountCountry?: string | null;
}

export type ResolutionSource = 'current-location' | 'last-known-location' | 'network-country' | 'account-country' | 'none';

export interface Resolution {
  readonly source: ResolutionSource;
  /** True ONLY for a current fix. Everything else is a best guess and says so. */
  readonly confirmed: boolean;
  readonly country: string | null;
  readonly subdivision: SubdivisionCode | null;
  /** Age of the fix, when the answer came from one. */
  readonly fixAgeMs: number | null;
  /** Null when Lumo has no profile for the resolved country, or nothing is known. */
  readonly profile: RegionProfile | null;
  /** What is uncertain, in words. Null only when the answer is confirmed. */
  readonly note: string | null;
}

/** "3 hours", "1 minute": how old a location is, in the largest sensible unit. */
export function describeAge(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} days`;
}

const clean = (s: string | null | undefined): string | null => {
  const v = s?.trim().toUpperCase();
  return v ? v : null;
};

export function resolveRegion(input: ResolveInput, profiles: readonly RegionProfile[]): Resolution {
  // Walk the sources in the spec's order and take the FIRST that yields a country.
  // Once one does, never fall back to a lower one: a Californian whose location says
  // the UK must not be shown 911 just because the UK has no profile (the account
  // country is consulted only when the location is genuinely unavailable).
  let source: ResolutionSource = 'none';
  let country: string | null = null;
  let subdivision: SubdivisionCode | null = null;
  let fixAgeMs: number | null = null;

  const fixCountry = clean(input.fix?.country);
  if (input.fix && fixCountry) {
    // A fix stamped in the future (clock skew) is treated as brand new, not negative-aged.
    fixAgeMs = Math.max(0, input.now - input.fix.capturedAt);
    source = fixAgeMs <= CURRENT_FIX_MAX_AGE_MS ? 'current-location' : 'last-known-location';
    country = fixCountry;
    subdivision = clean(input.fix.subdivision);
  } else if (clean(input.simCountry)) {
    source = 'network-country';
    country = clean(input.simCountry);
  } else if (clean(input.accountCountry)) {
    source = 'account-country';
    country = clean(input.accountCountry);
  }

  const profile = country ? (profiles.find((p) => p.id === country) ?? null) : null;
  const confirmed = source === 'current-location';

  let note: string | null = null;
  if (!confirmed) {
    if (country === null) {
      note = "We couldn't determine your location or country.";
    } else if (profile === null) {
      note = `Lumo has no emergency-number data for ${country}, and we couldn't confirm your location.`;
    } else if (source === 'last-known-location') {
      note = `Based on your last known location (${describeAge(fixAgeMs as number)} ago); we couldn't confirm where you are now.`;
    } else if (source === 'network-country') {
      note = `Showing ${profile.displayName} emergency numbers based on your mobile network; we couldn't confirm your location.`;
    } else {
      note = `Showing ${profile.displayName} emergency numbers; we couldn't confirm your location.`;
    }
  } else if (profile === null) {
    note = `Lumo has no emergency-number data for ${country}.`;
  }

  return { source, confirmed, country, subdivision, fixAgeMs, profile, note };
}

export interface EmergencyNumbers {
  /** Numbers that apply where the resolution says the device is. */
  readonly numbers: readonly EmergencyNumber[];
  /**
   * Regional numbers (PK's 1122 works in Punjab only) that MAY apply but whose
   * region could not be confirmed. Neither dropped — that could hide the right
   * number — nor asserted — that could send someone to a number that does not work
   * where they are. The UI labels them as possible.
   */
  readonly possibleNumbers: readonly EmergencyNumber[];
  readonly basis: 'profile' | 'global-default';
  /** The numbers have been verified and approved. A draft profile's are NOT. */
  readonly verified: boolean;
  readonly note: string | null;
}

/**
 * Emergency numbers come from ANY known profile, enabled or not. Enablement decides
 * whether Lumo provides service in a market, not whether a person is shown 911.
 */
export function emergencyNumbersFor(resolution: Resolution): EmergencyNumbers {
  const { profile } = resolution;
  if (profile === null) {
    return { numbers: GLOBAL_DEFAULT.numbers, possibleNumbers: [], basis: 'global-default', verified: false, note: resolution.note };
  }

  const all = profile.emergency.numbers;
  const regionConfirmed = resolution.confirmed && resolution.subdivision !== null;
  const applies = (n: EmergencyNumber) =>
    n.scope === 'national' || (regionConfirmed && (n.regions ?? []).includes(resolution.subdivision as string));
  // A subnational number is "possible" only if we cannot rule it out; with a
  // confirmed region that is not in its list, it is ruled out and omitted.
  const possible = (n: EmergencyNumber) => n.scope === 'subnational' && !regionConfirmed;

  return {
    numbers: all.filter(applies),
    possibleNumbers: all.filter(possible),
    basis: 'profile',
    verified: profile.status === 'approved' && profile.checklist.numbersVerified === true,
    note: resolution.note,
  };
}

export interface RecordingRule {
  readonly consent: 'one-party' | 'all-party' | 'prohibited';
  readonly basis:
    | 'profile'
    | 'subdivision-override'
    | 'subdivision-unlisted'
    | 'location-unconfirmed'
    | 'no-profile';
  readonly reason: string;
  /** What must be shown/said to the people being recorded. */
  readonly notice: { readonly onScreen: boolean; readonly audible: boolean };
}

/**
 * Recording consent resolves from a CURRENT FIX ONLY — never the account, never a
 * stale location. In an all-party jurisdiction, recording without consent can be a
 * criminal offence committed by the user, in a moment of crisis, because our app
 * started recording. So whenever anything is unknown the answer is the MOST
 * RESTRICTIVE rule, with the reason stated:
 *
 * - location not current              → all-party
 * - no profile for the country        → all-party
 * - a `varies-subnational` market and the subdivision is unknown OR not listed
 *                                     → all-party. The US list names nine states while
 *   the spec's own text says "roughly a dozen", so it is known to be incomplete: an
 *   unlisted state must never default to one-party. Pakistan lists none, so it is
 *   all-party everywhere until counsel answers.
 *
 * Counsel must advise whether an emergency exception exists; none is assumed.
 */
export function recordingRuleFor(resolution: Resolution): RecordingRule {
  const strict = (basis: RecordingRule['basis'], reason: string): RecordingRule => ({
    consent: 'all-party',
    basis,
    reason,
    notice: { onScreen: true, audible: true },
  });

  if (!resolution.confirmed) {
    return strict('location-unconfirmed', "We can't confirm where you are, so the strictest recording rule applies.");
  }
  const { profile } = resolution;
  if (profile === null) {
    return strict('no-profile', `Lumo has no recording rules for ${resolution.country}, so the strictest rule applies.`);
  }

  const { recording } = profile;
  const notice = { onScreen: recording.requiresOnScreenNotice, audible: recording.requiresAudibleNotice };

  if (recording.audioConsent !== 'varies-subnational') {
    return { consent: recording.audioConsent, basis: 'profile', reason: `${profile.displayName} rule.`, notice };
  }

  const override = resolution.subdivision ? recording.subnationalOverrides?.[resolution.subdivision] : undefined;
  if (override) {
    return { consent: override, basis: 'subdivision-override', reason: `${profile.displayName}, ${resolution.subdivision}.`, notice };
  }
  return strict(
    'subdivision-unlisted',
    resolution.subdivision
      ? `${resolution.subdivision} is not a listed ${profile.displayName} subdivision, so the strictest rule applies.`
      : `We couldn't confirm your ${profile.displayName} state or province, so the strictest rule applies.`,
  );
}

/** May any copy imply official dispatch? Only with a signed agreement on record. */
export function mayClaimDispatch(profile: RegionProfile | null): boolean {
  return (
    profile !== null &&
    profile.emergency.canClaimDispatch &&
    (profile.emergency.dispatchPartner?.agreementRef ?? '').trim() !== ''
  );
}
