import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient } from './index';

describe('ApiClient', () => {
  let client: ApiClient;
  const baseUrl = 'http://localhost:3005';

  beforeEach(() => {
    client = new ApiClient(baseUrl);
    vi.restoreAllMocks();
  });

  it('initializes with base URL and optional token', () => {
    const clientWithToken = new ApiClient('http://localhost:3005/', 'test-token');
    expect(clientWithToken.getToken()).toBe('test-token');
  });

  it('sets and gets authorization token correctly', () => {
    expect(client.getToken()).toBeNull();
    client.setToken('new-token-123');
    expect(client.getToken()).toBe('new-token-123');
    client.setToken(null);
    expect(client.getToken()).toBeNull();
  });

  it('performs login successfully and stores token', async () => {
    const mockAuthResponse = {
      user: { fullName: 'Josim', email: 'josim@example.com' },
      token: 'jwt-auth-token-123',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockAuthResponse,
    } as any);

    const result = await client.login('josim@example.com', 'password');
    expect(result).toEqual(mockAuthResponse);
    expect(client.getToken()).toBe('jwt-auth-token-123');
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'josim@example.com', password: 'password' }),
    });
  });

  it('performs signup successfully and stores token', async () => {
    const mockAuthResponse = {
      user: { fullName: 'New User', email: 'new@example.com' },
      token: 'jwt-signup-token-456',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockAuthResponse,
    } as any);

    const result = await client.signup('New User', 'new@example.com', 'password123');
    expect(result).toEqual(mockAuthResponse);
    expect(client.getToken()).toBe('jwt-signup-token-456');
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'New User', name: 'New User', email: 'new@example.com', password: 'password123' }),
    });
  });

  it('throws descriptive error on failed HTTP responses', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Invalid credentials' }),
    } as any);

    await expect(client.login('bad@example.com', 'wrong')).rejects.toThrow('Invalid credentials');
  });

  it('handles error when response JSON is not parseable', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('Parse error');
      },
    } as any);

    await expect(client.getSettings()).rejects.toThrow('An unknown error occurred');
  });

  it('fetches settings with auth header', async () => {
    client.setToken('auth-token');
    const mockSettings = {
      personalInfo: { fullName: 'Josim' },
      contacts: [],
      security: { locationSharingEnabled: true },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSettings,
    } as any);

    const settings = await client.getSettings();
    expect(settings).toEqual(mockSettings);
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/settings`, {
      headers: { Authorization: 'Bearer auth-token' },
    });
  });

  it('updates settings with PUT request', async () => {
    client.setToken('auth-token');
    const updatedSettings = {
      personalInfo: { fullName: 'Josim Updated' },
      contacts: [],
      security: { locationSharingEnabled: false },
    } as any;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => updatedSettings,
    } as any);

    const result = await client.updateSettings(updatedSettings);
    expect(result).toEqual(updatedSettings);
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer auth-token',
      },
      body: JSON.stringify(updatedSettings),
    });
  });

  it('fetches hazard reports', async () => {
    client.setToken('auth-token');
    const mockReports = [
      {
        id: '1',
        type: 'POOR_LIGHTING',
        source: 'COMMUNITY',
        coordinates: { latitude: 51.5074, longitude: -0.1278, accuracyMetres: 12 },
        confirmationCount: 0,
        influencesRouting: false,
      },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockReports,
    } as any);

    const reports = await client.getHazardReports();
    expect(reports).toEqual(mockReports);
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/hazard-reports`, {
      headers: { Authorization: 'Bearer auth-token' },
    });
  });

  it('passes a page size through when fetching hazard reports', async () => {
    client.setToken('auth-token');
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] } as any);

    await client.getHazardReports(10);
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/v1/hazard-reports?take=10`,
      { headers: { Authorization: 'Bearer auth-token' } },
    );
  });

  it('reports a hazard with its coordinates', async () => {
    client.setToken('auth-token');
    const newReport = {
      type: 'POOR_LIGHTING' as const,
      description: 'Streetlight out on the footbridge',
      latitude: 51.5074,
      longitude: -0.1278,
      accuracyMetres: 12,
    };

    const mockCreated = { id: '2', ...newReport, confirmationCount: 0 };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockCreated,
    } as any);

    const result = await client.reportHazard(newReport);
    expect(result).toEqual(mockCreated);
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/hazard-reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer auth-token',
      },
      body: JSON.stringify(newReport),
    });
  });

  it('confirms a hazard report', async () => {
    client.setToken('auth-token');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: '2', confirmationCount: 1 }),
    } as any);

    const result = await client.confirmHazardReport('2');
    expect(result).toEqual({ id: '2', confirmationCount: 1 });
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/v1/hazard-reports/2/confirm`,
      { method: 'POST', headers: { Authorization: 'Bearer auth-token' } },
    );
  });

  it('fetches fake call script from AI endpoint', async () => {
    client.setToken('auth-token');
    const mockScript = {
      callerName: 'Alex',
      script: ['Hey, where are you?', 'Come over quickly!'],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockScript,
    } as any);

    const script = await client.getFakeCallScript();
    expect(script).toEqual(mockScript);
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/ai/fake-call-script`, {
      headers: { Authorization: 'Bearer auth-token' },
    });
  });

  it('fetches self defense tips from AI endpoint', async () => {
    client.setToken('auth-token');
    const mockTips = ["Yell 'FIRE!'", 'Run towards well-lit areas'];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockTips,
    } as any);

    const tips = await client.getSelfDefenseTips();
    expect(tips).toEqual(mockTips);
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/ai/self-defense-tips`, {
      headers: { Authorization: 'Bearer auth-token' },
    });
  });

  it('interacts with safety chat assistant', async () => {
    client.setToken('auth-token');
    const mockChatResponse = { response: 'Stay in a populated area and call for assistance.' };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockChatResponse,
    } as any);

    const response = await client.safetyChat('Is this area safe?');
    expect(response).toEqual(mockChatResponse);
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/ai/safety-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer auth-token',
      },
      body: JSON.stringify({ message: 'Is this area safe?', history: [] }),
    });
  });
});
