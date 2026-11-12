export enum ModalType {
  FakeCall = 'FAKE_CALL',
  Settings = 'SETTINGS',
  FollowMe = 'FOLLOW_ME',
  CheckIn = 'CHECK_IN',
  CommunitySafety = 'COMMUNITY_SAFETY',
  ReportHazard = 'REPORT_HAZARD',
  SafetyAssistant = 'SAFETY_ASSISTANT',
}

export type ChatRole = 'user' | 'model';

export interface ChatMessage {
  role: ChatRole;
  text: string;
}

export interface TrustedContact {
  id: string;
  name: string;
  phone: string;
}

export interface PersonalInfo {
  fullName: string;
  bloodType: string;
  allergies: string;
}

export interface SecuritySettings {
  locationSharingEnabled: boolean;
  shareLocationOnSos: boolean;
  sendSmsOnSos: boolean;
  shakeToSosEnabled: boolean;
  voiceActivationEnabled: boolean;
  accidentDetectionEnabled: boolean;
}

export interface UserSettings {
  personalInfo: PersonalInfo;
  trustedContacts: TrustedContact[];
  security: SecuritySettings;
}

export interface FakeCallScript {
  callerName: string;
  script: string[];
}

/**
 * A hazard report is an observation about a CONDITION, not a verdict about a
 * place. It carries a type, a source, an age and a confirmation count — never
 * a severity. See docs/adr/0010-hazard-reports-replace-danger-zones.md for why
 * a severity attached to an area is the primitive this product must not have.
 */
export type HazardType =
  | 'POOR_LIGHTING'
  | 'OBSTRUCTED_PATH'
  | 'BROKEN_INFRASTRUCTURE'
  | 'UNSAFE_CROSSING'
  | 'THEFT_REPORTED'
  | 'HARASSMENT_REPORTED'
  | 'AGGRESSION_REPORTED'
  | 'OTHER';

export type HazardReportSource = 'COMMUNITY' | 'VERIFIED_PARTNER' | 'OFFICIAL_FEED';

/**
 * The wire format is the machine value and the label lives here, so the
 * predecessor's bug cannot recur: DangerZoneType was hand-mapped between a
 * Prisma member, a @map'd database string and a space-separated client string
 * in three places, and a new member had to be added to all three or it
 * silently fell through to a default.
 */
export const HAZARD_TYPE_LABELS: Record<HazardType, string> = {
  POOR_LIGHTING: 'Lighting out',
  OBSTRUCTED_PATH: 'Path blocked',
  BROKEN_INFRASTRUCTURE: 'Broken pavement or steps',
  UNSAFE_CROSSING: 'Unsafe crossing',
  THEFT_REPORTED: 'Theft reported',
  HARASSMENT_REPORTED: 'Harassment reported',
  AGGRESSION_REPORTED: 'Aggressive behaviour reported',
  OTHER: 'Other condition',
};

export const HAZARD_SOURCE_LABELS: Record<HazardReportSource, string> = {
  COMMUNITY: 'Community report',
  VERIFIED_PARTNER: 'Verified partner',
  OFFICIAL_FEED: 'Official feed',
};

/**
 * A community report below this many confirmations is shown, but must not
 * influence routing or any automated decision. One person's observation is
 * not a fact about a street.
 */
export const HAZARD_CONFIRMATION_FLOOR = 3;

export interface HazardCoordinates {
  latitude: number;
  longitude: number;
  /** Metres. `null` means unknown — render it as unknown, never as a precise point. */
  accuracyMetres: number | null;
}

export interface HazardReport {
  id: string;
  type: HazardType;
  source: HazardReportSource;
  description: string;
  coordinates: HazardCoordinates;
  reportedAt: string;
  expiresAt: string;
  confirmationCount: number;
  /**
   * Server-derived: the report has met HAZARD_CONFIRMATION_FLOOR, or comes
   * from a verified source. Clients must not recompute this — the floor is
   * policy and lives in one place.
   */
  influencesRouting: boolean;
}

export interface CreateHazardReportInput {
  type: HazardType;
  description: string;
  latitude: number;
  longitude: number;
  accuracyMetres?: number;
}
