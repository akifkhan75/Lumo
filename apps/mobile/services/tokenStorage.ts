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
