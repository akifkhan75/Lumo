import { NativeModules } from 'react-native';
import { UserSettings, HazardReport, CreateHazardReportInput, FakeCallScript, PersonalInfo, Incident, RaiseSosInput, CreateJourneyInput, JourneyFix } from '@lumo/types';
import { ApiClient } from '@lumo/api-client';
import * as tokenStorage from './tokenStorage';

const DEFAULT_API_PORT = '3005';

// KI-1: the base URL used to be a hardcoded LAN address, so the app only
// worked on one developer's network and a release build pointed at a private
// IP. It is configuration now.
const resolveApiBaseUrl = (): string => {
    const explicit = process.env.EXPO_PUBLIC_API_URL;
    if (explicit) return explicit.replace(/\/+$/, '');

    const port = process.env.EXPO_PUBLIC_API_PORT || DEFAULT_API_PORT;

    // Development fallback: talk to whichever machine is serving the JS bundle.
    // A physical device cannot reach "localhost", and asking every developer to
    // edit a constant is how the hardcoded IP got committed in the first place.
    const sourceCode: any = NativeModules.SourceCode;
    const scriptURL: string | undefined =
        sourceCode?.getConstants?.().scriptURL ?? sourceCode?.scriptURL;
    const bundlerHost = scriptURL?.match(/^https?:\/\/([^/:]+)/)?.[1];
    if (bundlerHost) return `http://${bundlerHost}:${port}`;

    if (typeof __DEV__ !== 'undefined' && !__DEV__) {
        // A release build with no API URL configured cannot reach the backend
        // at all. Say so loudly rather than failing one request at a time.
        console.error(
            '[Lumo] EXPO_PUBLIC_API_URL is not set. This build cannot reach the Lumo API.'
        );
    }
    return `http://localhost:${port}`;
};

export const API_BASE_URL = resolveApiBaseUrl();

const apiClient = new ApiClient(API_BASE_URL);

let currentToken: string | null = null;

export const setAuthToken = (token: string | null) => {
    currentToken = token;
    apiClient.setToken(token);
};

export const getAuthToken = () => currentToken;

/**
 * Bring back the session from the previous launch, if there was one. Resolves
 * false on no session, on a storage fault and on a stalled read alike: all of
 * them mean "signed out", and none of them may throw.
 *
 * Restoring does not prove the token is still valid. The first authenticated
 * request does that, and only a 401 from it ends the session (see App.tsx).
 */
export const restoreSession = async (): Promise<boolean> => {
    const stored = await tokenStorage.loadToken();
    if (!stored) return false;
    setAuthToken(stored);
    return true;
};

/**
 * End the session: the in-memory token first (so no further request carries
 * it), then the stored copy. Logout used to do neither.
 */
export const signOut = async (): Promise<void> => {
    // Stop this phone receiving the account's contacts' alerts: revoke its push registration. The in-memory login is
    // cleared FIRST and synchronously (no further request may carry it), so the revoke uses a copy of it, is bounded to
    // two seconds, and can never hold up or fail a logout.
    const jwt = currentToken;
    setAuthToken(null);
    try {
        const id = await tokenStorage.loadPushDeviceId();
        if (id && jwt) {
            await Promise.race([
                new ApiClient(API_BASE_URL, jwt).revokeDevice(id).then(() => tokenStorage.clearPushDeviceId()),
                new Promise(resolve => setTimeout(resolve, 2000)),
            ]);
        }
    } catch { /* best effort: the server also drops a token the push service reports dead */ }
    // The emergency token is revoked on the server by logging out elsewhere; here it simply stops being kept.
    await tokenStorage.clearEmergencyToken();
    await tokenStorage.clearActiveSos();
    await tokenStorage.clearToken();
};

// Journeys (docs/specs/JOURNEYS.md).
export const createJourney = (input: CreateJourneyInput) => apiClient.createJourney(input);
export const getActiveJourney = () => apiClient.getActiveJourney();
export const checkInJourney = (id: string, expectedArrivalAt: string) => apiClient.checkInJourney(id, expectedArrivalAt);
export const arriveJourney = (id: string) => apiClient.arriveJourney(id);
export const cancelJourney = (id: string) => apiClient.cancelJourney(id);
export const postJourneyLocation = (id: string, snapshots: JourneyFix[]) => apiClient.postJourneyLocation(id, snapshots);
// The contact side (docs/specs/NOTIFICATIONS.md): a push address, joining as someone's contact, and the phone's own report back.
export const registerPushDevice = async (input: { platform: 'ios' | 'android'; osVersion: string; pushToken: string }): Promise<string> => {
    const { id } = await apiClient.registerDevice(input);
    await tokenStorage.savePushDeviceId(id);
    return id;
};
export const loadPushDeviceId = tokenStorage.loadPushDeviceId;
export const forgetPushDevice = tokenStorage.clearPushDeviceId;
export const revokePushDevice = async (): Promise<void> => {
    const id = await tokenStorage.loadPushDeviceId();
    if (!id) return;
    await apiClient.revokeDevice(id);
    await tokenStorage.clearPushDeviceId();
};
export const claimContactInvite = (token: string) => apiClient.claimContactInvite(token);
export const postNotificationReceipt = (attemptId: string, kind: 'delivered' | 'acknowledged') => apiClient.postNotificationReceipt(attemptId, kind);

