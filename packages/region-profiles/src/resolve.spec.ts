import { describe, expect, it } from 'vitest';
import { PK, PROFILES, US } from './profiles';
import { approvedProfile } from './testing/fixtures';
import {
  CURRENT_FIX_MAX_AGE_MS, describeAge, emergencyNumbersFor, mayClaimDispatch, recordingRuleFor, resolveRegion,
  type LocationFix, type ResolveInput,
} from './resolve';

const NOW = 1_700_000_000_000;
const fix = (country: string, subdivision?: string | null, ageMs = 0): LocationFix => ({
  country, subdivision, capturedAt: NOW - ageMs, accuracyM: 20,
});
const resolve = (input: Partial<ResolveInput>, profiles = PROFILES) => resolveRegion({ now: NOW, ...input }, profiles);
const numbers = (input: Partial<ResolveInput>) => emergencyNumbersFor(resolve(input)).numbers.map((n) => n.number);
const possible = (input: Partial<ResolveInput>) => emergencyNumbersFor(resolve(input)).possibleNumbers.map((n) => n.number);

describe('resolution order (§5): location first, and the device’s place beats the account’s', () => {
  it('a current fix wins over the SIM and the account, and is confirmed', () => {
    const r = resolve({ fix: fix('PK', 'PB'), simCountry: 'US', accountCountry: 'US' });
    expect(r).toMatchObject({ source: 'current-location', confirmed: true, country: 'PK', subdivision: 'PB', note: null });
    expect(r.profile).toBe(PK);
  });

  it('SIM / network country is the next source, and is NOT confirmed', () => {
    const r = resolve({ simCountry: 'us', accountCountry: 'PK' });
    expect(r).toMatchObject({ source: 'network-country', confirmed: false, country: 'US', subdivision: null });
    expect(r.profile).toBe(US);
    expect(r.note).toContain('mobile network');
  });

  it('the account country is used only when nothing else is known', () => {
    const r = resolve({ accountCountry: 'PK' });
    expect(r).toMatchObject({ source: 'account-country', confirmed: false, country: 'PK' });
  });

  it('with nothing known there is no profile and the note says so', () => {
    const r = resolve({});
    expect(r).toMatchObject({ source: 'none', confirmed: false, country: null, profile: null });
    expect(r.note).toBe("We couldn't determine your location or country.");
  });

  it('blank and whitespace sources are treated as absent', () => {
    expect(resolve({ fix: fix('  '), simCountry: ' ', accountCountry: 'PK' }).source).toBe('account-country');
    expect(resolve({ fix: null, simCountry: '', accountCountry: '' }).source).toBe('none');
  });

  it('a fix the geocoder could not place falls through to the next source', () => {
    expect(resolve({ fix: fix(''), simCountry: 'US' }).source).toBe('network-country');
  });
});

describe('a known location is never overridden by the account (the Californian in the UK)', () => {
  it('a US account whose current fix is in the UK is NOT shown 911', () => {
    const r = resolve({ fix: fix('GB'), accountCountry: 'US', simCountry: 'US' });
    expect(r).toMatchObject({ source: 'current-location', country: 'GB', profile: null });
    const e = emergencyNumbersFor(r);
    expect(e.basis).toBe('global-default');
    expect(e.numbers.map((n) => n.number)).not.toContain('911');
    expect(e.verified).toBe(false);
    expect(e.note).toBe('Lumo has no emergency-number data for GB.');
  });

  it('the same holds for a stale fix and for the network country', () => {
    expect(resolve({ fix: fix('GB', null, 60 * 60_000), accountCountry: 'US' }).profile).toBeNull();
    expect(resolve({ simCountry: 'GB', accountCountry: 'US' }).profile).toBeNull();
  });

  it('with no profile for an unconfirmed country, the note says both things', () => {
    expect(resolve({ simCountry: 'GB' }).note).toBe("Lumo has no emergency-number data for GB, and we couldn't confirm your location.");
  });
});

