import type { Channel } from '@lumo/safety-domain';

/**
 * The shape of a market (docs/specs/REGION_PROFILES.md §1).
 *
 * SUBDIVISION CODES. The spec mixes names ("Punjab") and US postal codes ("CA"). A
 * subdivision is identified here by the part of its ISO 3166-2 code after the
 * country: Punjab is "PB" (PK-PB), California is "CA" (US-CA). Codes, not names,
 * because names have spellings; and unique only within a country, which is why a
 * subdivision is always read together with its country.
 */
export type SubdivisionCode = string;

export interface EmergencyNumber {
  readonly number: string;
  readonly label: string;
  /** `subnational` numbers work only in the listed `regions`. */
  readonly scope: 'national' | 'subnational';
  readonly regions?: readonly SubdivisionCode[];
}

export interface ProviderRef {
  readonly id: string;
  /** A signed agreement exists. A provider that is only named is not a provider. */
  readonly contracted: boolean;
}

export interface DispatchPartner {
  readonly id: string;
  /** Reference to the signed agreement. Without one, nothing may imply dispatch. */
  readonly agreementRef: string;
}

export type Tier = 'plus' | 'family' | 'business';
export const TIERS: readonly Tier[] = ['plus', 'family', 'business'];

export type AudioConsent = 'one-party' | 'all-party' | 'varies-subnational' | 'prohibited';
export type ProfileStatus = 'draft' | 'in-review' | 'approved' | 'disabled';

/**
 * The spec's §6 enablement checklist, recorded as data. The spec lists these as a
 * document to tick; here they are fields, so "approved" cannot be claimed with an
 * item undone. ADDED by the implementation — the §1 contract does not include it.
 */
export const CHECKLIST_ITEMS = [
  'numbersVerified',
  'dispatchClaimSet',
  'providerContractedAndRegistered',
  'channelMatrixPopulated',
  'recordingConsentConfirmed',
  'privacyMapped',
  'minorConsentDefined',
  'safetyCopyNativeReviewed',
  'rtlVerified',
  'pricingValidatedLocally',
  'alertFeedsConfirmed',
  'legalReviewApproved',
  'storeDisclosuresUpdated',
  'failureTestsRerun',
] as const;
export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];
/** `not-applicable` is allowed only for rtlVerified, and only in a left-to-right market. */
export type ChecklistValue = boolean | 'not-applicable';

export interface RegionProfile {
  /** ISO 3166-1 alpha-2 country code. */
  readonly id: string;
  readonly displayName: string;
  readonly status: ProfileStatus;
  readonly legalReviewStatus: 'pending' | 'approved';
  readonly legalReviewedAt?: string;
  readonly legalReviewedBy?: string;
  readonly checklist: Readonly<Record<ChecklistItem, ChecklistValue>>;

  readonly emergency: {
    /** Ordered by relevance. */
    readonly numbers: readonly EmergencyNumber[];
    readonly dialPolicy: 'user-initiated-only' | 'auto-dial-permitted';
    readonly dispatchPartner?: DispatchPartner;
    /** False unless a signed agreement exists. Gates all copy implying official dispatch. */
    readonly canClaimDispatch: boolean;
  };

  readonly messaging: {
    readonly smsProvider: ProviderRef | null;
    readonly voiceProvider: ProviderRef | null;
    readonly deviceDirectSmsAllowed: boolean;
    /** Consent from the CONTACT, not the user. */
    readonly recipientConsentRequired: boolean;
    /** e.g. US A2P 10DLC: brand and campaign registration before any send. */
    readonly registrationRequired?: string;
    readonly registrationComplete?: boolean;
    readonly channels: readonly Channel[];
  };

  readonly recording: {
    readonly audioConsent: AudioConsent;
    /** Required, and non-empty, when audioConsent is `varies-subnational`. */
    readonly subnationalOverrides?: Readonly<Record<SubdivisionCode, 'one-party' | 'all-party'>>;
    readonly requiresOnScreenNotice: boolean;
    readonly requiresAudibleNotice: boolean;
  };

  readonly privacy: {
    readonly regimes: readonly string[];
    readonly locationIsSensitiveCategory: boolean;
    readonly minorConsentAge?: number;
    readonly dataResidency?: string;
    readonly retention: {
      readonly locationDays: number;
      readonly audioDays: number;
      readonly videoDays: number;
      readonly incidentYears: number;
    };
    readonly erasureSlaDays: number;
  };

  readonly locale: { readonly languages: readonly string[]; readonly default: string; readonly rtl: boolean };

  readonly commerce: {
    /** ISO 4217. */
    readonly currency: string;
    /** Hypotheses until validated locally. NEVER converted between markets. */
    readonly pricePoints: Readonly<Record<Tier, number>>;
    readonly taxHandling: 'inclusive' | 'exclusive';
  };

  readonly publicAlertFeeds: readonly string[];
  readonly knownCompetitors: readonly string[];
}
