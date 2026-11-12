import type { EmergencyNumber } from '../types';

/**
 * What to show when no market profile applies: a country Lumo has no profile for,
 * or no location or country known at all (REGION_PROFILES.md §5, step 5).
 *
 * THIS IS A NUMBER IN CODE, and it is not verified. The spec names a "global safe
 * default" and defines none. It is kept here as data, always returned with
 * `verified: false`, and must be signed off by operations and counsel before it is
 * relied on. Nothing in this package states which countries it works in, because
 * nothing here has established that.
 */
export const GLOBAL_DEFAULT = {
  verified: false as const,
  numbers: [
    { number: '112', label: 'International emergency number (unverified for your location)', scope: 'national' },
  ] as readonly EmergencyNumber[],
};