describe('what counts as a CURRENT fix', () => {
  it('exactly at the limit is current; one millisecond past is last-known', () => {
    expect(resolve({ fix: fix('PK', 'PB', CURRENT_FIX_MAX_AGE_MS) }).source).toBe('current-location');
    expect(resolve({ fix: fix('PK', 'PB', CURRENT_FIX_MAX_AGE_MS + 1) }).source).toBe('last-known-location');
  });
  it('the limit is five minutes', () => {
    expect(CURRENT_FIX_MAX_AGE_MS).toBe(300_000);
  });
  it('a fix stamped in the future (clock skew) is treated as brand new, never as negatively aged', () => {
    const r = resolve({ fix: fix('PK', 'PB', -90_000) });
    expect(r).toMatchObject({ source: 'current-location', fixAgeMs: 0 });
  });
  it('a last-known fix is never confirmed, states its age, and does not assert a region', () => {
    const r = resolve({ fix: fix('PK', 'PB', 3 * 60 * 60_000) });
    expect(r).toMatchObject({ source: 'last-known-location', confirmed: false, fixAgeMs: 3 * 60 * 60_000 });
    expect(r.note).toBe("Based on your last known location (3 hours ago); we couldn't confirm where you are now.");
  });
  it.each([
    [60_000 * 6, '6 minutes'], [60_000 * 60, '1 hour'], [60_000 * 60 * 5, '5 hours'],
    [60_000 * 60 * 47, '47 hours'], [60_000 * 60 * 24 * 3, '3 days'], [60_000 * 5.9 + 5 * 60_000, '11 minutes'],
  ])('describes an age of %d ms as %s', (ms, text) => {
    expect(resolve({ fix: fix('PK', 'PB', ms) }).note).toContain(`(${text} ago)`);
  });
  it('rounds to whole minutes', () => {
    expect(resolve({ now: NOW, fix: { country: 'PK', capturedAt: NOW - 300_001, accuracyM: 1 } }).note).toContain('(5 minutes ago)');
  });
});

describe('a position the geocoder could not place', () => {
  it('is flagged, and the note says so — it does not pass for "no location"', () => {
    const r = resolve({ fix: fix(''), accountCountry: 'US' });
    expect(r).toMatchObject({ unplacedFix: true, source: 'account-country', confirmed: false });
    expect(r.note).toBe("We have your position but couldn't tell which country you are in. Showing United States emergency numbers; we couldn't confirm your location.");
  });
  it('still never asserts the account country as confirmed', () => {
    expect(resolve({ fix: fix('  '), accountCountry: 'US' }).confirmed).toBe(false);
    expect(emergencyNumbersFor(resolve({ fix: fix(''), accountCountry: 'PK' })).possibleNumbers.map((n) => n.number)).toEqual(['1122']);
  });
  it('is also flagged when nothing else is known', () => {
    const r = resolve({ fix: fix('') });
    expect(r).toMatchObject({ unplacedFix: true, source: 'none' });
    expect(r.note).toBe("We have your position but couldn't tell which country you are in. We couldn't determine your location or country.");
  });
  it('is NOT flagged when there is simply no fix, or when the fix was placed', () => {
    expect(resolve({ accountCountry: 'PK' }).unplacedFix).toBe(false);
    expect(resolve({ fix: fix('PK', 'PB') }).unplacedFix).toBe(false);
  });
});

describe('describeAge', () => {
  it.each([
    [60_000, '1 minute'], [120_000, '2 minutes'], [59 * 60_000, '59 minutes'],
    [60 * 60_000, '1 hour'], [2 * 60 * 60_000, '2 hours'], [47 * 60 * 60_000, '47 hours'],
    [48 * 60 * 60_000, '2 days'], [72 * 60 * 60_000, '3 days'],
  ])('%d ms is %s', (ms, text) => {
    expect(describeAge(ms)).toBe(text);
  });
});

