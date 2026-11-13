import { CURRENT_FIX_MAX_AGE_MS } from '@lumo/region-profiles';
import { describeFix, formatAccuracy, isStale, type Fix } from '../services/locationFormat';
import { distanceMetres, placeApplies, shouldGeocode, GEOCODE_MIN_INTERVAL_MS, GEOCODE_REUSE_MAX_AGE_MS, type Geocoded } from '../services/placeTracking';

const T = 1_700_000_000_000;
const fix = (over: Partial<Fix> = {}): Fix => ({ latitude: 31.5, longitude: 74.3, accuracyM: 18, capturedAt: T, ...over });

describe('describeFix', () => {
  it('always states age and accuracy', () => {
    const d = describeFix(fix(), T + 120_000);
    expect(d.text).toMatch(/2 minutes ago/);
    expect(d.text).toMatch(/±18 m/);
    expect(d.stale).toBe(false);
    expect(d.warning).toBeNull();
  });
  it('says "just now" under a minute', () => {
    expect(describeFix(fix(), T + 10_000).text).toMatch(/just now/);
  });
  it('is current at exactly the limit and stale one millisecond past', () => {
    expect(isStale(fix(), T + CURRENT_FIX_MAX_AGE_MS)).toBe(false);
    const d = describeFix(fix(), T + CURRENT_FIX_MAX_AGE_MS + 1);
    expect(d.stale).toBe(true);
    expect(d.text).toMatch(/^Last known location/);
    expect(d.warning).toBe('This is not where you are now.');
  });
  it('treats a fix stamped in the future as new, not negative-aged', () => {
    expect(describeFix(fix({ capturedAt: T + 5000 }), T).text).toMatch(/just now/);
  });
  it('never prints coordinates', () => {
    expect(JSON.stringify(describeFix(fix(), T))).not.toMatch(/31\.5|74\.3/);
  });
});

describe('formatAccuracy', () => {
  it.each([[18.4, '±18 m'], [999, '±999 m'], [1500, '±1.5 km'], [25_000, '±25 km']])('%s', (m, out) => {
    expect(formatAccuracy(m)).toBe(out);
  });
});

describe('place tracking: a geocode belongs to its fix', () => {
  const g = (over: Partial<Geocoded> = {}): Geocoded => ({
    for: { latitude: 31.5, longitude: 74.3, capturedAt: T },
    requestedAt: T,
    ok: true,
    place: { country: 'PK', subdivision: 'PB' },
    ...over,
  });
  it('applies to a nearby, recent fix', () => {
    expect(placeApplies(g(), fix({ capturedAt: T + 60_000 }))).toBe(true);
  });
  it('does not apply once the fix moves materially', () => {
    expect(placeApplies(g(), fix({ latitude: 31.6 }))).toBe(false);
  });
  it('does not apply after the reuse window', () => {
    expect(placeApplies(g(), fix({ capturedAt: T + GEOCODE_REUSE_MAX_AGE_MS + 1 }))).toBe(false);
  });
  it('a failed geocode never applies, and null never applies', () => {
    expect(placeApplies(g({ ok: false }), fix())).toBe(false);
    expect(placeApplies(null, fix())).toBe(false);
    expect(placeApplies(g(), null)).toBe(false);
  });
  it('geocodes when none exists, not while one is in flight, and rate-limits after a failure', () => {
    expect(shouldGeocode(null, false, fix(), T)).toBe(true);
    expect(shouldGeocode(null, true, fix(), T)).toBe(false);
    const failed = g({ ok: false, requestedAt: T });
    expect(shouldGeocode(failed, false, fix(), T + GEOCODE_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(shouldGeocode(failed, false, fix(), T + GEOCODE_MIN_INTERVAL_MS)).toBe(true);
  });
  it('does not ask again while the existing result still applies', () => {
    expect(shouldGeocode(g({ requestedAt: T - 60_000 }), false, fix(), T)).toBe(false);
  });
  it('distance is ~0 for the same point and ~111 km per degree of latitude', () => {
    expect(distanceMetres({ latitude: 1, longitude: 1 }, { latitude: 1, longitude: 1 })).toBe(0);
    expect(Math.round(distanceMetres({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }) / 1000)).toBe(111);
  });
});
