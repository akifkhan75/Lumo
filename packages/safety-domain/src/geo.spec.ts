import { describe, expect, it } from 'vitest';
import { ARRIVAL_MAX_ACCURACY_M, ARRIVAL_RADIUS_M, atDestination, distanceMetres } from './geo';

const HOME = { latitude: 33.6844, longitude: 73.0479 };
/** `m` metres due north of HOME. */
const north = (m: number) => ({ latitude: HOME.latitude + m / 111_195, longitude: HOME.longitude });

describe('distanceMetres', () => {
  it('is 0 for the same point and about 111 km per degree of latitude', () => {
    expect(distanceMetres(HOME, HOME)).toBe(0);
    expect(Math.round(distanceMetres({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }) / 1000)).toBe(111);
  });
  it('is symmetric', () => {
    expect(distanceMetres(HOME, north(500))).toBeCloseTo(distanceMetres(north(500), HOME), 6);
  });
  it('measures a short hop to within a metre', () => {
    expect(distanceMetres(HOME, north(100))).toBeGreaterThan(99);
    expect(distanceMetres(HOME, north(100))).toBeLessThan(101);
  });
});

describe('atDestination', () => {
  it('a precise fix inside the radius is an arrival', () => {
    expect(atDestination({ ...north(40), accuracyM: 10 }, HOME)).toBe(true);
  });
  it('a precise fix just outside is not', () => {
    expect(atDestination({ ...north(ARRIVAL_RADIUS_M + 15), accuracyM: 10 }, HOME)).toBe(false);
  });
  it('an imprecise fix near the destination is NOT an arrival: it is left to the person to confirm', () => {
    expect(atDestination({ ...north(10), accuracyM: ARRIVAL_MAX_ACCURACY_M + 1 }, HOME)).toBe(false);
    expect(atDestination({ ...north(10), accuracyM: ARRIVAL_MAX_ACCURACY_M }, HOME)).toBe(true);
  });
  it('an unknown or negative accuracy never counts', () => {
    expect(atDestination({ ...north(1), accuracyM: NaN }, HOME)).toBe(false);
    expect(atDestination({ ...north(1), accuracyM: -1 }, HOME)).toBe(false);
  });
});
