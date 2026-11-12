import type { RegionProfile } from '../types';

/**
 * United States — docs/specs/REGION_PROFILES.md §3. DRAFT: legal review pending,
 * which blocks enablement.
 */
export const US: RegionProfile = {
  id: 'US',
  displayName: 'United States',
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
    rtlVerified: 'not-applicable', // a left-to-right market: a fact, not a review claim
    pricingValidatedLocally: false,
    alertFeedsConfirmed: false,
    legalReviewApproved: false,
    storeDisclosuresUpdated: false,
    failureTestsRerun: false,
  },

  emergency: {
    numbers: [{ number: '911', label: 'Emergency', scope: 'national' }],
    dialPolicy: 'user-initiated-only',
    // No unilateral 911 integration exists: PSAPs do not generally accept automated
    // third-party alerts. A dispatch partner would sit behind `dispatchPartner`,
    // under contract. Until then nothing may imply otherwise.
    canClaimDispatch: false,
  },

  messaging: {
    smsProvider: { id: 'twilio', contracted: false },
    voiceProvider: { id: 'twilio', contracted: false },
    deviceDirectSmsAllowed: true,
    recipientConsentRequired: true, // consent regime for A2P messaging — counsel to confirm scope
    registrationRequired: 'A2P-10DLC', // brand + campaign registration before any send
    registrationComplete: false,
    channels: ['push', 'sms', 'voice', 'device_direct_sms', 'web'],
  },

  recording: {
    audioConsent: 'varies-subnational', // roughly a dozen states require all-party consent
    // The spec's list. It names nine states while its own text says "roughly a
    // dozen", so it is KNOWN to be incomplete: a state missing from it resolves to
    // all-party, never to one-party.
    subnationalOverrides: {
      CA: 'all-party',
      FL: 'all-party',
      IL: 'all-party',
      MD: 'all-party',
      MA: 'all-party',
      MT: 'all-party',
      NH: 'all-party',
      PA: 'all-party',
      WA: 'all-party',
    },
    requiresOnScreenNotice: true,
    requiresAudibleNotice: false, // CONFIRM per state
  },

  privacy: {
    regimes: ['CCPA-CPRA', 'state-comprehensive-laws', 'COPPA'],
    locationIsSensitiveCategory: true, // precise geolocation treated as sensitive
    minorConsentAge: 13,
    retention: { locationDays: 30, audioDays: 30, videoDays: 90, incidentYears: 7 },
    erasureSlaDays: 45,
  },

  locale: { languages: ['en', 'es'], default: 'en', rtl: false },

  commerce: {
    currency: 'USD',
    pricePoints: { plus: 4.99, family: 9.99, business: 5.0 },
    taxHandling: 'exclusive',
  },

  publicAlertFeeds: ['NWS', 'IPAWS-public'],
  knownCompetitors: ['Google Personal Safety', 'Apple safety features', 'Life360', 'Noonlight', 'Citizen'],
};
