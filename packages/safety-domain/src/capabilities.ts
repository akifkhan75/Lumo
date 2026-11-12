import type { Channel } from './types';

/**
 * What each channel can truthfully tell us — as DATA, not comments
 * (docs/specs/DELIVERY_LEDGER.md §2, ADR-0012).
 *
 * The attempt machine's guards read this table, so a channel that cannot report
 * delivery can never be recorded as delivered. The UI cannot lie because the
 * data has no way to hold the lie.
 */

export const ATTEMPT_STATES = [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'ACKNOWLEDGED',
  'FAILED',
  'EXPIRED',
  'UNKNOWN',
] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

/**
 * Who is able to vouch that a message reached the handset.
 *
 * - `provider` — the carrier/provider reports it (SMS delivery receipts, where
 *   the destination network supports them).
 * - `device`   — the receiving device itself reports back (the app, or a
 *   browser opening the journey page).
 * - `none`     — nobody can; the channel stops at SENT.
 *
 * Push is `device`, not `provider`. A push receipt from Expo, FCM or APNs only
 * means the push service ACCEPTED the message — Expo's own documentation says it
 * "doesn't guarantee that the device has received the message", and APNs has no
 * per-message device receipt at all. Treating that as DELIVERED is the exact lie
 * ADR-0012 exists to prevent.
 */
export type DeliveredEvidence = 'provider' | 'device' | 'none';

export type ReceiptSupport = 'always' | 'provider-dependent' | 'device-side' | 'never';

export interface ChannelCapability {
  readonly channel: Channel;
  /**
   * The furthest the ledger can go with NO human action — what the incident
   * rollup treats as "settled at its maximum".
   */
  readonly automaticCeiling: 'SENT' | 'DELIVERED';
  readonly deliveredEvidence: DeliveredEvidence;
  /** Whether a person can acknowledge through this channel ("I'm responding"). */
  readonly humanAck: boolean;
  readonly receipts: ReceiptSupport;
  /** Email is supplementary and never a primary emergency channel. */
  readonly isEmergencyGrade: boolean;
  /** A non-consented contact is never alerted, on any channel (RES-7). */
  readonly requiresConsent: boolean;
}

export const CHANNEL_CAPABILITIES: Readonly<Record<Channel, ChannelCapability>> = {
  push: {
    channel: 'push',
    automaticCeiling: 'DELIVERED',
    deliveredEvidence: 'device',
    humanAck: true, // in-app, or the notification's "I'm responding" action
    receipts: 'device-side',
    isEmergencyGrade: true,
    requiresConsent: true,
  },
  sms: {
    channel: 'sms',
    automaticCeiling: 'DELIVERED',
    deliveredEvidence: 'provider',
    humanAck: false,
    receipts: 'provider-dependent', // varies by provider and destination network
    isEmergencyGrade: true,
    requiresConsent: true,
  },
  voice: {
    channel: 'voice',
    automaticCeiling: 'SENT', // answered is not understood, and is never an ack
    deliveredEvidence: 'none',
    humanAck: false,
    receipts: 'never',
    isEmergencyGrade: true,
    requiresConsent: true,
  },
  device_direct_sms: {
    channel: 'device_direct_sms',
    automaticCeiling: 'SENT', // the user's own SIM: no receipt path at all
    deliveredEvidence: 'none',
    humanAck: false,
    receipts: 'never',
    isEmergencyGrade: true,
    requiresConsent: true,
  },
  email: {
    channel: 'email',
    automaticCeiling: 'SENT',
    deliveredEvidence: 'none',
    humanAck: false,
    receipts: 'never',
    isEmergencyGrade: false,
    requiresConsent: true,
  },
  web: {
    channel: 'web',
    automaticCeiling: 'DELIVERED', // the contact opened the journey page
    deliveredEvidence: 'device',
    humanAck: true, // the contact acknowledges in the browser
    receipts: 'device-side',
    isEmergencyGrade: true,
    requiresConsent: true,
  },
};

/** The furthest state the ledger may ever record for this channel. */
export function maxState(capability: ChannelCapability): 'SENT' | 'DELIVERED' | 'ACKNOWLEDGED' {
  return capability.humanAck ? 'ACKNOWLEDGED' : capability.automaticCeiling;
}

/**
 * A capability that contradicts itself would make the guards unsound. Used by
 * tests over the table, and by whatever loads a region-profile override.
 */
export function capabilityIssues(capability: ChannelCapability): string[] {
  const issues: string[] = [];
  if (capability.automaticCeiling === 'DELIVERED' && capability.deliveredEvidence === 'none') {
    issues.push('A channel that reaches DELIVERED must say who can vouch for it');
  }
  if (capability.automaticCeiling === 'SENT' && capability.deliveredEvidence !== 'none') {
    issues.push('A channel that stops at SENT cannot have a source of delivery evidence');
  }
  return issues;
}
