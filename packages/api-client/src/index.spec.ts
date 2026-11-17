import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient, ApiError } from './index';

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
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/auth/login`, expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'josim@example.com', password: 'password' }),
    }));
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
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/auth/signup`, expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'New User', name: 'New User', email: 'new@example.com', password: 'password123' }),
    }));
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
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/settings`, expect.objectContaining({
      headers: { Authorization: 'Bearer auth-token' },
    }));
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
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/settings`, expect.objectContaining({
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer auth-token',
      },
      body: JSON.stringify(updatedSettings),
    }));
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
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/hazard-reports`, expect.objectContaining({
      headers: { Authorization: 'Bearer auth-token' },
    }));
  });

  it('passes a page size through when fetching hazard reports', async () => {
    client.setToken('auth-token');
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] } as any);

    await client.getHazardReports(10);
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/v1/hazard-reports?take=10`, expect.objectContaining({ headers: { Authorization: 'Bearer auth-token' } }));
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
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/hazard-reports`, expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer auth-token',
      },
      body: JSON.stringify(newReport),
    }));
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
      `${baseUrl}/api/v1/hazard-reports/2/confirm`, expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer auth-token' } }));
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
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/ai/fake-call-script`, expect.objectContaining({
      headers: { Authorization: 'Bearer auth-token' },
    }));
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
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/ai/self-defense-tips`, expect.objectContaining({
      headers: { Authorization: 'Bearer auth-token' },
    }));
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
    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/ai/safety-chat`, expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer auth-token',
      },
      body: JSON.stringify({ message: 'Is this area safe?', history: [] }),
    }));
  });

  describe('incident history', () => {
    it('asks for a page with only the options given, and the login (never an emergency token)', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ incidents: [], nextCursor: null }) });
      client.setToken('login');
      await client.listIncidents({ limit: 20, cursor: 'abc', mode: 'practice' });
      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/incidents?limit=20&cursor=abc&mode=practice`, expect.objectContaining({ headers: { Authorization: 'Bearer login' } }));
      await client.listIncidents();
      expect((global.fetch as any).mock.calls[1][0]).toBe(`${baseUrl}/api/v1/incidents`);
    });
    it('viewing a timeline is not an export; asking for the download form is', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ incident: {}, entries: [] }) });
      await client.getIncidentTimeline('i 1');
      expect((global.fetch as any).mock.calls[0][0]).toBe(`${baseUrl}/api/v1/incidents/i%201/timeline`);
      await client.getIncidentTimeline('i1', true);
      expect((global.fetch as any).mock.calls[1][0]).toBe(`${baseUrl}/api/v1/incidents/i1/timeline?format=json`);
    });
  });

  describe('offline SOS', () => {
    it('flags a "too long ago" refusal so a device can tell it from any other 400', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({ message: 'Too long ago. Nothing was sent.', tooLate: true }) });
      await expect(client.raiseSos('k-12345678', { triggerType: 'manual', triggeredAt: 'x', elapsedSeconds: 99999 })).rejects.toMatchObject({ kind: 'http', status: 400, tooLate: true });
    });
    it('does not flag any other refusal as too late', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({ message: 'bad' }) });
      await expect(client.raiseSos('k-12345678', { triggerType: 'manual', triggeredAt: 'x' })).rejects.toMatchObject({ tooLate: false });
    });
    it('cancels by key with the key as the Idempotency-Key header, and an explicit bearer wins', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'i', state: 'CANCELLED' }) });
      client.setToken('login');
      await client.cancelSosByKey('k-12345678', 'emergency');
      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/sos/cancel`, expect.objectContaining({ method: 'POST', headers: { 'Idempotency-Key': 'k-12345678', Authorization: 'Bearer emergency' } }));
    });
  });

  describe('journey links', () => {
    it('mints a link with the options given and returns the path once', async () => {
      const made = { id: 'l1', path: '/j/tok', expiresAt: '2026-01-01T00:00:00Z', hasPin: true, sentByLumo: false };
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(made) });
      client.setToken('t');
      expect(await client.createJourneyLink('j 1', { pin: '1234' })).toEqual(made);
      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/safety-sessions/j%201/links`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ pin: '1234' }) }));
    });

    it('lists links for one journey', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
      expect(await client.listJourneyLinks('j1')).toEqual([]);
      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/safety-sessions/j1/links`, expect.anything());
    });

    it('revokes with DELETE and reads no body (the server answers 204)', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204, json: () => Promise.reject(new Error('no body')) });
      await expect(client.revokeJourneyLink('j1', 'l1')).resolves.toBeUndefined();
      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/safety-sessions/j1/links/l1`, expect.objectContaining({ method: 'DELETE' }));
    });

    it('surfaces a refusal (409: too many links) as an http error with the server words', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: () => Promise.resolve({ message: 'This journey already has several links. Revoke one first.' }) });
      await expect(client.createJourneyLink('j1')).rejects.toMatchObject({ kind: 'http', status: 409, message: 'This journey already has several links. Revoke one first.' });
    });
  });

  describe('failure kinds', () => {
    it('carries the HTTP status so a caller can tell a rejected credential from an outage', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      } as any);

      const err = await client.getSettings().catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ kind: 'http', status: 401, isUnauthorized: true });
    });

    it('does not treat a 5xx as a rejected credential', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ message: 'Unavailable' }),
      } as any);

      const err = await client.getSettings().catch((e) => e);
      expect(err).toMatchObject({ kind: 'http', status: 503, isUnauthorized: false });
    });

    it('reports a network failure without a status and never as unauthorized', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Network request failed'));

      const err = await client.getSettings().catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ kind: 'network', status: null, isUnauthorized: false });
    });

    it('sends an abort signal with every request', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as any);

      await client.getSettings();
      const init = (global.fetch as any).mock.calls[0][1];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('timeout', () => {
    // A fetch that never answers, and rejects only when it is aborted: the
    // behaviour of a real request on a dead connection.
    const hangingFetch = () =>
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
      );

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('gives up on a request that never answers', async () => {
      global.fetch = hangingFetch() as any;
      const failure = client.getSettings().catch((e) => e);

      await vi.advanceTimersByTimeAsync(10_000);

      const err = await failure;
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ kind: 'timeout', status: null, isUnauthorized: false });
    });

    it('honours a custom ceiling', async () => {
      const quick = new ApiClient(baseUrl, null, { timeoutMs: 500 });
      global.fetch = hangingFetch() as any;
      const failure = quick.getSettings().catch((e) => e);

      await vi.advanceTimersByTimeAsync(500);

      expect(await failure).toMatchObject({ kind: 'timeout' });
    });

    it('does not time out a request that answers in time', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: 1 }) } as any);
      await expect(client.getSettings()).resolves.toEqual({ ok: 1 });
      // The timer must be cleared, or it fires later against a finished request.
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
