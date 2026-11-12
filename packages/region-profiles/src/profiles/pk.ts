import type { RegionProfile } from '../types';

/**
 * Pakistan — docs/specs/REGION_PROFILES.md §2. DRAFT: legal review pending, which
 * blocks enablement. Every value below is a hypothesis until counsel and operations
 * have confirmed it; the questions are in §8 of the spec.
 */
export const PK: RegionProfile = {
  id: 'PK',
  displayName: 'Pakistan',
  status: 'draft',
  legalReviewStatus: 'pending',
  checklist: {
    numbersVerified: false,
    dispatchClaimSet: false,
    providerContractedAndRegistered: false,
    channelMatrixPopulated: false,
    recordingConsentConfirmed: false,
    privacyMapped: false,
    minorConsentDefined: false,
    safetyCopyNativeReviewed: false,
    rtlVerified: false,
    pricingValidatedLocally: false,
    alertFeedsConfirmed: false,
    legalReviewApproved: false,
    storeDisclosuresUpdated: false,
    failureTestsRerun: false,
  },

  emergency: {
    numbers: [
      { number: '15', label: 'Police', scope: 'national' },
      // Punjab only. The number an emergency resolves to is a function of where the
      // device is, not of the account's country.
      { number: '1122', label: 'Rescue / Emergency Service', scope: 'subnational', regions: ['PB'] },
      { number: '115', label: 'Ambulance (Edhi)', scope: 'national' },
      { number: '130', label: 'Motorway Police', scope: 'national' },
    ],
    dialPolicy: 'user-initiated-only',
    canClaimDispatch: false,
  },

  messaging: {
    smsProvider: { id: 'local-aggregator', contracted: false }, // TBD — see the spec's open questions
    voiceProvider: null,
    deviceDirectSmsAllowed: true,
    recipientConsentRequired: true, // product policy, stricter than local law
    channels: ['push', 'sms', 'device_direct_sms', 'web'],
  },

  recording: {
    audioConsent: 'varies-subnational', // CONFIRM WITH COUNSEL
    // No subnational overrides are known, so every subdivision resolves to the most
    // restrictive rule (all-party) until counsel answers. This is also why the
    // profile cannot be enabled as it stands.
    requiresOnScreenNotice: true,
    requiresAudibleNotice: false,
  },

  privacy: {
    regimes: ['PECA-2016', 'PDP-draft'], // the data-protection statute is still evolving — confirm
    locationIsSensitiveCategory: true, // product policy regardless of statute
    minorConsentAge: 18, // conservative default pending review
    retention: { locationDays: 30, audioDays: 30, videoDays: 90, incidentYears: 2 },
    erasureSlaDays: 30,
  },

  locale: { languages: ['ur', 'en'], default: 'ur', rtl: true },

  commerce: {
    currency: 'PKR',
    pricePoints: { plus: 299, family: 599, business: 399 }, // per month, hypotheses only
    taxHandling: 'inclusive',
  },

  publicAlertFeeds: ['NDMA', 'PDMA-Punjab'], // verify programmatic availability
  knownCompetitors: ['PSCA Public Safety App', 'PSCA NextGen Safety App'],
};