describe('emergency numbers (§7)', () => {
  it('PK user in Punjab: 1122 is offered alongside 15', () => {
    expect(numbers({ fix: fix('PK', 'PB') })).toEqual(['15', '1122', '115', '130']);
    expect(possible({ fix: fix('PK', 'PB') })).toEqual([]);
  });

  it('PK user in Sindh: 1122 is NOT offered; 15 and 115 are', () => {
    expect(numbers({ fix: fix('PK', 'SD') })).toEqual(['15', '115', '130']);
    expect(possible({ fix: fix('PK', 'SD') })).toEqual([]); // ruled out, so omitted entirely
  });

  it('region codes are case-insensitive', () => {
    expect(numbers({ fix: fix('pk', 'pb') })).toContain('1122');
  });

  it('PK with a confirmed country but no subdivision: 1122 is POSSIBLE, neither dropped nor asserted', () => {
    expect(numbers({ fix: fix('PK') })).toEqual(['15', '115', '130']);
    expect(possible({ fix: fix('PK') })).toEqual(['1122']);
  });

  it('PK from a stale fix, even one inside Punjab: 1122 is only possible', () => {
    const input = { fix: fix('PK', 'PB', 60 * 60_000) };
    expect(numbers(input)).toEqual(['15', '115', '130']);
    expect(possible(input)).toEqual(['1122']);
  });

  it('PK from the account alone: national numbers, with the uncertainty stated in the spec’s own words', () => {
    const e = emergencyNumbersFor(resolve({ accountCountry: 'PK' }));
    expect(e.numbers.map((n) => n.number)).toEqual(['15', '115', '130']);
    expect(e.possibleNumbers.map((n) => n.number)).toEqual(['1122']);
    expect(e.note).toBe("Showing Pakistan emergency numbers; we couldn't confirm your location.");
  });

  it('a user who roams PK → US mid-journey gets the number from the location, not the account', () => {
    const account = { accountCountry: 'PK' };
    expect(numbers({ ...account, fix: fix('PK', 'PB') })).toContain('15');
    expect(numbers({ ...account, fix: fix('US', 'IL') })).toEqual(['911']);
  });

  it('a US user in Pakistan is offered 15', () => {
    expect(numbers({ accountCountry: 'US', fix: fix('PK', 'PB') })).toContain('15');
  });

  it('a confirmed answer carries no note', () => {
    expect(emergencyNumbersFor(resolve({ fix: fix('US', 'CA') })).note).toBeNull();
  });

  it('with nothing known, the fallback number is offered, flagged unverified, and the note says why', () => {
    const e = emergencyNumbersFor(resolve({}));
    expect(e).toMatchObject({ basis: 'global-default', verified: false, possibleNumbers: [] });
    expect(e.numbers).toHaveLength(1);
    expect(e.numbers[0].label).toContain('unverified');
    expect(e.note).toBe("We couldn't determine your location or country.");
  });
});

describe('a malformed regional number is never asserted', () => {
  it('a subnational number with no regions listed is not offered as applicable, even with a confirmed region', () => {
    const p = approvedProfile({ emergency: { ...approvedProfile().emergency, numbers: [
      { number: '100', label: 'Police', scope: 'national' },
      { number: '2000', label: 'Broken entry', scope: 'subnational' },
    ] } });
    const e = emergencyNumbersFor(resolveRegion({ now: NOW, fix: fix('ZZ', 'AA') }, [p]));
    expect(e.numbers.map((n) => n.number)).toEqual(['100']);
    expect(e.possibleNumbers).toEqual([]); // region confirmed, and not in its (empty) list
  });
});

describe('numbers are never hidden by the enablement gate', () => {
  it('a draft, unenabled profile still yields its numbers — flagged as not verified', () => {
    const e = emergencyNumbersFor(resolve({ fix: fix('US', 'CA') }));
    expect(e.numbers.map((n) => n.number)).toEqual(['911']);
    expect(e.verified).toBe(false);
  });
  it('an approved profile with its numbers verified is marked verified', () => {
    const p = approvedProfile();
    const e = emergencyNumbersFor(resolveRegion({ now: NOW, fix: fix('ZZ', 'AA') }, [p]));
    expect(e.verified).toBe(true);
    expect(e.numbers.map((n) => n.number)).toEqual(['100', '2000']);
  });
  it('approved but numbers not verified is not verified', () => {
    const p = approvedProfile({ checklist: { ...approvedProfile().checklist, numbersVerified: false } });
    expect(emergencyNumbersFor(resolveRegion({ now: NOW, fix: fix('ZZ') }, [p])).verified).toBe(false);
  });
});

