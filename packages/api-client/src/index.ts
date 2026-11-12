import { UserSettings, HazardReport, CreateHazardReportInput, FakeCallScript, PersonalInfo } from '@lumo/types';

export interface AuthResponse {
  user: PersonalInfo;
  token: string;
}

export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string, token: string | null = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private getHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'An unknown error occurred' }));
      throw new Error(error.message || `HTTP error! status: ${response.status}`);
    }
    return response.json();
  }

  // Authentication
  async login(email: string, password: string): Promise<AuthResponse> {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await this.handleResponse<AuthResponse>(response);
    if (data.token) {
      this.setToken(data.token);
    }
    return data;
  }

  async signup(name: string, email: string, password: string): Promise<AuthResponse> {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: name, name, email, password }),
    });
    const data = await this.handleResponse<AuthResponse>(response);
    if (data.token) {
      this.setToken(data.token);
    }
    return data;
  }

  // Settings
  async getSettings(): Promise<UserSettings> {
    const response = await fetch(`${this.baseUrl}/api/v1/settings`, {
      headers: this.getHeaders(),
    });
    return this.handleResponse(response);
  }

  async updateSettings(settings: UserSettings): Promise<UserSettings> {
    const response = await fetch(`${this.baseUrl}/api/v1/settings`, {
      method: 'PUT',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(settings),
    });
    return this.handleResponse(response);
  }

  // Hazard reports
  async getHazardReports(take?: number): Promise<HazardReport[]> {
    const query = take === undefined ? '' : `?take=${take}`;
    const response = await fetch(`${this.baseUrl}/api/v1/hazard-reports${query}`, {
      headers: this.getHeaders(),
    });
    return this.handleResponse(response);
  }

  async reportHazard(details: CreateHazardReportInput): Promise<HazardReport> {
    const response = await fetch(`${this.baseUrl}/api/v1/hazard-reports`, {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(details),
    });
    return this.handleResponse(response);
  }

  async confirmHazardReport(id: string): Promise<HazardReport> {
    const response = await fetch(`${this.baseUrl}/api/v1/hazard-reports/${id}/confirm`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return this.handleResponse(response);
  }

  // AI Services
  async getFakeCallScript(): Promise<FakeCallScript> {
    const response = await fetch(`${this.baseUrl}/api/v1/ai/fake-call-script`, {
      headers: this.getHeaders(),
    });
    return this.handleResponse(response);
  }

  async getSelfDefenseTips(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/ai/self-defense-tips`, {
      headers: this.getHeaders(),
    });
    return this.handleResponse(response);
  }

  async safetyChat(message: string, history: Array<{ role: string; parts: Array<{ text: string }> }> = []): Promise<{ response: string }> {
    const response = await fetch(`${this.baseUrl}/api/v1/ai/safety-chat`, {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message, history }),
    });
    return this.handleResponse(response);
  }
}
