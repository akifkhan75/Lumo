import { CHECKLIST_ITEMS, type RegionProfile } from '../types';

/**
 * A FICTIONAL, fully approved profile for tests. Not a market: its country code is
 * ZZ, which is user-assigned in ISO 3166 and never a real country. Real markets are
 * drafts, so something has to stand in for "a profile that passes the gate".
 */
export const approvedProfile = (overrides: Partial<RegionProfile> = {}): RegionProfile => ({
  id: 'ZZ',
  displayName: 'Testland',
  status: 'approved',
  legalReviewStatus: 'approved',
  legalReviewedAt: '2026-01-01',
  legalReviewedBy: 'A. Counsel',
  checklist: Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i, true])) as RegionProfile['checklist'],
  emergency: {
    numbers: [
      { number: '100', label: 'Police', scope: 'national' },
      { number: '2000', label: 'Regional rescue', scope: 'subnational', regions: ['AA'] },
    ],
    dialPolicy: 'user-initiated-only',
    canClaimDispatch: false,
  },
  messaging: {
    smsProvider: { id: 'p', contracted: true },
    voiceProvider: { id: 'p', contracted: true },
    deviceDirectSmsAllowed: true,
    recipientConsentRequired: true,
    channels: ['push', 'sms', 'voice', 'device_direct_sms', 'web'],
  },
  recording: {
    audioConsent: 'varies-subnational',
    subnationalOverrides: { AA: 'all-party', BB: 'one-party' },
    requiresOnScreenNotice: true,
    requiresAudibleNotice: false,
  },
  privacy: {
    regimes: ['TEST-ACT'],
    locationIsSensitiveCategory: true,
    minorConsentAge: 16,
    retention: { locationDays: 30, audioDays: 30, videoDays: 90, incidentYears: 5 },
    erasureSlaDays: 30,
  },
  locale: { languages: ['en'], default: 'en', rtl: false },
  commerce: { currency: 'ZZZ', pricePoints: { plus: 1, family: 2, business: 3 }, taxHandling: 'inclusive' },
  publicAlertFeeds: [],
  knownCompetitors: [],
  ...overrides,
});
