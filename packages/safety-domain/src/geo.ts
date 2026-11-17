/**
 * Geometry for journeys (docs/specs/JOURNEY_GUARDIAN.md). Pure.
 *
 * Arrival is detected by a geofence OR confirmed by the person, never by a timer alone, and a fix is only trusted as far as its
 * own accuracy: a fix that could be anywhere within 400 m says nothing about being inside a 75 m circle.
 */

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

export interface LatLng {
  readonly latitude: number;
  readonly longitude: number;
}

/** Great-circle distance in metres. */
export function distanceMetres(a: LatLng, b: LatLng): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** How close counts as "there". */
export const ARRIVAL_RADIUS_M = 75;
/** A fix less precise than this is not evidence of being anywhere in particular. */
export const ARRIVAL_MAX_ACCURACY_M = 75;

/**
 * Has this fix put the person at the destination? Both must hold: it is within the radius, AND it is precise enough that
 * "within the radius" means something. An imprecise fix near the destination is NOT an arrival (it is left to the person to
 * confirm), and a precise fix just outside is not either.
 */
export function atDestination(fix: LatLng & { readonly accuracyM: number }, destination: LatLng): boolean {
  if (!(fix.accuracyM >= 0) || fix.accuracyM > ARRIVAL_MAX_ACCURACY_M) return false;
  return distanceMetres(fix, destination) <= ARRIVAL_RADIUS_M;
}
