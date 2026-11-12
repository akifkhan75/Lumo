import * as SecureStore from 'expo-secure-store';
import { saveToken, loadToken, clearToken, READ_TIMEOUT_MS } from '../services/tokenStorage';

const mockStore = (SecureStore as any).__store as Map<string, string>;
const getItem = SecureStore.getItemAsync as jest.Mock;
const setItem = SecureStore.setItemAsync as jest.Mock;
const deleteItem = SecureStore.deleteItemAsync as jest.Mock;

describe('tokenStorage', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    mockStore.clear();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    jest.useRealTimers();
  });

  it('round-trips a token through the keystore', async () => {
    await saveToken('jwt-abc');
    expect(await loadToken()).toBe('jwt-abc');
  });

  it('asks for after-first-unlock access, not only-while-unlocked', async () => {
    await saveToken('jwt-abc');
    expect(setItem).toHaveBeenLastCalledWith(expect.any(String), 'jwt-abc', {
      keychainAccessible: 'AFTER_FIRST_UNLOCK',
    });
  });

  it('reports no session when nothing is stored', async () => {
    expect(await loadToken()).toBeNull();
  });

  it('clears the stored token and says so', async () => {
    await saveToken('jwt-abc');
    expect(await clearToken()).toBe(true);
    expect(await loadToken()).toBeNull();
  });

  describe('a fault never throws and never leaves the app unable to start', () => {
    it('treats an unreadable keystore as signed out', async () => {
      getItem.mockRejectedValueOnce(new Error('keychain unavailable'));
      await expect(loadToken()).resolves.toBeNull();
    });

    it('does not throw when saving fails', async () => {
      setItem.mockRejectedValueOnce(new Error('disk full'));
      await expect(saveToken('jwt-abc')).resolves.toBeUndefined();
    });

    it('tells the caller when a token could not be removed', async () => {
      deleteItem.mockRejectedValueOnce(new Error('keychain locked'));
      // A failed delete means the next launch restores a session that was just
      // ended, so the caller has to be able to see it.
      await expect(clearToken()).resolves.toBe(false);
    });

    it('gives up on a read that never answers instead of hanging the launch', async () => {
      jest.useFakeTimers();
      getItem.mockImplementationOnce(() => new Promise(() => {}));

      const result = loadToken();
      await jest.advanceTimersByTimeAsync(READ_TIMEOUT_MS);

      await expect(result).resolves.toBeNull();
    });

    it('leaves no timer behind after a read that answered in time', async () => {
      jest.useFakeTimers();
      await saveToken('jwt-abc');
      await loadToken();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  it('never writes the token itself to the log', async () => {
    const secret = 'jwt-SECRET-VALUE';
    setItem.mockRejectedValueOnce(new Error('disk full'));
    getItem.mockRejectedValueOnce(new Error('unreadable'));
    deleteItem.mockRejectedValueOnce(new Error('locked'));

    await saveToken(secret);
    await loadToken();
    await clearToken();

    expect(warn).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
  });
});