describe('recording consent: current fix only, and the strictest rule whenever anything is unknown', () => {
  const rule = (input: Partial<ResolveInput>, profiles = PROFILES) => recordingRuleFor(resolve(input, profiles));

  it('US user in California: all-party rules apply, with notice', () => {
    expect(rule({ fix: fix('US', 'CA') })).toMatchObject({ consent: 'all-party', basis: 'subdivision-override', notice: { onScreen: true, audible: false } });
  });

  it('a US user whose ACCOUNT is elsewhere is judged by where the device is', () => {
    expect(rule({ accountCountry: 'PK', fix: fix('US', 'IL') }).consent).toBe('all-party');
  });

  it('US state missing from the spec’s (incomplete) list resolves to all-party, never one-party', () => {
    const r = rule({ fix: fix('US', 'TX') });
    expect(r).toMatchObject({ consent: 'all-party', basis: 'subdivision-unlisted', notice: { onScreen: true, audible: true } });
    expect(r.reason).toContain('TX is not a listed United States subdivision');
  });

  it('a confirmed US fix with no subdivision resolves to all-party too', () => {
    const r = rule({ fix: fix('US') });
    expect(r).toMatchObject({ consent: 'all-party', basis: 'subdivision-unlisted' });
    expect(r.reason).toContain("couldn't confirm your United States state or province");
  });

  it('Pakistan lists no subdivisions, so it is all-party everywhere until counsel answers', () => {
    for (const sub of ['PB', 'SD', 'KP', null]) expect(rule({ fix: fix('PK', sub) }).consent).toBe('all-party');
  });

  it.each([
    ['a stale fix', { fix: fix('US', 'TX', 60 * 60_000) }],
    ['the network country', { simCountry: 'US' }],
    ['the account country', { accountCountry: 'US' }],
    ['nothing at all', {}],
  ])('%s is not a current fix, so the strictest rule applies', (_n, input) => {
    expect(rule(input)).toMatchObject({ consent: 'all-party', basis: 'location-unconfirmed', notice: { onScreen: true, audible: true } });
  });

  it('a country with no profile gets the strictest rule', () => {
    const r = rule({ fix: fix('GB', 'ENG') });
    expect(r).toMatchObject({ consent: 'all-party', basis: 'no-profile' });
    expect(r.reason).toContain('GB');
  });

  describe('a uniform national rule needs no subdivision', () => {
    const profile = (audioConsent: 'one-party' | 'all-party' | 'prohibited') =>
      approvedProfile({ recording: { audioConsent, requiresOnScreenNotice: false, requiresAudibleNotice: true } });
    it.each(['one-party', 'all-party', 'prohibited'] as const)('%s', (audioConsent) => {
      const r = rule({ fix: fix('ZZ') }, [profile(audioConsent)]);
      expect(r).toMatchObject({ consent: audioConsent, basis: 'profile', notice: { onScreen: false, audible: true } });
    });
  });

  it('a varies-subnational profile can legitimately resolve a listed subdivision to one-party', () => {
    expect(rule({ fix: fix('ZZ', 'BB') }, [approvedProfile()])).toMatchObject({ consent: 'one-party', basis: 'subdivision-override' });
  });
});

describe('mayClaimDispatch (§7: canClaimDispatch false → no UI string implies official dispatch)', () => {
  it('is false for both real markets', () => {
    expect(mayClaimDispatch(PK)).toBe(false);
    expect(mayClaimDispatch(US)).toBe(false);
  });
  it('is false when there is no profile', () => {
    expect(mayClaimDispatch(null)).toBe(false);
  });
  it('needs BOTH the flag and a signed agreement on record', () => {
    const e = approvedProfile().emergency;
    expect(mayClaimDispatch(approvedProfile({ emergency: { ...e, canClaimDispatch: true } }))).toBe(false);
    expect(mayClaimDispatch(approvedProfile({ emergency: { ...e, canClaimDispatch: true, dispatchPartner: { id: 'p', agreementRef: '' } } }))).toBe(false);
    expect(mayClaimDispatch(approvedProfile({ emergency: { ...e, canClaimDispatch: false, dispatchPartner: { id: 'p', agreementRef: 'A-1' } } }))).toBe(false);
    expect(mayClaimDispatch(approvedProfile({ emergency: { ...e, canClaimDispatch: true, dispatchPartner: { id: 'p', agreementRef: 'A-1' } } }))).toBe(true);
  });
});

it('is deterministic: the same input gives the same resolution', () => {
  const input = { fix: fix('PK', 'PB'), accountCountry: 'US' };
  expect(resolve(input)).toEqual(resolve(input));
});
