import { describe, expect, it } from 'vitest';
import { ageSeconds, describeAccuracy, describeAge, freshness } from './age';

describe('age', () => {
  it('measures against the server time, never below zero', () => {
    expect(ageSeconds('2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z')).toBe(300);
    expect(ageSeconds('2026-01-01T10:05:00Z', '2026-01-01T10:00:00Z')).toBe(0);
  });
  it('describes ages in words', () => {
    expect(describeAge(10)).toBe('just now');
    expect(describeAge(60)).toBe('1 minute ago');
    expect(describeAge(600)).toBe('10 minutes ago');
    expect(describeAge(3600)).toBe('1 hour ago');
    expect(describeAge(3 * 3600)).toBe('3 hours ago');
    expect(describeAge(2 * 86400)).toBe('2 days ago');
  });
  it('never calls an old position fresh', () => {
    expect(freshness(30)).toBe('fresh');
    expect(freshness(300)).toBe('aging');
    expect(freshness(3600)).toBe('stale');
  });
  it('states accuracy honestly', () => {
    expect(describeAccuracy(12)).toBe('within about 10 m');
    expect(describeAccuracy(2500)).toBe('within about 2.5 km');
  });
});
