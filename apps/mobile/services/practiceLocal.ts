import { rollupIncident, simulatePractice, type Channel, type PracticeRecipient } from '@lumo/safety-domain';
import type { ConsentStatus, Incident, IncidentAttempt, UserSettings } from '@lumo/types';

/**
 * Practice with no server (docs/specs/PRACTICE_MODE.md: "Available offline, with the offline messaging shown").
 *
 * It uses the SAME `simulatePractice` the server does, over the contacts the phone already holds, so the two cannot disagree about what a
 * practice ledger looks like. Nothing is sent and nothing could be: there is no network call here at all. Every row says it is simulated.
 * It is built only when Lumo could not be reached, and the screen says so: the person is practising on this phone, not on Lumo.
 */

const WHY: Record<string, string> = {
  not_invited: 'CONSENT_NOT_INVITED',
  waiting: 'CONSENT_AWAITING',
  withdrawn: 'CONSENT_WITHDRAWN',
  expired: 'CONSENT_INVITE_EXPIRED',
  details_changed: 'CONSENT_DETAILS_CHANGED',
};
const whyNot = (s: ConsentStatus | undefined) => WHY[s ?? 'not_invited'] ?? 'CONSENT_NOT_INVITED';

export function localPracticeIncident(settings: UserSettings | undefined, nowMs: number): Incident {
  const contacts = settings?.trustedContacts ?? [];
  const channels: Channel[] = settings?.security?.sendSmsOnSos ? ['push', 'sms'] : ['push'];
  const recipients: PracticeRecipient[] = contacts.map(c => ({
    id: c.id,
    eligible: c.consentStatus === 'agreed',
    ...(c.consentStatus === 'agreed' ? {} : { skipReason: whyNot(c.consentStatus) }),
    channels,
  }));
  const rows = simulatePractice(recipients);
  const roll = rollupIncident(rows);
  const iso = (offsetS: number | null) => (offsetS === null ? null : new Date(nowMs + offsetS * 1000).toISOString());
  const names = new Map(contacts.map(c => [c.id, c.name]));
  const attempts: IncidentAttempt[] = rows.map((r, i) => ({
    id: `practice-local-${i}`,
    recipientId: r.recipientId,
    recipientName: names.get(r.recipientId),
    channel: r.channel,
    purpose: 'ALERT',
    state: r.state,
    reason: r.reason,
    queuedAt: iso(0) as string,
    sentAt: iso(r.sentAfterS),
    deliveredAt: iso(r.deliveredAfterS),
    acknowledgedAt: null,
    failedAt: iso(r.failedAfterS),
    simulated: true,
  }));
  return {
    id: `practice-local-${nowMs}`,
    mode: 'practice',
    state: roll.outcome === 'NOTIFIED' ? 'NOTIFIED' : roll.outcome === 'PARTIALLY_NOTIFIED' ? 'PARTIALLY_NOTIFIED' : 'ALL_CHANNELS_FAILED',
    triggerType: 'manual',
    countdownEndsAt: null,
    locationAvailable: false,
    outcome: roll.outcome,
    escalation: null,
    reached: [...roll.reached, ...roll.acknowledged],
    acknowledged: [...roll.acknowledged],
    failed: [...roll.failed],
    pending: [...roll.pending],
    capped: [],
    attempts,
  };
}
