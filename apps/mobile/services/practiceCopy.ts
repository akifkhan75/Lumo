import type { Incident, UserSettings } from '@lumo/types';
import { headline } from './sosLedger';

/**
 * What the Practice screen says (docs/specs/PRACTICE_MODE.md). Pure.
 *
 * The one rule: it can never be mistaken for the real thing. The banner is the spec's exact words and is on screen in every state, and
 * every line about a result is marked as practice. It also never uses the real screen's reassuring wording ("Sent to 2") without saying
 * that nothing was sent.
 */

export const PRACTICE_BANNER = 'Practice — nobody will be contacted';

export const INTRO = [
  'Practice runs everything an SOS does, except sending. You will see your contacts the way Lumo would try them, and one example of a message that fails, so you know what that looks like.',
  'Nobody gets a message, a call or a notification. Nothing is saved to your history, and it does not count as an alert.',
];

export function contactsNote(settings: UserSettings | undefined): string {
  if (!settings) return "Lumo hasn't loaded your contacts, so practice will show what an SOS would show with none.";
  const agreed = settings.trustedContacts.filter(c => c.consentStatus === 'agreed').length;
  if (agreed === 0) return 'None of your contacts has agreed to be alerted, so practice will show "nobody to try" — exactly what a real SOS would show. Add one in Settings → Contact.';
  if (agreed === 1) return 'One contact has agreed. With a single contact and no text messages you will not see the example failure; add another to practise that.';
  return `${agreed} contacts have agreed.`;
}

/** The headline of a practice result: the ledger's own words, marked so they cannot be read as a real send. */
export const practiceHeadline = (incident: Incident): string => `Practice: ${headline(incident)}`;

export const PRACTICE_RESULT_NOTE = 'This is a rehearsal. Nothing was sent to anyone.';
export const OFFLINE_NOTE = "Lumo couldn't be reached, so this practice ran on your phone, using your saved contacts. In a real emergency the same thing would mean your contacts were not alerted: you would be told, and offered the phone dialler.";
export const SIGNED_OUT_NOTE = "You're not signed in here, so practice can't use your contacts. Sign in to practise.";
export const REAL_HELP_LABEL = 'Need real help? Open the emergency screen';
