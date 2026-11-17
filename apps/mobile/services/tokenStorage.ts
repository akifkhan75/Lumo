import * as SecureStore from 'expo-secure-store';

/**
 * Where the login token survives a restart.
 *
 * The token used to live only in a module variable, so every cold start needed a
 * successful network login before anything was reachable (KI-4). It is kept in
 * the platform keychain/keystore now.
 *
 * Nothing in here may throw or hang. This is called on the way into the app, and
 * a storage fault must never be the reason someone cannot reach the emergency
 * screen. Every failure degrades to "no stored session": the person is signed
 * out, which is recoverable, instead of the app failing to start, which is not.
 */

const TOKEN_KEY = 'lumo.auth.token';

// SecureStore is a native call and can stall (a locked keychain, a broken
// device). Bound it, and treat a stall exactly like an empty store.
export const READ_TIMEOUT_MS = 1500;

// Readable after the first unlock since boot, not only while the screen is
// unlocked, because the credential that reaches the API is needed by anything
// that runs with the phone in a pocket.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

const warn = (action: string, err: unknown) => {
  // Never log the token, only that the operation failed.
  console.warn(`[Lumo] Could not ${action} the stored session:`, err instanceof Error ? err.message : err);
};

const EMERGENCY_KEY = 'lumo.emergency.token';
const DEVICE_KEY = 'lumo.device.key';
const ACTIVE_KEY = 'lumo.sos.active';

/** Bounded read of any key, as above: a fault or a stall is "nothing stored". Never throws. */
const readKey = async (key: string): Promise<string | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS); });
    return await Promise.race([SecureStore.getItemAsync(key, OPTIONS), timeout]);
  } catch (err) {
    warn('read', err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
};
const writeKey = async (key: string, value: string): Promise<void> => {
  try { await SecureStore.setItemAsync(key, value, OPTIONS); } catch (err) { warn('save', err); }
};
const deleteKey = async (key: string): Promise<void> => {
  try { await SecureStore.deleteItemAsync(key, OPTIONS); } catch (err) { warn('clear', err); }
};

/**
 * The emergency token (PLAT-4): what lets an SOS dispatch when the login has expired. It is not a
 * login, it can only act on incidents the user raised, and it is removed on logout.
 */
export const saveEmergencyToken = (value: { id: string; token: string; expiresAt: string }) => writeKey(EMERGENCY_KEY, JSON.stringify(value));
export const loadEmergencyToken = async (): Promise<{ id: string; token: string; expiresAt: string } | null> => {
  const raw = await readKey(EMERGENCY_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return typeof v?.token === 'string' && typeof v?.id === 'string' ? v : null;
  } catch { return null; }
};
export const clearEmergencyToken = () => deleteKey(EMERGENCY_KEY);

/** A stable per-install value, so minting a new emergency token replaces this device's old one. */
export const loadOrCreateDeviceKey = async (): Promise<string> => {
  const existing = await readKey(DEVICE_KEY);
  if (existing) return existing;
  const fresh = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  await writeKey(DEVICE_KEY, fresh);
  return fresh;
};

/**
 * An SOS in progress, written BEFORE any network call: ids and a time only, never a position or a name.
 * If the app is killed mid-countdown, the server still dispatches (it owns the countdown); this lets the
 * next launch show the incident again instead of losing it.
 */
export interface ActiveSos {
  key: string;
  incidentId?: string;
  startedAt: number;
  trigger: string;
  /** The last known position at the press (docs/specs/OFFLINE_SOS.md), so a late send still carries where the person was. */
  fix?: { latitude: number; longitude: number; accuracyM: number | null; capturedAt: number };
  /** The person cancelled while Lumo could not be reached. Nothing may be sent for this key; the cancel is what is still being settled. */
  cancelled?: boolean;
}
export const saveActiveSos = (v: ActiveSos) => writeKey(ACTIVE_KEY, JSON.stringify(v));
export const loadActiveSos = async (): Promise<ActiveSos | null> => {
  const raw = await readKey(ACTIVE_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return typeof v?.key === 'string' && typeof v?.startedAt === 'number' ? v : null;
  } catch { return null; }
};
export const clearActiveSos = () => deleteKey(ACTIVE_KEY);

const CONTACTS_KEY = 'lumo.offline.contacts';
/**
 * The contacts who AGREED, kept encrypted on this phone (the platform keychain/keystore) so the pre-filled text can be addressed with no
 * signal (docs/specs/OFFLINE_SOS.md). Personal data at rest: only agreed contacts, only name and number, refreshed whenever settings load,
 * and removed on logout.
 */
export const saveOfflineContacts = (list: ReadonlyArray<{ id: string; name: string; phone: string }>) =>
  list.length === 0 ? deleteKey(CONTACTS_KEY) : writeKey(CONTACTS_KEY, JSON.stringify(list));
export const loadOfflineContacts = async (): Promise<{ id: string; name: string; phone: string }[]> => {
  const raw = await readKey(CONTACTS_KEY);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(c => typeof c?.id === 'string' && typeof c?.name === 'string' && typeof c?.phone === 'string') : [];
  } catch { return []; }
};
export const clearOfflineContacts = () => deleteKey(CONTACTS_KEY);

const PUSH_DEVICE_KEY = 'lumo.push.deviceId';
/** The server-side id of THIS phone's push registration, so logout can revoke it. Not the push token itself. */
export const savePushDeviceId = (id: string) => writeKey(PUSH_DEVICE_KEY, id);
export const loadPushDeviceId = () => readKey(PUSH_DEVICE_KEY);
export const clearPushDeviceId = () => deleteKey(PUSH_DEVICE_KEY);

export const saveToken = async (token: string): Promise<void> => {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token, OPTIONS);
  } catch (err) {
    warn('save', err);
  }
};

export const loadToken = async (): Promise<string | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS);
    });
    return await Promise.race([SecureStore.getItemAsync(TOKEN_KEY, OPTIONS), timeout]);
  } catch (err) {
    warn('read', err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Returns whether the token was actually removed. A caller signing someone out
 * may want to know: if the delete failed, the next launch will restore the
 * session they just ended.
 */
export const clearToken = async (): Promise<boolean> => {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY, OPTIONS);
    return true;
  } catch (err) {
    warn('clear', err);
    return false;
  }
};
