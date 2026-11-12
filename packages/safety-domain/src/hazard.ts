/**
 * Hazard-report policy that the device and the server must agree on
 * (ADR-0010). It lives here so they cannot disagree about whether a report is
 * live or whether it is allowed to steer anything.
 *
 * The type list is declared here, not imported from `@lumo/types` or Prisma,
 * because this package has no dependencies. The API asserts at compile time that
 * its Prisma enum and this list are the same set, so a new enum member without a
 * decay time fails the build.
 */

export const HAZARD_TYPES = [
  'POOR_LIGHTING',
  'OBSTRUCTED_PATH',
  'BROKEN_INFRASTRUCTURE',
  'UNSAFE_CROSSING',
  'THEFT_REPORTED',
  'HARASSMENT_REPORTED',
  'AGGRESSION_REPORTED',
  'OTHER',
] as const;
export type HazardTypeKey = (typeof HAZARD_TYPES)[number];

export const HAZARD_SOURCES = ['COMMUNITY', 'VERIFIED_PARTNER', 'OFFICIAL_FEED'] as const;
export type HazardSourceKey = (typeof HAZARD_SOURCES)[number];

/**
 * How long an observation of each condition stays current. Decay is mandatory:
 * a report with no expiry becomes a permanent mark on a place, which is the
 * failure mode ADR-0010 exists to remove.
 *
 * The values differ by physics, not by how alarming the type sounds. A kerb stays
 * broken for weeks; a blocked path is usually cleared in days.
 */
export const HAZARD_TTL_DAYS: Readonly<Record<HazardTypeKey, number>> = {
  POOR_LIGHTING: 30,
  OBSTRUCTED_PATH: 7,
  BROKEN_INFRASTRUCTURE: 60,
  UNSAFE_CROSSING: 90,
  THEFT_REPORTED: 14,
  HARASSMENT_REPORTED: 14,
  AGGRESSION_REPORTED: 14,
  OTHER: 7,
};

/** Independent confirmations before a community report may influence routing. */
export const HAZARD_CONFIRMATION_FLOOR = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a report made (or re-confirmed) at `fromMs` stops being current. */
export const hazardExpiresAt = (type: HazardTypeKey, fromMs: number): number => fromMs + HAZARD_TTL_DAYS[type] * DAY_MS;

/** A report is served only while its expiry is in the future. */
export const isHazardLive = (expiresAtMs: number, nowMs: number): boolean => expiresAtMs > nowMs;

/**
 * A lone community report is displayed but must not steer anything. A verified
 * source is trusted without community confirmation.
 */
export const hazardInfluencesRouting = (source: HazardSourceKey, confirmationCount: number): boolean =>
  source !== 'COMMUNITY' || confirmationCount >= HAZARD_CONFIRMATION_FLOOR;
