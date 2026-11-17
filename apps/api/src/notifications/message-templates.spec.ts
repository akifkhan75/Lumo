import { describe, it, expect } from 'vitest';
import { alertBody, locationLine, pushBody, resolvedBody, voiceScript } from './message-templates';

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

describe('a missed check-in is not a plea for help, and the words say so', () => {
  it('names the check-in, says they may have forgotten or have no signal, and does not say they asked for help', () => {
    const t = alertBody('Joyce', null, NOW, 'missed_check_in');
    expect(t).toContain('had a Lumo check-in due and has not answered it');
    expect(t).toContain('may have forgotten or have no signal');
    expect(t).not.toContain('asked Lumo to alert you');
    expect(t.toLowerCase()).not.toMatch(/help is|in danger|emergency/);
  });
  it('a position in one is worded exactly as in an SOS: with its time, its precision, and "last known" when stale', () => {
    expect(alertBody('J', loc(20 * 60_000), NOW, 'missed_check_in')).toContain('Last known location');
  });
  it('the push and the call say the same, and an SOS is unchanged', () => {
    expect(pushBody('Joyce', 'missed_check_in')).toBe('Joyce has not answered a Lumo check-in.');
    expect(voiceScript('Joyce', 'missed_check_in')).toContain('has not answered a Lumo check-in');
    expect(pushBody('Joyce')).toBe('Joyce asked Lumo to alert you.');
    expect(voiceScript('Joyce')).toContain('asked Lumo to alert you');
  });
});

