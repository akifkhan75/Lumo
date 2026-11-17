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

/**
 * Where a contact stands on agreeing to the role (RES-7). Only the CONTACT changes it.
 * "agreed" records willingness; it does NOT mean an alert path exists yet.
 */
export type ConsentStatus = 'not_invited' | 'waiting' | 'agreed' | 'withdrawn' | 'expired' | 'details_changed';

export interface TrustedContact {
  id: string;
  name: string;
  phone: string;
  /** Read-only, set by the server. Absent on a contact not yet saved. */
  consentStatus?: ConsentStatus;
}

/** A link for a contact to open. Lumo sends nothing: the user passes it on. */
export interface ContactInvite {
  /** Path on the API host; the client adds its own base URL. */
  path: string;
  expiresAt: string;
  sentByLumo: false;
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


/** What the server says about an incident (docs/specs/INCIDENTS.md). Dates arrive as ISO strings. */
export type IncidentState =
  | 'CREATED' | 'LOCATING' | 'DISPATCHING' | 'NOTIFYING' | 'PARTIALLY_NOTIFIED' | 'NOTIFIED'
  | 'ALL_CHANNELS_FAILED' | 'ACKNOWLEDGED' | 'RESOLVING' | 'CLOSED' | 'CANCELLED';

export type AttemptStateName = 'QUEUED' | 'SENT' | 'DELIVERED' | 'ACKNOWLEDGED' | 'FAILED' | 'EXPIRED' | 'UNKNOWN';

export interface IncidentAttempt {
  id: string;
  recipientId: string;
  /** Present for a login, absent for an emergency token. */
  recipientName?: string;
  channel: 'push' | 'sms' | 'voice' | 'device_direct_sms' | 'email' | 'web';
  purpose: 'ALERT' | 'RESOLVED';
  state: AttemptStateName;
  reason: string | null;
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
  failedAt: string | null;
  /** True for every row of a practice run: nothing was sent. Absent or false for a real one. */
  simulated?: boolean;
}

export interface Incident {
  id: string;
  state: IncidentState;
  /** `practice`: a rehearsal. Nothing was sent. Absent means real (an older server). */
  mode?: 'real' | 'practice';
  triggerType: string;
  countdownEndsAt: string | null;
  /** Seconds between when the alert should have gone and when Lumo got it. 0 or absent for an ordinary SOS. */
  lateBySeconds?: number;
  locationAvailable: boolean;
  outcome: string;
  /** The escalation ladder: the step in flight, of how many, and when it gives way to the next. */
  escalation?: { phase: string; stepOrder: number | null; steps: number; nextStepAt: number | null } | null;
  reached: string[];
  acknowledged: string[];
  failed: string[];
  pending: string[];
  /** Contacts the daily limit stopped. The person must be told. */
  capped: string[];
  attempts: IncidentAttempt[];
}

/** One row of the person's incident history (docs/specs/INCIDENT_HISTORY.md). Counts, no names: who is in the timeline, behind a tap. */
export interface IncidentSummary {
  id: string;
  mode: 'real' | 'practice';
  state: string;
  outcome: string;
  triggerType: string;
  triggeredAt: string;
  createdAt: string;
  lateBySeconds: number;
  locationAvailable: boolean;
  contactsTried: number;
  contactsReached: number;
  contactsFailed: number;
  resolvedAt: string | null;
  closedAt: string | null;
}
export interface IncidentHistoryPage { incidents: IncidentSummary[]; nextCursor: string | null }

/** One thing that happened, in order. Never a coordinate or a phone number. */
export interface TimelineEntry {
  at: string;
  kind: 'incident' | 'attempt';
  event: string;
  from: string | null;
  to: string;
  actor: string | null;
  reason: string | null;
  recipient: string | null;
  channel: string | null;
  purpose: string | null;
  /** True for every entry of a practice run. */
  simulated: boolean;
}
export interface IncidentTimeline { incident: IncidentSummary; entries: TimelineEntry[] }

export interface RaiseSosInput {
  triggerType: 'manual' | 'shake' | 'voice' | 'safeword' | 'crash' | 'fall';
  triggeredAt: string;
  countdownSeconds?: number;
  /** How long ago the press was, measured on this device (the server works out the time from its own clock). */
  elapsedSeconds?: number;
  /** A rehearsal: the whole path, and nobody is contacted. */
  mode?: 'real' | 'practice';
  location?: { latitude: number; longitude: number; accuracyM: number | null; capturedAt: number };
  place?: { country: string; subdivision?: string | null };
}

export interface EmergencyToken {
  id: string;
  token: string;
  expiresAt: string;
}

export type SessionKindName = 'walk_home' | 'date' | 'ride' | 'travel' | 'outdoor' | 'custom';
export type SessionStateName =
  | 'CREATED' | 'ACTIVE' | 'CHECK_IN_DUE' | 'GRACE' | 'ESCALATING' | 'ALERTED' | 'ARRIVED' | 'CLOSED' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';

/** A journey as the server describes it (docs/specs/JOURNEYS.md). Dates arrive as ISO strings. */
export interface Journey {
  id: string;
  kind: SessionKindName;
  state: SessionStateName;
  expectedArrivalAt: string | null;
  checkInDueAt: string | null;
  destination: { latitude: number; longitude: number; label: string | null } | null;
  shareLocation: boolean;
  /** What happens if the check-in is missed: the grace, and who would be tried, in order. */
  plan: { graceSeconds: number; contacts: string[] };
  /** The person is being asked "are you OK?" right now. */
  needsAnswer: boolean;
  incidentId: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface CreateJourneyInput {
  kind: SessionKindName;
  expectedArrivalAt: string;
  destination?: { latitude: number; longitude: number; label?: string | null };
  shareLocation?: boolean;
}

/** A link someone can follow a journey by, as the OWNER sees it. Never carries the token: that is shown once, at creation. */
export interface JourneyLinkInfo {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  hasPin: boolean;
  viewCount: number;
  lastViewedAt: string | null;
  /** Not revoked and not expired: someone holding it can see the journey right now. */
  live: boolean;
}

export interface CreateJourneyLinkInput { expiresInMinutes?: number; pin?: string }

/** `path` is `/j/<token>` and is returned ONCE. Lumo sends it to nobody (`sentByLumo` is always false): the person passes it on. */
export interface CreatedJourneyLink { id: string; path: string; expiresAt: string; hasPin: boolean; sentByLumo: false }

export interface JourneyFix { latitude: number; longitude: number; accuracyM: number; capturedAt: number; batteryPct?: number | null; source: string }

