import { describe, it, expect } from 'vitest';
import { toE164, countryOfRegionProfile } from './phone';

describe('toE164', () => {
  it.each([
    ['+92 300 1234567', undefined, '+923001234567'],
    ['0300 1234567', 'PK', '+923001234567'],
    ['(415) 555-2671', 'US', '+14155552671'],
    ['+1 415 555 2671', 'PK', '+14155552671'], // an explicit + wins over the default
  ])('%s (default %s) → %s', (raw, country, out) => {
    expect(toE164(raw, country)).toEqual({ ok: true, e164: out });
  });

  it('never assumes a country: a local number with none is refused', () => {
    expect(toE164('0300 1234567')).toEqual({ ok: false, reason: 'NEEDS_COUNTRY' });
    expect(toE164('0300 1234567', null)).toEqual({ ok: false, reason: 'NEEDS_COUNTRY' });
  });

  it('refuses numbers that cannot exist', () => {
    expect(toE164('+92 12', undefined)).toEqual({ ok: false, reason: 'INVALID' });
    expect(toE164('12345', 'PK')).toEqual({ ok: false, reason: 'INVALID' });
    expect(toE164('hello', 'US')).toEqual({ ok: false, reason: 'INVALID' });
    expect(toE164('+999 123456789')).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('the same person written two ways is one number', () => {
    expect(toE164('0300-1234567', 'PK')).toEqual(toE164('+92 (300) 123 4567'));
  });
});

describe('countryOfRegionProfile', () => {
  it('maps known profiles, and nothing else', () => {
    expect(countryOfRegionProfile('PK')).toBe('PK');
    expect(countryOfRegionProfile('us')).toBe('US');
    expect(countryOfRegionProfile('GB')).toBeNull();
    expect(countryOfRegionProfile(null)).toBeNull();
    expect(countryOfRegionProfile('UNRESOLVED')).toBeNull();
  });
});
