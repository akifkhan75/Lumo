import { describe, expect, it } from 'vitest';
import { PK, US } from './profiles';

/**
 * The spec's PK and US YAML (docs/specs/REGION_PROFILES.md §2 and §3), transcribed
 * BY HAND into assertions, so the spec is the thing being tested and not the code
 * testing itself. A number changed in the data fails here.
 *
 * Do NOT "fix" a value to make this pass: these numbers are unverified, and the
 * spec itself says counsel and operations must confirm them. If one is wrong, the
 * spec changes first, then this, then the data.
 *
 * Two translations, nothing else: the YAML's `device-direct-sms` is the domain's
 * `device_direct_sms`, and subdivisions are written as ISO 3166-2 codes
 * (the spec's "Punjab" is PB).
 */

describe('Pakistan, as the spec has it', () => {
  it('identity and gate', () => {
    expect(PK).toMatchObject({ id: 'PK', displayName: 'Pakistan', status: 'draft', legalReviewStatus: 'pending' });
  });

  it('emergency', () => {
    expect(PK.emergency.numbers).toEqual([
      { number: '15', label: 'Police', scope: 'national' },
      { number: '1122', label: 'Rescue / Emergency Service', scope: 'subnational', regions: ['PB'] },
      { number: '115', label: 'Ambulance (Edhi)', scope: 'national' },
      { number: '130', label: 'Motorway Police', scope: 'national' },
    ]);
    expect(PK.emergency.dialPolicy).toBe('user-initiated-only');
    expect(PK.emergency.dispatchPartner).toBeUndefined();
    expect(PK.emergency.canClaimDispatch).toBe(false);
  });

  it('messaging', () => {
    expect(PK.messaging).toEqual({
      smsProvider: { id: 'local-aggregator', contracted: false },
      voiceProvider: null,
      deviceDirectSmsAllowed: true,
      recipientConsentRequired: true,
      channels: ['push', 'sms', 'device_direct_sms', 'web'],
    });
  });

  it('recording', () => {
    expect(PK.recording).toEqual({ audioConsent: 'varies-subnational', requiresOnScreenNotice: true, requiresAudibleNotice: false });
  });

  it('privacy', () => {
    expect(PK.privacy).toEqual({
      regimes: ['PECA-2016', 'PDP-draft'],
      locationIsSensitiveCategory: true,
      minorConsentAge: 18,
      retention: { locationDays: 30, audioDays: 30, videoDays: 90, incidentYears: 2 },
      erasureSlaDays: 30,
    });
  });

  it('locale, commerce, feeds, competitors', () => {
    expect(PK.locale).toEqual({ languages: ['ur', 'en'], default: 'ur', rtl: true });
    expect(PK.commerce).toEqual({ currency: 'PKR', pricePoints: { plus: 299, family: 599, business: 399 }, taxHandling: 'inclusive' });
    expect(PK.publicAlertFeeds).toEqual(['NDMA', 'PDMA-Punjab']);
    expect(PK.knownCompetitors).toEqual(['PSCA Public Safety App', 'PSCA NextGen Safety App']);
  });
});

describe('United States, as the spec has it', () => {
  it('identity and gate', () => {
    expect(US).toMatchObject({ id: 'US', displayName: 'United States', status: 'draft', legalReviewStatus: 'pending' });
  });

  it('emergency', () => {
    expect(US.emergency.numbers).toEqual([{ number: '911', label: 'Emergency', scope: 'national' }]);
    expect(US.emergency.dialPolicy).toBe('user-initiated-only');
    expect(US.emergency.dispatchPartner).toBeUndefined();
    expect(US.emergency.canClaimDispatch).toBe(false);
  });

  it('messaging', () => {
    expect(US.messaging).toEqual({
      smsProvider: { id: 'twilio', contracted: false },
      voiceProvider: { id: 'twilio', contracted: false },
      deviceDirectSmsAllowed: true,
      recipientConsentRequired: true,
      registrationRequired: 'A2P-10DLC',
      registrationComplete: false,
      channels: ['push', 'sms', 'voice', 'device_direct_sms', 'web'],
    });
  });

  it('recording, including the nine all-party states the spec names', () => {
    expect(US.recording.audioConsent).toBe('varies-subnational');
    expect(US.recording.subnationalOverrides).toEqual({
      CA: 'all-party', FL: 'all-party', IL: 'all-party', MD: 'all-party', MA: 'all-party',
      MT: 'all-party', NH: 'all-party', PA: 'all-party', WA: 'all-party',
    });
    expect(US.recording.requiresOnScreenNotice).toBe(true);
    expect(US.recording.requiresAudibleNotice).toBe(false);
  });

  it('privacy', () => {
    expect(US.privacy).toEqual({
      regimes: ['CCPA-CPRA', 'state-comprehensive-laws', 'COPPA'],
      locationIsSensitiveCategory: true,
      minorConsentAge: 13,
      retention: { locationDays: 30, audioDays: 30, videoDays: 90, incidentYears: 7 },
      erasureSlaDays: 45,
    });
  });

  it('locale, commerce, feeds, competitors', () => {
    expect(US.locale).toEqual({ languages: ['en', 'es'], default: 'en', rtl: false });
    expect(US.commerce).toEqual({ currency: 'USD', pricePoints: { plus: 4.99, family: 9.99, business: 5 }, taxHandling: 'exclusive' });
    expect(US.publicAlertFeeds).toEqual(['NWS', 'IPAWS-public']);
    expect(US.knownCompetitors).toEqual(['Google Personal Safety', 'Apple safety features', 'Life360', 'Noonlight', 'Citizen']);
  });
});

describe('what the two profiles prove (spec §4): these differ by DATA alone', () => {
  it('differ on every axis the spec lists', () => {
    expect(PK.locale.rtl).not.toBe(US.locale.rtl);
    expect(PK.commerce.currency).not.toBe(US.commerce.currency);
    expect(PK.privacy.retention.incidentYears).not.toBe(US.privacy.retention.incidentYears);
    expect(PK.privacy.erasureSlaDays).not.toBe(US.privacy.erasureSlaDays);
    expect(PK.messaging.registrationRequired).not.toBe(US.messaging.registrationRequired);
    expect(PK.emergency.numbers.length).not.toBe(US.emergency.numbers.length);
  });
});
