import * as SecureStore from 'expo-secure-store';
import * as apiService from '../services/apiService';

const mockStore = (SecureStore as any).__store as Map<string, string>;

const okJson = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response;

describe('session persistence (KI-4)', () => {
  beforeEach(() => {
    mockStore.clear();
    apiService.setAuthToken(null);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the token after login so the next launch can restore it', async () => {
    global.fetch = jest.fn().mockResolvedValue(okJson({ user: {}, token: 'jwt-1' })) as any;

    await apiService.login('a@b.co', 'pw');

    expect([...mockStore.values()]).toEqual(['jwt-1']);
  });

  it('keeps the token after signup too', async () => {
    global.fetch = jest.fn().mockResolvedValue(okJson({ user: {}, token: 'jwt-2' })) as any;

    await apiService.signup('A', 'a@b.co', 'pw');

    expect([...mockStore.values()]).toEqual(['jwt-2']);
  });

  it('restores a stored session into memory', async () => {
    mockStore.set('lumo.auth.token', 'jwt-stored');

    await expect(apiService.restoreSession()).resolves.toBe(true);
    expect(apiService.getAuthToken()).toBe('jwt-stored');
  });

  it('reports no session when nothing is stored, and leaves memory untouched', async () => {
    await expect(apiService.restoreSession()).resolves.toBe(false);
    expect(apiService.getAuthToken()).toBeNull();
  });

  it('treats an unreadable keystore as signed out, not an error', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keychain unavailable'));

    await expect(apiService.restoreSession()).resolves.toBe(false);
  });

  it('signs out of both memory and storage', async () => {
    mockStore.set('lumo.auth.token', 'jwt-stored');
    apiService.setAuthToken('jwt-stored');

    await apiService.signOut();

    expect(apiService.getAuthToken()).toBeNull();
    expect(mockStore.size).toBe(0);
  });

  it('stops sending the token the moment sign-out begins', async () => {
    apiService.setAuthToken('jwt-stored');
    global.fetch = jest.fn().mockResolvedValue(okJson({})) as any;

    const pending = apiService.signOut();
    // The in-memory token is cleared synchronously, before the storage delete
    // is awaited, so a request fired during sign-out cannot carry it.
    expect(apiService.getAuthToken()).toBeNull();
    await pending;
  });
});
