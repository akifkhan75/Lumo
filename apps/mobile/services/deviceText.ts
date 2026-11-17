import * as SMS from 'expo-sms';
import type { CachedContact, TextStatus } from './offlineText';

/**
 * Opens the phone's own composer, addressed and written (docs/specs/OFFLINE_SOS.md). NOT a send: the person presses send, and the result
 * says only what the composer said ("sent" means they pressed it in their messages app; some platforms say "unknown"). Never throws, because
 * a fault here must never be what stops a person asking for help another way.
 */
export async function openOfflineText(contacts: readonly CachedContact[], body: string): Promise<TextStatus> {
  if (contacts.length === 0) return 'no_contacts';
  try {
    if (!(await SMS.isAvailableAsync())) return 'unavailable';
    const { result } = await SMS.sendSMSAsync(contacts.map(c => c.phone), body);
    return result === 'sent' ? 'sent' : result === 'cancelled' ? 'cancelled' : 'unknown';
  } catch {
    return 'error';
  }
}
