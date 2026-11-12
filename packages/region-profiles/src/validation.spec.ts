import { describe, expect, it } from 'vitest';
import { PK, US } from './profiles';
import { approvedProfile } from './testing/fixtures';
import { completenessIssues, enablementIssues, type ProfileIssueCode } from './validation';
import { CHECKLIST_ITEMS, type RegionProfile } from './types';

const codes = (p: RegionProfile) => completenessIssues(p).map((i) => i.code);
const enableCodes = (p: RegionProfile) => enablementIssues(p).map((i) => i.code);
const has = (p: RegionProfile, code: ProfileIssueCode) => expect(codes(p)).toContain(code);

describe('a sound, approved profile', () => {
  it('has no issues and may be enabled', () => {
    expect(completenessIssues(approvedProfile())).toEqual([]);
    expect(enablementIssues(approvedProfile())).toEqual([]);
  });
});

describe('the real markets are not enablable yet — that is the gate working', () => {
  it.each([PK, US])('$id is a draft with a pending legal review', (p) => {
    const issues = enableCodes(p);
    expect(issues).toContain('NOT_APPROVED');
    expect(issues).toContain('LEGAL_REVIEW_PENDING');
    expect(issues).toContain('REVIEWER_MISSING');
    expect(issues).toContain('CHECKLIST_INCOMPLETE');
  });

  it('PK is also structurally incomplete: it varies by subdivision but lists none, and its provider is unsigned', () => {
    expect(codes(PK)).toEqual(expect.arrayContaining(['OVERRIDES_MISSING', 'PROVIDER_NOT_CONTRACTED']));
  });

  it('US is structurally sound apart from providers and registration, which cannot exist yet', () => {
    expect(codes(US).sort()).toEqual(['PROVIDER_NOT_CONTRACTED', 'PROVIDER_NOT_CONTRACTED', 'REGISTRATION_INCOMPLETE'].sort());
  });
});

describe('a pending legal review blocks enablement whatever else is true', () => {
  it('a COMPLETE profile with a pending review is refused', () => {
    const p = approvedProfile({ legalReviewStatus: 'pending' });
    expect(completenessIssues(p)).toEqual([]);
    expect(enableCodes(p)).toEqual(['LEGAL_REVIEW_PENDING']);
  });
  it('an approval must name who and when', () => {
    expect(enableCodes(approvedProfile({ legalReviewedBy: undefined }))).toContain('REVIEWER_MISSING');
    expect(enableCodes(approvedProfile({ legalReviewedAt: '  ' }))).toContain('REVIEWER_MISSING');
  });
  it.each(['draft', 'in-review', 'disabled'] as const)('status "%s" is not approved', (status) => {
    expect(enableCodes(approvedProfile({ status }))).toEqual(['NOT_APPROVED']);
  });
  it('every checklist item must be done, and the message says which are not', () => {
    const checklist = { ...approvedProfile().checklist, safetyCopyNativeReviewed: false, rtlVerified: false };
    const issue = enablementIssues(approvedProfile({ checklist })).find((i) => i.code === 'CHECKLIST_INCOMPLETE')!;
    expect(issue.message).toContain('safetyCopyNativeReviewed');
    expect(issue.message).toContain('rtlVerified');
  });
});

