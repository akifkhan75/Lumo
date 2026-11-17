import * as SecureStore from 'expo-secure-store';
import * as apiService from '../services/apiService';
import * as tokenStorage from '../services/tokenStorage';

const store = (SecureStore as any).__store as Map<string, string>;
const KEY = 'lumo.offline.contacts';
const settings = (contacts: any[]) => ({ personalInfo: {}, security: {}, trustedContacts: contacts });
const respond = (body: unknown) => { global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }) as any; };
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => { store.clear(); apiService.setAuthToken('jwt'); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

describe('the offline copy of the contacts who agreed', () => {
  it('is kept when settings load, with only the agreed, as id, name and number', async () => {
    respond(settings([
      { id: 'a', name: 'Maya', phone: '+1', consentStatus: 'agreed' },
      { id: 'b', name: 'Dad', phone: '+2', consentStatus: 'waiting' },
    ]));
    await apiService.getSettings();
    await flush();
    expect(JSON.parse(store.get(KEY) as string)).toEqual([{ id: 'a', name: 'Maya', phone: '+1' }]);
    expect(store.get(KEY)).not.toContain('Dad'); // a contact who has not agreed is never kept
  });

  it('follows a change: someone who withdrew is gone, and with none left nothing is kept', async () => {
    respond(settings([{ id: 'a', name: 'Maya', phone: '+1', consentStatus: 'agreed' }]));
    await apiService.getSettings(); await flush();
    expect(store.has(KEY)).toBe(true);
    respond(settings([{ id: 'a', name: 'Maya', phone: '+1', consentStatus: 'withdrawn' }]));
    await apiService.updateSettings(settings([]) as any); await flush();
    expect(store.has(KEY)).toBe(false);
  });

  it('is removed on logout, so someone else\'s contacts do not stay on the phone', async () => {
    respond(settings([{ id: 'a', name: 'Maya', phone: '+1', consentStatus: 'agreed' }]));
    await apiService.getSettings(); await flush();
    expect(store.has(KEY)).toBe(true);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) }) as any;
    await apiService.signOut();
    expect(store.has(KEY)).toBe(false);
  });

  it('is left alone when settings cannot be loaded (offline is exactly when it is needed)', async () => {
    respond(settings([{ id: 'a', name: 'Maya', phone: '+1', consentStatus: 'agreed' }]));
    await apiService.getSettings(); await flush();
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as any;
    await expect(apiService.getSettings()).rejects.toBeDefined();
    expect(store.has(KEY)).toBe(true);
  });

  it('a storage fault never fails or slows loading settings', async () => {
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keychain locked'));
    respond(settings([{ id: 'a', name: 'Maya', phone: '+1', consentStatus: 'agreed' }]));
    await expect(apiService.getSettings()).resolves.toBeDefined();
  });

  it('reads back as nothing when the stored value is damaged, never throws', async () => {
    store.set(KEY, '{not json');
    expect(await tokenStorage.loadOfflineContacts()).toEqual([]);
    store.set(KEY, JSON.stringify([{ id: 'a', name: 'Maya', phone: '+1' }, { id: 5 }, null, 'x']));
    expect(await tokenStorage.loadOfflineContacts()).toEqual([{ id: 'a', name: 'Maya', phone: '+1' }]);
  });
});
