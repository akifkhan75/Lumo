import type { ConsentStatus } from '@lumo/types';

/**
 * The pre-filled text (docs/specs/OFFLINE_SOS.md, `device_direct_sms`). Pure: no clock, no I/O.
 *
 * Lumo cannot send an SMS silently on either platform. It can open the phone's own composer, addressed and written, for the PERSON to send:
 * one tap, not zero. So everything here is worded as "your text", never "Lumo sent": the person sends it from their own SIM and credit, and
 * neither Lumo nor the phone can say it was delivered. The text itself is in the first person, because that is who is sending it.
 */

export interface CachedContact { readonly id: string; readonly name: string; readonly phone: string; }
export interface TextFix { readonly latitude: number; readonly longitude: number; readonly accuracyM: number | null; readonly capturedAt: number; }

/** Consent applies to this channel too: only a contact who AGREED is ever kept for it. A cap keeps the encrypted value small. */
export const MAX_CACHED_CONTACTS = 10;

export function agreedForCache(contacts: ReadonlyArray<{ id: string; name: string; phone?: string | null; consentStatus?: ConsentStatus }> | null | undefined): CachedContact[] {
  return (contacts ?? [])
    .filter(c => c.consentStatus === 'agreed' && typeof c.phone === 'string' && c.phone.trim() !== '')
    .slice(0, MAX_CACHED_CONTACTS)
    .map(c => ({ id: c.id, name: c.name, phone: (c.phone as string).trim() }));
}

const FRESH_MS = 5 * 60 * 1000;

/**
 * What the text says. A position states WHEN it was and how precise, and a stale one says they may have moved: a text cannot update, so
 * it is worded as a fact about the past. With no position it says so rather than guess.
 */
export function offlineTextBody(fix: TextFix | null | undefined, nowMs: number): string {
  const lead = 'I pressed SOS in the Lumo app, but my phone has no signal, so Lumo could not alert you automatically.';
  const close = 'Please try to reach me, or call for help if you cannot.';
  if (!fix) return `${lead} I do not have a location. ${close}`;
  const ageMin = Math.max(0, Math.round((nowMs - fix.capturedAt) / 60_000));
  const stale = nowMs - fix.capturedAt > FRESH_MS;
  const within = fix.accuracyM === null ? '' : `, within ${Math.round(fix.accuracyM)} m`;
  const link = `https://maps.google.com/?q=${fix.latitude},${fix.longitude}`;
  const where = stale
    ? `My last known location (about ${ageMin} min ago${within}; I may have moved): ${link}`
    : `My location (about ${ageMin} min ago${within}): ${link}`;
  return `${lead} ${where}. ${close}`;
}

export type TextStatus = 'unavailable' | 'no_contacts' | 'sent' | 'cancelled' | 'unknown' | 'error';

/** What the screen says after the composer closes. "sent" means only that the person pressed send in their own messages app. */
export function textStatusLine(status: TextStatus, names: readonly string[]): string {
  const who = names.length > 0 ? names.join(', ') : 'your contacts';
  switch (status) {
    case 'sent':
      return `Your messages app says you sent the text to ${who}. Lumo can't tell whether it arrived.`;
    case 'cancelled':
      return "You didn't send the text. Nothing has been sent.";
    case 'unknown':
      return `Lumo can't tell whether you sent the text to ${who}. Check your messages.`;
    case 'unavailable':
      return "This phone can't open a text from Lumo. Call or message your contacts yourself.";
    case 'no_contacts':
      return 'Lumo has no saved number for a contact who has agreed to be alerted, so it cannot write the text. Call or message someone yourself.';
    case 'error':
      return "Lumo couldn't open the text. Call or message your contacts yourself.";
  }
}

export const TEXT_BUTTON = 'Text my contacts';
export const TEXT_BUTTON_LABEL = 'Open a text to your contacts with your last known location. You press send';
export const TEXT_EXPLAINER = 'Lumo writes the text and addresses it. You press send, from your own phone and credit. Lumo cannot send it for you.';