// Incidents (docs/specs/INCIDENTS.md). The emergency token is tried FIRST for raising an SOS, so it never
// depends on the login being valid; reading falls back the other way to get contact names when a login exists.
export interface SosCredential { bearer: string | null; }

export const mintEmergencyToken = async (): Promise<boolean> => {
    try {
        const deviceKey = await tokenStorage.loadOrCreateDeviceKey();
        const minted = await apiClient.mintEmergencyToken(deviceKey);
        await tokenStorage.saveEmergencyToken(minted);
        return true;
    } catch {
        // Not fatal and not loud: the existing token (if any) keeps working until it expires.
        return false;
    }
};

export const clearEmergencyCredentials = async (): Promise<void> => { await tokenStorage.clearEmergencyToken(); };

const withCredentials = async <T>(call: (bearer: string | null | undefined) => Promise<T>): Promise<T> => {
    const stored = await tokenStorage.loadEmergencyToken();
    const emergency = stored && new Date(stored.expiresAt).getTime() > Date.now() ? stored.token : null;
    if (emergency) {
        try {
            return await call(emergency);
        } catch (e) {
            // A rejected emergency token falls back to the login; any other failure is the caller's to see.
            if (!(e instanceof Error && (e as { status?: number }).status === 401)) throw e;
        }
    }
    return call(undefined); // the stored login, if any
};

export const raiseSos = (key: string, input: RaiseSosInput): Promise<Incident> =>
    withCredentials(b => apiClient.raiseSos(key, input, b)).then(r => r.incident);
export const getIncident = (id: string): Promise<Incident> => withCredentials(b => apiClient.getIncident(id, b === undefined ? undefined : b));
export const cancelIncident = (id: string): Promise<Incident> => withCredentials(b => apiClient.cancelIncident(id, b));
export const resolveIncident = (id: string): Promise<Incident> => withCredentials(b => apiClient.resolveIncident(id, b));
export const loadActiveSos = tokenStorage.loadActiveSos;
export const saveActiveSos = tokenStorage.saveActiveSos;
export const clearActiveSos = tokenStorage.clearActiveSos;

// Auth
export const login = async (email: string, password: string): Promise<{user: PersonalInfo; token: string}> => {
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    if (!response.ok) throw new Error('HTTP error');
    const data = await response.json();
    if (data.token) {
        setAuthToken(data.token);
        await tokenStorage.saveToken(data.token);
    }
    return data;
};

export const signup = async (name: string, email: string, password: string): Promise<{user: PersonalInfo; token: string}> => {
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: name, name, email, password }),
    });
    if (!response.ok) throw new Error('HTTP error');
    const data = await response.json();
    if (data.token) {
        setAuthToken(data.token);
        await tokenStorage.saveToken(data.token);
    }
    return data;
};

// Settings
export const getSettings = async (): Promise<UserSettings> => {
    return apiClient.getSettings();
};

/** A link for the contact to open. Lumo sends nothing; the caller passes it on. */
export const createContactInvite = async (contactId: string): Promise<{ url: string; expiresAt: string }> => {
    const { path, expiresAt } = await apiClient.createContactInvite(contactId);
    return { url: `${API_BASE_URL}${path}`, expiresAt };
};

export const updateSettings = async (settings: UserSettings): Promise<UserSettings> => {
    return apiClient.updateSettings(settings);
};

// Hazard reports
export const getHazardReports = async (take?: number): Promise<HazardReport[]> => {
    return apiClient.getHazardReports(take);
};

export const reportHazard = async (details: CreateHazardReportInput): Promise<HazardReport> => {
    return apiClient.reportHazard(details);
};

export const confirmHazardReport = async (id: string): Promise<HazardReport> => {
    return apiClient.confirmHazardReport(id);
};

// AI Services
export const getFakeCallScript = async (): Promise<FakeCallScript> => {
    return apiClient.getFakeCallScript();
};

export const getSelfDefenseTips = async (): Promise<string[]> => {
    return apiClient.getSelfDefenseTips();
};

export const safetyChat = async (message: string, history?: any[]): Promise<{ response: string }> => {
    return apiClient.safetyChat(message, history);
};


