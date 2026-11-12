import { describe, expect, it } from 'vitest';
import { HAZARD_CONFIRMATION_FLOOR, HAZARD_SOURCES, HAZARD_TTL_DAYS, HAZARD_TYPES, hazardExpiresAt, hazardInfluencesRouting, isHazardLive } from './hazard';

const DAY = 24 * 60 * 60 * 1000;

describe('hazard policy', () => {
  it('has a decay time for every type — decay is mandatory (ADR-0010)', () => {
    expect(Object.keys(HAZARD_TTL_DAYS).sort()).toEqual([...HAZARD_TYPES].sort());
    for (const t of HAZARD_TYPES) expect(HAZARD_TTL_DAYS[t]).toBeGreaterThan(0);
  });

  it('keeps the values the API shipped with', () => {
    expect(HAZARD_TTL_DAYS).toEqual({
      POOR_LIGHTING: 30, OBSTRUCTED_PATH: 7, BROKEN_INFRASTRUCTURE: 60, UNSAFE_CROSSING: 90,
      THEFT_REPORTED: 14, HARASSMENT_REPORTED: 14, AGGRESSION_REPORTED: 14, OTHER: 7,
    });
  });

  it('computes expiry from the moment of reporting or re-confirming', () => {
    expect(hazardExpiresAt('POOR_LIGHTING', 1000)).toBe(1000 + 30 * DAY);
    expect(hazardExpiresAt('OBSTRUCTED_PATH', 0)).toBe(7 * DAY);
  });

  it('serves a report only while its expiry is in the future', () => {
    expect(isHazardLive(1000, 999)).toBe(true);
    expect(isHazardLive(1000, 1000)).toBe(false); // expired exactly now is expired
    expect(isHazardLive(1000, 1001)).toBe(false);
  });

  describe('which reports may influence routing', () => {
    it('a lone community report must not steer anything', () => {
      expect(hazardInfluencesRouting('COMMUNITY', 0)).toBe(false);
      expect(hazardInfluencesRouting('COMMUNITY', HAZARD_CONFIRMATION_FLOOR - 1)).toBe(false);
    });
    it('a community report that has met the confirmation floor may', () => {
      expect(hazardInfluencesRouting('COMMUNITY', HAZARD_CONFIRMATION_FLOOR)).toBe(true);
    });
    it('a verified source is trusted without community confirmation', () => {
      expect(hazardInfluencesRouting('VERIFIED_PARTNER', 0)).toBe(true);
      expect(hazardInfluencesRouting('OFFICIAL_FEED', 0)).toBe(true);
    });
    it('covers every source', () => {
      expect(HAZARD_SOURCES).toHaveLength(3);
    });
  });

  it('the confirmation floor is 3', () => {
    expect(HAZARD_CONFIRMATION_FLOOR).toBe(3);
  });
});
