import * as SecureStore from 'expo-secure-store';
import * as apiService from '../services/apiService';

const mockStore = (SecureStore as any).__store as Map<string, string>;

describe('logging out stops this phone receiving alerts', () => {
  beforeEach(() => {
    mockStore.clear();
    apiService.setAuthToken(null);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('revokes the push registration with the login, but clears the login FIRST and synchronously', async () => {
    apiService.setAuthToken('jwt-1');
    mockStore.set('lumo.auth.token', 'jwt-1');
    mockStore.set('lumo.push.deviceId', 'dev-9');
    let tokenAtRequest: string | undefined;
    global.fetch = jest.fn().mockImplementation(async (_u: string, init: any) => {
      tokenAtRequest = init.headers.Authorization;
      return { ok: true, status: 204, json: async () => ({}) };
    }) as any;

    const done = apiService.signOut();
    expect(apiService.getAuthToken()).toBeNull(); // no further request may carry it
    await done;

    expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/devices\/dev-9$/), expect.objectContaining({ method: 'DELETE' }));
    expect(tokenAtRequest).toBe('Bearer jwt-1'); // the revoke itself was authorised by the login being ended
    expect([...mockStore.keys()]).not.toContain('lumo.push.deviceId');
    expect([...mockStore.keys()]).not.toContain('lumo.auth.token');
  });

  it('a revoke that fails or hangs never blocks or fails the logout', async () => {
    jest.useFakeTimers();
    apiService.setAuthToken('jwt-1');
    mockStore.set('lumo.auth.token', 'jwt-1');
    mockStore.set('lumo.push.deviceId', 'dev-9');
    global.fetch = jest.fn().mockImplementation(() => new Promise(() => {})) as any; // never answers
    const done = apiService.signOut();
    await jest.advanceTimersByTimeAsync(2100);
    await expect(done).resolves.toBeUndefined();
    expect([...mockStore.keys()]).not.toContain('lumo.auth.token'); // still signed out
    jest.useRealTimers();
  });

  it('with no push registration it makes no request at all', async () => {
    apiService.setAuthToken('jwt-1');
    global.fetch = jest.fn() as any;
    await apiService.signOut();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
