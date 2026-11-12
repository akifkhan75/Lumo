import { NativeModules } from 'react-native';
import { UserSettings, HazardReport, CreateHazardReportInput, FakeCallScript, PersonalInfo } from '@lumo/types';
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
    setAuthToken(null);
    await tokenStorage.clearToken();
};

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


