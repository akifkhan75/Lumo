import type { Channel } from '@lumo/safety-domain';
import type { RegionProfile } from './types';

/**
 * May this channel be used in this market? (docs/specs/NOTIFICATIONS.md)
 *
 * Pure data lookup against the profile. The caller passes the profile of the INCIDENT's
 * region, which is where the device is, not where the account was opened.
 *
 * - A channel the profile does not list is off there.
 * - SMS and voice are blocked until the market's registration is complete (US A2P 10DLC:
 *   unregistered traffic is filtered by carriers, so "sending" it would be a lie).
 *
 * No profile at all means no restrictions CAN be applied. That is the caller's decision to
 * make and to say; this function does not invent one.
 */
export type ChannelGate =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'CHANNEL_DISABLED_FOR_REGION' | 'REGISTRATION_INCOMPLETE' };

export function channelGate(profile: RegionProfile, channel: Channel): ChannelGate {
  if (!profile.messaging.channels.includes(channel)) return { allowed: false, reason: 'CHANNEL_DISABLED_FOR_REGION' };
  const registered = profile.messaging.registrationRequired === undefined || profile.messaging.registrationComplete === true;
  if ((channel === 'sms' || channel === 'voice') && !registered) return { allowed: false, reason: 'REGISTRATION_INCOMPLETE' };
  return { allowed: true };
}

/** The cap for a channel, or null when it is uncapped (device-direct SMS) or unknown. */
export function dailyCapFor(profile: RegionProfile, channel: Channel): number | null {
  return profile.messaging.dailyCaps[channel] ?? null;
}
