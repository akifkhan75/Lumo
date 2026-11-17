import type { Incident, IncidentAttempt } from '@lumo/types';

/**
 * How the SOS screen words what the server says (docs/specs/DELIVERY_LEDGER.md §3–4).
 *
 * Every line states the MOST that is true, never more: a text that was accepted by the carrier is "sent,
 * delivery unconfirmed", never "delivered"; a push nobody confirmed is "sent, not confirmed"; only a human's
 * "I'm responding" is "responding". There is no aggregate tick: each contact is listed on their own, failures
 * as prominently as successes, and every state carries its time.
 *
 * Pure: no clock, no I/O.
 */

export const REASON_TEXT: Record<string, string> = {
  NO_ADDRESS: 'Lumo has no app or number to reach them on',
  PROVIDER_NOT_CONFIGURED: 'Lumo cannot send this kind of message yet',
  CONSENT_NOT_INVITED: "they haven't been asked to be a contact",
  CONSENT_AWAITING: "they haven't agreed yet",
  CONSENT_INVITE_EXPIRED: "their invitation ran out and they haven't agreed",
  CONSENT_WITHDRAWN: 'they withdrew their agreement',
  CONSENT_DETAILS_CHANGED: 'their number changed, so they need to agree again',
  CONTACT_REMOVED: 'they were removed as a contact',
  MAX_RECIPIENTS: "your plan limits how many people are alerted, and that limit was reached",
  SPEND_CAP: "you've reached today's limit for this kind of message",
  CHANNEL_DISABLED_FOR_REGION: "this kind of message isn't available where you are",
  REGISTRATION_INCOMPLETE: "this kind of message isn't available where you are yet",
  NEVER_SENT: 'it was not sent in time',
  SEND_OUTCOME_UNKNOWN: 'Lumo could not confirm whether it went',
  NO_RECEIPT_BY_TTL: 'no confirmation came back',
};

export const reasonText = (reason: string | null): string => {
  if (!reason) return 'it did not go through';
  if (REASON_TEXT[reason]) return REASON_TEXT[reason];
  if (reason.startsWith('VOICE_')) return 'the call was not answered';
  return 'the provider reported a problem';
};

const CHANNEL_NOUN: Record<string, string> = { sms: 'Text', push: 'App alert', voice: 'Call', web: 'Link', email: 'Email', device_direct_sms: 'Text from your phone' };
export const channelNoun = (c: string) => CHANNEL_NOUN[c] ?? 'Message';

export const clock = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

/** The one line for one attempt. */
export function attemptLine(a: IncidentAttempt): string {
  const noun = channelNoun(a.channel);
  switch (a.state) {
    case 'QUEUED':
      return `${noun}: waiting to send`;
    case 'SENT':
      return `${noun}: sent ${clock(a.sentAt)} — not confirmed`;
    case 'DELIVERED':
      return `${noun}: delivered ${clock(a.deliveredAt)}`;
    case 'ACKNOWLEDGED':
      return `${noun}: they are responding (${clock(a.acknowledgedAt)})`;
    case 'UNKNOWN':
      return `${noun}: sent ${clock(a.sentAt)} — we couldn't confirm it arrived`;
    case 'EXPIRED':
      return `${noun}: not sent in time`;
    case 'FAILED':
      return `${noun}: could not reach — ${reasonText(a.reason)}`;
  }
}

export interface ContactRow {
  readonly recipientId: string;
  readonly name: string;
  readonly lines: readonly string[];
  readonly standing: 'responding' | 'reached' | 'pending' | 'failed';
}

const RANK = { responding: 3, reached: 2, pending: 1, failed: 0 } as const;
const standingOf = (a: IncidentAttempt): ContactRow['standing'] =>
  a.state === 'ACKNOWLEDGED' ? 'responding'
  : a.state === 'DELIVERED' || a.state === 'UNKNOWN' || (a.state === 'SENT' && a.channel !== 'push' && a.channel !== 'sms') ? 'reached'
  : a.state === 'SENT' || a.state === 'QUEUED' ? 'pending'
  : 'failed';

/** One row per contact, alert attempts only (the "it ended" messages are not part of the alert). */
export function contactRows(incident: Incident): ContactRow[] {
  const byContact = new Map<string, IncidentAttempt[]>();
  for (const a of incident.attempts) if (a.purpose === 'ALERT') byContact.set(a.recipientId, [...(byContact.get(a.recipientId) ?? []), a]);
  let n = 0;
  return [...byContact].map(([recipientId, attempts]) => {
    n += 1;
    const standings = attempts.map(standingOf);
    // A sent text counts as "reached" for the contact, because the carrier accepted it; the line still says "not confirmed".
    const reachedByText = attempts.some(a => a.state === 'SENT' || a.state === 'UNKNOWN' || a.state === 'DELIVERED');
    const best = standings.reduce((x, y) => (RANK[y] > RANK[x] ? y : x), 'failed' as ContactRow['standing']);
    return {
      recipientId,
      name: attempts.find(a => a.recipientName)?.recipientName ?? `Contact ${n}`,
      lines: attempts.map(attemptLine),
      standing: best === 'pending' && reachedByText ? 'reached' : best,
    };
  });
}

/** The headline, in the spec's words. Never "contacts have been notified". */
export function headline(incident: Incident): string {
  const rows = contactRows(incident);
  const named = (xs: ContactRow[]) => xs.map(r => r.name).join(', ');
  const responding = rows.filter(r => r.standing === 'responding');
  const reached = rows.filter(r => r.standing === 'reached' || r.standing === 'responding');
  const failed = rows.filter(r => r.standing === 'failed');
  switch (incident.state) {
    case 'ACKNOWLEDGED':
      return responding.length > 0 ? `${named(responding)} ${responding.length > 1 ? 'are' : 'is'} responding` : 'Someone is responding';
    case 'NOTIFIED':
      return `Sent to ${reached.length} · no response yet`;
    case 'PARTIALLY_NOTIFIED':
      return `Sent to ${reached.length} of ${rows.length} · couldn't reach ${named(failed)}`;
    case 'ALL_CHANNELS_FAILED':
      return "Couldn't reach anyone";
    case 'NOTIFYING':
      return rows.length > 0 ? 'Sending…' : 'Sending…';
    case 'CLOSED':
    case 'RESOLVING':
      return 'Ended';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return 'Starting…';
  }
}
