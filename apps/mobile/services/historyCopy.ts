import type { IncidentSummary, IncidentTimeline, TimelineEntry } from '@lumo/types';
import { channelNoun, reasonText } from './sosLedger';

/**
 * What the history says (docs/specs/INCIDENT_HISTORY.md). Pure.
 *
 * The same rule as the live ledger, looking back: say the MOST that is true. "Sent to 2 of 3" is what the ledger recorded; it is never
 * "contacts were notified", and a delivered message is only called delivered when the channel can say so. A rehearsal is marked wherever
 * it appears, so a list or a shared file can never be read as a real alert.
 */

export const PRACTICE_NOTE = 'Practice: nobody was contacted.';

const TRIGGER: Record<string, string> = {
  manual: 'You pressed SOS',
  shake: 'Triggered by shaking the phone',
  voice: 'Triggered by your voice',
  safeword: 'Triggered by your safeword',
  crash: 'A crash was detected',
  fall: 'A fall was detected',
  missed_check_in: 'A journey check-in went unanswered',
  duress: 'A discreet trigger',
};
export const triggerLabel = (t: string): string => TRIGGER[t] ?? 'An alert';

export function whenLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** What happened to it, from the ledger's own counts. Never more than the counts say. */
export function outcomeText(s: IncidentSummary): string {
  if (s.state === 'CANCELLED') return 'Cancelled before it was sent';
  if (s.state === 'CREATED') return 'Counting down';
  if (s.outcome === 'ACKNOWLEDGED') return 'A contact said they were responding';
  if (s.contactsTried === 0) return 'No contact could be alerted';
  const sent = `Sent to ${s.contactsReached} of ${s.contactsTried}`;
  return s.contactsFailed > 0 ? `${sent} · couldn't reach ${s.contactsFailed}` : sent;
}

export function lateText(s: IncidentSummary): string | null {
  if (s.lateBySeconds < 120) return null;
  const m = Math.round(s.lateBySeconds / 60);
  return m < 60 ? `Sent about ${m} minutes after you pressed it: there was no signal.` : `Sent about ${Math.round(m / 60)} hours after you pressed it: there was no signal.`;
}

/** A row's pieces: what it was, and the lines under it (when, how it went, and the marks that stop it being misread). */
export function rowParts(s: IncidentSummary): { title: string; details: string[] } {
  const details = [whenLabel(s.triggeredAt), outcomeText(s)];
  if (s.mode === 'practice') details.push(PRACTICE_NOTE);
  const late = lateText(s);
  if (late) details.push(late);
  return { title: s.mode === 'practice' ? 'Practice run' : triggerLabel(s.triggerType), details: details.filter(Boolean) };
}

/** The whole row as one sentence for a screen reader: what, when, and how it went. */
export function rowLabel(s: IncidentSummary): string {
  const { title, details } = rowParts(s);
  return [title, ...details].join('. ');
}

const STATE_WORDS: Record<string, string> = {
  CREATED: 'Alert started',
  DISPATCHING: 'Working out who to alert',
  NOTIFYING: 'Sending to your contacts',
  NOTIFIED: 'Sent to your contacts, no response yet',
  PARTIALLY_NOTIFIED: 'Sent to some of your contacts',
  ALL_CHANNELS_FAILED: "Couldn't reach anyone",
  ACKNOWLEDGED: 'A contact said they were responding',
  RESOLVING: 'Ending the alert',
  CLOSED: 'Ended',
  CANCELLED: 'Cancelled',
};
const ACTOR: Record<string, string> = { user: 'you', system: 'Lumo', policy: 'your plan', contact: 'a contact' };
const ATTEMPT_WORDS: Record<string, string> = {
  QUEUED: 'waiting to send',
  SENT: 'sent, not confirmed',
  DELIVERED: 'delivered',
  ACKNOWLEDGED: 'they said they were responding',
  UNKNOWN: "sent, couldn't confirm it arrived",
  EXPIRED: 'not sent in time',
};

/** One entry in words. The ledger's wording, with the time left to the caller. */
export function entryText(e: TimelineEntry): string {
  const mark = e.simulated ? ' (practice)' : '';
  if (e.kind === 'incident') {
    const who = e.actor ? ` (${ACTOR[e.actor] ?? e.actor})` : '';
    return `${STATE_WORDS[e.to] ?? e.event}${who}`;
  }
  const what = e.to === 'FAILED' ? `could not reach: ${reasonText(e.reason)}` : (ATTEMPT_WORDS[e.to] ?? e.to.toLowerCase());
  const kind = e.purpose === 'RESOLVED' ? 'It-ended message' : channelNoun(e.channel ?? '');
  return `${kind} to ${e.recipient ?? 'a contact'}: ${what}${mark}`;
}

export const clock = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
};

/** The text a person shares. Names and times, as the audited export gave them: never a position or a number, because the export has none. */
export function timelineShareText(t: IncidentTimeline): string {
  const head = t.incident.mode === 'practice'
    ? `Lumo practice run, ${whenLabel(t.incident.triggeredAt)}. ${PRACTICE_NOTE}`
    : `Lumo alert, ${whenLabel(t.incident.triggeredAt)}. ${outcomeText(t.incident)}.`;
  const late = t.incident.mode === 'real' ? lateText(t.incident) : null;
  return [head, ...(late ? [late] : []), '', ...t.entries.map(e => `${clock(e.at)}  ${entryText(e)}`)].join('\n');
}
