import * as apiService from '../services/apiService';

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('apiService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiService.setAuthToken(null);
  });

  describe('token management', () => {
    it('sets and gets the authentication token', () => {
      expect(apiService.getAuthToken()).toBeNull();
      apiService.setAuthToken('my-token-123');
      expect(apiService.getAuthToken()).toBe('my-token-123');
      apiService.setAuthToken(null);
      expect(apiService.getAuthToken()).toBeNull();
    });
  });

  describe('login', () => {
    it('successfully logs in and stores auth token', async () => {
      const mockResponse = {
        user: { name: 'Alice', email: 'alice@test.com' },
        token: 'auth-jwt-token',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const res = await apiService.login('alice@test.com', 'password123');
      expect(res).toEqual(mockResponse);
      expect(apiService.getAuthToken()).toBe('auth-jwt-token');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/auth/login'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'alice@test.com', password: 'password123' }),
        })
      );
    });

    it('throws error when login fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(apiService.login('bad@test.com', 'wrong')).rejects.toThrow('HTTP error');
    });
  });

  describe('signup', () => {
    it('successfully signs up and sets auth token', async () => {
      const mockResponse = {
        user: { name: 'Bob', email: 'bob@test.com' },
        token: 'new-jwt-token',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const res = await apiService.signup('Bob', 'bob@test.com', 'securepass');
      expect(res).toEqual(mockResponse);
      expect(apiService.getAuthToken()).toBe('new-jwt-token');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/auth/signup'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: 'Bob',
            name: 'Bob',
            email: 'bob@test.com',
            password: 'securepass',
          }),
        })
      );
    });

    it('throws error when signup fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
      });

      await expect(apiService.signup('Bob', 'bob@test.com', 'pass')).rejects.toThrow('HTTP error');
    });
  });

  describe('ApiClient delegated endpoints', () => {
    it('fetches settings using ApiClient', async () => {
      const mockSettings = {
        personalInfo: { name: 'Alice' },
        emergencyContacts: [],
        alertPreferences: { shakeDetection: true },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSettings,
      });

      const settings = await apiService.getSettings();
      expect(settings).toEqual(mockSettings);
    });

    it('updates settings using ApiClient', async () => {
      const newSettings: any = {
        personalInfo: { name: 'Alice Updated' },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => newSettings,
      });

      const updated = await apiService.updateSettings(newSettings);
      expect(updated).toEqual(newSettings);
    });

    it('fetches hazard reports', async () => {
      const mockReports = [
        {
          id: '1',
          type: 'POOR_LIGHTING',
          source: 'COMMUNITY',
          description: 'Streetlight out',
          coordinates: { latitude: 51.5074, longitude: -0.1278, accuracyMetres: 12 },
          confirmationCount: 0,
          influencesRouting: false,
        },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockReports,
      });

      const reports = await apiService.getHazardReports();
      expect(reports).toEqual(mockReports);
    });

    it('reports a hazard with its coordinates', async () => {
      const payload = {
        type: 'POOR_LIGHTING' as const,
        description: 'Streetlight out on the footbridge',
        latitude: 51.5074,
        longitude: -0.1278,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'new-id', ...payload }),
      });

      const result = await apiService.reportHazard(payload);
      expect(result).toHaveProperty('id', 'new-id');
      const [, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(JSON.parse(init.body)).toEqual(payload);
    });

    it('confirms a hazard report', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'report-1', confirmationCount: 2 }),
      });

      const result = await apiService.confirmHazardReport('report-1');
      expect(result).toHaveProperty('confirmationCount', 2);
    });

    it('fetches fake call script', async () => {
      const mockScript = {
        callerName: 'Mom',
        script: ['Come home', 'Dinner is ready'],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockScript,
      });

      const script = await apiService.getFakeCallScript();
      expect(script).toEqual(mockScript);
    });

    it('fetches self defense tips', async () => {
      const mockTips = ['Keep moving', 'Stay in well-lit areas'];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTips,
      });

      const tips = await apiService.getSelfDefenseTips();
      expect(tips).toEqual(mockTips);
    });

    it('sends safety chat message', async () => {
      const mockChat = { response: 'Move towards security guard' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockChat,
      });

      const chat = await apiService.safetyChat('Where to go?');
      expect(chat).toEqual(mockChat);
    });
  });
});
