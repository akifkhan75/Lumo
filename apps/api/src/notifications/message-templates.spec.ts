import { describe, it, expect } from 'vitest';
import { alertBody, locationLine, resolvedBody } from './message-templates';

const NOW = Date.UTC(2026, 10, 18, 12, 30);
const loc = (ageMs: number, accuracyM = 18) => ({ latitude: 33.6844, longitude: 73.0479, accuracyM, capturedAt: NOW - ageMs });

describe('locationLine', () => {
  it('a fresh fix states its UTC time, age and precision, and is not "last known"', () => {
    const t = locationLine(loc(60_000), NOW);
    expect(t).toContain('12:29 UTC');
    expect(t).toContain('about 1 min before this was sent');
    expect(t).toContain('within 18 m');
    expect(t).toContain('maps.google.com/?q=33.6844,73.0479');
    expect(t).not.toContain('Last known');
  });
  it('exactly at the limit is still current; one millisecond past is last known', () => {
    expect(locationLine(loc(5 * 60_000), NOW)).not.toContain('Last known');
    const t = locationLine(loc(5 * 60_000 + 1), NOW);
    expect(t).toContain('Last known location');
    expect(t).toContain('they may have moved');
  });
  it('a fix stamped in the future is treated as new, not negative-aged', () => {
    expect(locationLine(loc(-30_000), NOW)).toContain('about 0 min');
  });
  it('rounds accuracy', () => expect(locationLine(loc(0, 17.6), NOW)).toContain('within 18 m'));
});

describe('alertBody', () => {
  it('says plainly when there is no position, and never claims help is coming', () => {
    const t = alertBody('Joyce', null, NOW);
    expect(t).toContain('Their location was not available');
    expect(t.toLowerCase()).not.toMatch(/help is|on the way|notified|safe/);
  });
  it('names who asked and says replies are not read', () => {
    expect(alertBody('Joyce', loc(0), NOW)).toMatch(/^Joyce asked Lumo to alert you\./);
    expect(alertBody('Joyce', null, NOW)).toContain('replies are not read');
  });
});

describe('resolvedBody', () => {
  it('says it ended, with no position and no call to action', () => {
    const t = resolvedBody('Joyce');
    expect(t).toContain('ended the alert');
    expect(t).not.toMatch(/maps|https?:/);
  });
});
