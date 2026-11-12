/**
 * Vocabulary shared by the three machines, the escalation evaluator and the
 * ledger. Declared as `as const` lists so the type and the runtime list cannot
 * drift apart — the exhaustive tests iterate these lists.
 */

/** Who may cause a transition. */
export const ACTORS = ['user', 'system', 'policy', 'contact'] as const;
export type Actor = (typeof ACTORS)[number];

/**
 * Delivery channels. Mirrors the Prisma `Channel` enum in
 * docs/specs/DATA_MODEL.md; a channel is only usable once it has an entry in
 * CHANNEL_CAPABILITIES.
 */
export const CHANNELS = ['push', 'sms', 'voice', 'device_direct_sms', 'email', 'web'] as const;
export type Channel = (typeof CHANNELS)[number];

export const TRIGGER_TYPES = [
  'manual',
  'shake',
  'voice',
  'safeword',
  'crash',
  'fall',
  'missed_check_in',
  'duress',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const SESSION_KINDS = ['walk_home', 'date', 'ride', 'travel', 'outdoor', 'custom'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

/**
 * `practice` rehearses the whole pipeline and notifies nobody. It is enforced at
 * the notification boundary, not at the call site (docs/specs/PRACTICE_MODE.md).
 */
export const INCIDENT_MODES = ['real', 'practice'] as const;
export type IncidentMode = (typeof INCIDENT_MODES)[number];

/**
 * Consent is a record, not a flag, and it comes in kinds
 * (docs/engineering/PRIVACY_AND_CONSENT.md): the contact agreeing to the role,
 * the person being shared agreeing to the sharing, recording consent, and
 * consent to process data.
 */
export const CONSENT_KINDS = ['contact_role', 'location_sharing', 'recording', 'data_processing'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];
