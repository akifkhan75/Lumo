import type { ResolvedPlace } from '@lumo/region-profiles';
import type { Fix } from './locationFormat';

/**
 * When a reverse-geocoded place may be reused for a newer fix, and when to ask again.
 *
 * A geocode BELONGS TO THE FIX IT CAME FROM. A newer fix must not simply inherit the
 * country of an older one: someone who has crossed a border since is not where they
 * were. But geocoding is rate-limited and needs the network, so asking on every fix is
 * not an option. The compromise is narrow and stated: a result is reused only for a
 * fix within a short distance and a short time of the one that was geocoded. Moving
 * further, or waiting longer, means it no longer applies and a new request is due.
 *
 * Pure: the clock is passed in.
 */

/** A newer fix this close to the geocoded one is taken to be in the same place. */
export const GEOCODE_REUSE_RADIUS_M = 100;
/** …and only for this long. */
export const GEOCODE_REUSE_MAX_AGE_MS = 2 * 60_000;
/** Never ask the platform geocoder more often than this, even after a failure. */
export const GEOCODE_MIN_INTERVAL_MS = 15_000;

export interface Geocoded {
  /** The fix this was requested for. */
  readonly for: Pick<Fix, 'latitude' | 'longitude' | 'capturedAt'>;
  readonly requestedAt: number;
  readonly ok: boolean;
  readonly place: ResolvedPlace;
}

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance. Used only to decide reuse — never to guess a place from coordinates. */
export function distanceMetres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** May this geocode be used as the place for `fix`? A failed one never can. */
export function placeApplies(geocoded: Geocoded | null, fix: Fix | null): boolean {
  if (!geocoded || !geocoded.ok || !fix) return false;
  return (
    Math.abs(fix.capturedAt - geocoded.for.capturedAt) <= GEOCODE_REUSE_MAX_AGE_MS &&
    distanceMetres(geocoded.for, fix) <= GEOCODE_REUSE_RADIUS_M
  );
}

export function shouldGeocode(geocoded: Geocoded | null, inFlight: boolean, fix: Fix, now: number): boolean {
  if (inFlight) return false;
  if (geocoded && now - geocoded.requestedAt < GEOCODE_MIN_INTERVAL_MS) return false;
  return !placeApplies(geocoded, fix);
}