describe('completeness', () => {
  const base = approvedProfile();
  const with_ = <K extends keyof RegionProfile>(k: K, v: Partial<RegionProfile[K]>) =>
    approvedProfile({ [k]: { ...(base[k] as object), ...(v as object) } } as Partial<RegionProfile>);

  it('identity', () => {
    has(approvedProfile({ id: 'pk' }), 'ID_INVALID');
    has(approvedProfile({ id: 'PAK' }), 'ID_INVALID');
    has(approvedProfile({ displayName: ' ' }), 'NAME_MISSING');
  });

  describe('emergency', () => {
    it('needs at least one number', () => has(with_('emergency', { numbers: [] }), 'NO_EMERGENCY_NUMBERS'));
    it('numbers must be dialable', () => {
      for (const number of ['', 'abc', '1', '1234567', '+911', '9 11']) {
        has(with_('emergency', { numbers: [{ number, label: 'X', scope: 'national' }] }), 'EMERGENCY_NUMBER_INVALID');
      }
    });
    it('a number needs a label — the user must know who they are calling', () => {
      has(with_('emergency', { numbers: [{ number: '100', label: ' ', scope: 'national' }] }), 'EMERGENCY_LABEL_MISSING');
    });
    it('a regional number must say where it works; a national one must not be restricted', () => {
      has(with_('emergency', { numbers: [{ number: '100', label: 'X', scope: 'subnational' }] }), 'SUBNATIONAL_NO_REGIONS');
      has(with_('emergency', { numbers: [{ number: '100', label: 'X', scope: 'subnational', regions: [] }] }), 'SUBNATIONAL_NO_REGIONS');
      has(with_('emergency', { numbers: [{ number: '100', label: 'X', scope: 'national', regions: ['AA'] }] }), 'NATIONAL_HAS_REGIONS');
    });
    it('automatic dialling is refused outright, in every market (RES-9)', () => {
      has(with_('emergency', { dialPolicy: 'auto-dial-permitted' }), 'AUTO_DIAL_FORBIDDEN');
    });
    it('claiming dispatch needs a signed agreement on record', () => {
      has(with_('emergency', { canClaimDispatch: true }), 'DISPATCH_CLAIM_NO_AGREEMENT');
      has(with_('emergency', { canClaimDispatch: true, dispatchPartner: { id: 'p', agreementRef: ' ' } }), 'DISPATCH_CLAIM_NO_AGREEMENT');
      expect(codes(with_('emergency', { canClaimDispatch: true, dispatchPartner: { id: 'p', agreementRef: 'AGR-1' } }))).not.toContain('DISPATCH_CLAIM_NO_AGREEMENT');
    });
  });

  describe('messaging', () => {
    it('needs a channel, only known channels, and an emergency-grade one', () => {
      has(with_('messaging', { channels: [] }), 'NO_CHANNELS');
      has(with_('messaging', { channels: ['carrier-pigeon' as never, 'push'] }), 'UNKNOWN_CHANNEL');
      has(with_('messaging', { channels: ['email'] }), 'NO_EMERGENCY_CHANNEL');
    });
    it('a listed sms or voice channel needs a contracted provider', () => {
      has(with_('messaging', { smsProvider: null }), 'SMS_PROVIDER_MISSING');
      has(with_('messaging', { voiceProvider: null }), 'VOICE_PROVIDER_MISSING');
      has(with_('messaging', { smsProvider: { id: 'p', contracted: false } }), 'PROVIDER_NOT_CONTRACTED');
      has(with_('messaging', { voiceProvider: { id: 'p', contracted: false } }), 'PROVIDER_NOT_CONTRACTED');
    });
    it('a channel that is not listed needs no provider', () => {
      expect(codes(with_('messaging', { channels: ['push', 'web'], smsProvider: null, voiceProvider: null }))).toEqual([]);
    });
    it('device-direct SMS cannot be listed and disallowed', () => {
      has(with_('messaging', { deviceDirectSmsAllowed: false }), 'DEVICE_SMS_NOT_ALLOWED');
    });
    it('a required registration (US A2P 10DLC) must be complete before anything sends', () => {
      has(with_('messaging', { registrationRequired: 'A2P-10DLC' }), 'REGISTRATION_INCOMPLETE');
      has(with_('messaging', { registrationRequired: 'A2P-10DLC', registrationComplete: false }), 'REGISTRATION_INCOMPLETE');
      expect(codes(with_('messaging', { registrationRequired: 'A2P-10DLC', registrationComplete: true }))).not.toContain('REGISTRATION_INCOMPLETE');
    });
  });

  describe('recording', () => {
    it('a subdivision-dependent rule must list its subdivisions', () => {
      has(with_('recording', { subnationalOverrides: undefined }), 'OVERRIDES_MISSING');
      has(with_('recording', { subnationalOverrides: {} }), 'OVERRIDES_MISSING');
    });
    it('a uniform rule needs no overrides', () => {
      expect(codes(with_('recording', { audioConsent: 'all-party', subnationalOverrides: undefined }))).toEqual([]);
    });
  });

  describe('privacy', () => {
    it('regimes, retention, erasure SLA and minor age must all be set', () => {
      has(with_('privacy', { regimes: [] }), 'PRIVACY_REGIMES_MISSING');
      has(with_('privacy', { retention: { ...base.privacy.retention, audioDays: 0 } }), 'RETENTION_INVALID');
      has(with_('privacy', { erasureSlaDays: 0 }), 'ERASURE_SLA_INVALID');
      has(with_('privacy', { minorConsentAge: undefined }), 'MINOR_AGE_MISSING');
      has(with_('privacy', { minorConsentAge: 13.5 }), 'MINOR_AGE_MISSING');
      has(with_('privacy', { minorConsentAge: 0 }), 'MINOR_AGE_MISSING');
    });
  });

  describe('locale and commerce', () => {
    it('needs a language, and the default must be one of them', () => {
      has(with_('locale', { languages: [] }), 'LANGUAGES_MISSING');
      has(with_('locale', { default: 'fr' }), 'DEFAULT_LANGUAGE_NOT_LISTED');
    });
    it('needs an ISO 4217 currency and a positive price for every tier', () => {
      has(with_('commerce', { currency: 'pkr' }), 'CURRENCY_INVALID');
      has(with_('commerce', { pricePoints: { plus: 0, family: 2, business: 3 } }), 'PRICE_INVALID');
      has(with_('commerce', { pricePoints: { plus: 1, family: -2, business: 3 } }), 'PRICE_INVALID');
    });
  });

  describe('checklist shape', () => {
    it("'not-applicable' is allowed only for rtlVerified, and only where the market is left-to-right", () => {
      const na = { ...base.checklist, rtlVerified: 'not-applicable' as const };
      expect(codes(approvedProfile({ checklist: na }))).toEqual([]);
      has(approvedProfile({ checklist: na, locale: { ...base.locale, rtl: true } }), 'CHECKLIST_MALFORMED');
      has(approvedProfile({ checklist: { ...base.checklist, numbersVerified: 'not-applicable' } }), 'CHECKLIST_MALFORMED');
    });
    it('every item must be present', () => {
      const partial = { ...base.checklist } as Record<string, unknown>;
      delete partial[CHECKLIST_ITEMS[0]];
      has(approvedProfile({ checklist: partial as RegionProfile['checklist'] }), 'CHECKLIST_MALFORMED');
    });
  });

  it('reports every problem with where it is, not just the first', () => {
    const issues = completenessIssues(approvedProfile({ id: 'x', displayName: '' }));
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(['id', 'displayName']));
  });
});
