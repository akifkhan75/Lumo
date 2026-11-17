import { UserSettings, HazardReport, CreateHazardReportInput, FakeCallScript, PersonalInfo, ContactInvite, Incident, RaiseSosInput, EmergencyToken, Journey, CreateJourneyInput, JourneyFix, JourneyLinkInfo, CreateJourneyLinkInput, CreatedJourneyLink } from '@lumo/types';

export interface AuthResponse {
  user: PersonalInfo;
  token: string;
}

/**
 * Why a request failed, so a caller can react to the cause and not just the
 * message.
 *
 * - `http`    the server answered with a non-2xx status; `status` is set.
 * - `timeout` no answer within `timeoutMs`; `status` is `null`.
 * - `network` the request never completed (offline, DNS, refused); `status` is `null`.
 *
 * Only an `http` failure with status 401 means the credential itself was
 * rejected. A timeout or a network error says nothing about the token, and a
 * caller that treats them as a rejected token will sign someone out because
 * their signal dropped.
 */
export type ApiErrorKind = 'http' | 'timeout' | 'network';

export class ApiError extends Error {
  readonly status: number | null;
  readonly kind: ApiErrorKind;

  constructor(message: string, kind: ApiErrorKind, status: number | null = null) {
    super(message);
    // Restores the prototype chain. This package compiles to ES5 (the shared
    // tsconfig sets no target), and ES5 output of a class extending Error loses
    // it: `instanceof ApiError` is false and `isUnauthorized` does not exist.
    // The unit tests run against the TypeScript source and never saw this; the
    // compiled build that the app actually loads did.
    Object.setPrototypeOf(this, ApiError.prototype);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }

  /** True only when the server explicitly rejected the credential. */
  get isUnauthorized(): boolean {
    return this.kind === 'http' && this.status === 401;
  }
}

export interface ApiClientOptions {
  /** Per-request ceiling in milliseconds. Defaults to 10 000. */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 10_000;

export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private timeoutMs: number;

  constructor(baseUrl: string, token: string | null = null, options: ApiClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private getHeaders(extraHeaders: Record<string, string> = {}, bearer: string | null | undefined = undefined): Record<string, string> {
    const headers: Record<string, string> = { ...extraHeaders };
    // An explicit bearer (the emergency token) wins over the stored login.
    const token = bearer === undefined ? this.token : bearer;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'An unknown error occurred' }));
      throw new ApiError(
        error.message || `HTTP error! status: ${response.status}`,
        'http',
        response.status,
      );
    }
    return response.json();
  }

  /**
   * One request, bounded in time. The timer covers reading the body as well as
   * receiving the headers: a server that sends headers and then stalls would
   * otherwise hang the caller exactly as a silent one does.
   *
   * There was no timeout at all before, so a hung request left the dashboard
   * on a spinner indefinitely (KI-27).
   */
  private async send<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
      return await this.handleResponse<T>(response);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (controller.signal.aborted) {
        throw new ApiError(`The request timed out after ${this.timeoutMs} ms`, 'timeout');
      }
      throw new ApiError(err instanceof Error ? err.message : 'Network request failed', 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  /** For endpoints that answer 204: the same bounded request, no body to read. */
  private async sendNoBody(path: string, init: RequestInit = {}): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'An unknown error occurred' }));
        throw new ApiError(error.message || `HTTP error! status: ${response.status}`, 'http', response.status);
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (controller.signal.aborted) throw new ApiError(`The request timed out after ${this.timeoutMs} ms`, 'timeout');
      throw new ApiError(err instanceof Error ? err.message : 'Network request failed', 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  // Authentication
  async login(email: string, password: string): Promise<AuthResponse> {
    const data = await this.send<AuthResponse>('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (data.token) {
      this.setToken(data.token);
    }
    return data;
  }

  async signup(name: string, email: string, password: string): Promise<AuthResponse> {
    const data = await this.send<AuthResponse>('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: name, name, email, password }),
    });
    if (data.token) {
      this.setToken(data.token);
    }
    return data;
  }

  // Incidents (docs/specs/INCIDENTS.md). `bearer` lets the caller use the emergency token, which is
  // what keeps an SOS from depending on the login being valid.
  async raiseSos(key: string, input: RaiseSosInput, bearer?: string | null): Promise<{ incident: Incident }> {
    const body = await this.send<Incident & { __status?: number }>('/api/v1/sos', {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json', 'Idempotency-Key': key }, bearer),
      body: JSON.stringify(input),
    });
    return { incident: body };
  }

  async getIncident(id: string, bearer?: string | null): Promise<Incident> {
    return this.send(`/api/v1/incidents/${encodeURIComponent(id)}`, { headers: this.getHeaders({}, bearer) });
  }

  async cancelIncident(id: string, bearer?: string | null): Promise<Incident> {
    return this.send(`/api/v1/incidents/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: this.getHeaders({}, bearer) });
  }

  async resolveIncident(id: string, bearer?: string | null): Promise<Incident> {
    return this.send(`/api/v1/incidents/${encodeURIComponent(id)}/resolve`, { method: 'POST', headers: this.getHeaders({}, bearer) });
  }

  // Journeys (docs/specs/JOURNEYS.md). Login only: the emergency token cannot touch them.
  async createJourney(input: CreateJourneyInput): Promise<Journey> {
    return this.send('/api/v1/safety-sessions', { method: 'POST', headers: this.getHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(input) });
  }

  async getActiveJourney(): Promise<Journey | null> {
    const r = await this.send<{ session: Journey | null }>('/api/v1/safety-sessions/active', { headers: this.getHeaders() });
    return r.session;
  }

  async checkInJourney(id: string, expectedArrivalAt: string): Promise<Journey> {
    return this.send(`/api/v1/safety-sessions/${encodeURIComponent(id)}/check-in`, {
      method: 'POST', headers: this.getHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expectedArrivalAt }),
    });
  }

  async arriveJourney(id: string): Promise<Journey> {
    return this.send(`/api/v1/safety-sessions/${encodeURIComponent(id)}/arrive`, { method: 'POST', headers: this.getHeaders() });
  }

  async cancelJourney(id: string): Promise<Journey> {
    return this.send(`/api/v1/safety-sessions/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: this.getHeaders() });
  }

  async postJourneyLocation(id: string, snapshots: JourneyFix[]): Promise<{ stored: number; duplicates: number; atDestination: boolean; arrived: boolean }> {
    return this.send(`/api/v1/safety-sessions/${encodeURIComponent(id)}/location`, {
      method: 'POST', headers: this.getHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ snapshots }),
    });
  }

  // Journey links: who could be looking. The token comes back once, at creation (docs/engineering/WEB.md). Login only.
  async createJourneyLink(journeyId: string, input: CreateJourneyLinkInput = {}): Promise<CreatedJourneyLink> {
    return this.send(`/api/v1/safety-sessions/${encodeURIComponent(journeyId)}/links`, {
      method: 'POST', headers: this.getHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(input),
    });
  }

  async listJourneyLinks(journeyId: string): Promise<JourneyLinkInfo[]> {
    return this.send(`/api/v1/safety-sessions/${encodeURIComponent(journeyId)}/links`, { headers: this.getHeaders() });
  }

  async revokeJourneyLink(journeyId: string, linkId: string): Promise<void> {
    await this.sendNoBody(`/api/v1/safety-sessions/${encodeURIComponent(journeyId)}/links/${encodeURIComponent(linkId)}`, { method: 'DELETE', headers: this.getHeaders() });
  }

  // The contact side: a push address, joining as someone's contact, and the device's own report back.
  async registerDevice(input: { platform: 'ios' | 'android'; osVersion: string; pushToken: string }): Promise<{ id: string }> {
    return this.send('/api/v1/devices', {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(input),
    });
  }

  async revokeDevice(id: string): Promise<void> {
    await this.sendNoBody(`/api/v1/devices/${encodeURIComponent(id)}`, { method: 'DELETE', headers: this.getHeaders() });
  }

  /** Claim a contact link while signed in; this is what gives a contact a push address. */
  async claimContactInvite(token: string): Promise<{ claimed: boolean }> {
    return this.send(`/api/v1/contacts/invites/${encodeURIComponent(token)}/claim`, { method: 'POST', headers: this.getHeaders() });
  }

  /** The device reports an alert it actually received, or the contact's "I'm responding". */
  async postNotificationReceipt(attemptId: string, kind: 'delivered' | 'acknowledged'): Promise<{ recorded: boolean }> {
    return this.send(`/api/v1/notifications/${encodeURIComponent(attemptId)}/receipt`, {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ kind }),
    });
  }

  async mintEmergencyToken(deviceKey: string): Promise<EmergencyToken> {
    return this.send('/api/v1/emergency-token', {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ deviceKey }),
    });
  }

  // Settings
  async getSettings(): Promise<UserSettings> {
    return this.send('/api/v1/settings', { headers: this.getHeaders() });
  }

  async createContactInvite(contactId: string): Promise<ContactInvite> {
    return this.send(`/api/v1/trusted-contacts/${encodeURIComponent(contactId)}/invite`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
  }

  async updateSettings(settings: UserSettings): Promise<UserSettings> {
    return this.send('/api/v1/settings', {
      method: 'PUT',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      // consentStatus is read-only and set by the server; never send it back.
      body: JSON.stringify({
        ...settings,
        trustedContacts: settings.trustedContacts?.map(({ consentStatus: _status, ...contact }) => contact),
      }),
    });
  }

  // Hazard reports
  async getHazardReports(take?: number): Promise<HazardReport[]> {
    const query = take === undefined ? '' : `?take=${take}`;
    return this.send(`/api/v1/hazard-reports${query}`, { headers: this.getHeaders() });
  }

  async reportHazard(details: CreateHazardReportInput): Promise<HazardReport> {
    return this.send('/api/v1/hazard-reports', {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(details),
    });
  }

  async confirmHazardReport(id: string): Promise<HazardReport> {
    return this.send(`/api/v1/hazard-reports/${id}/confirm`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
  }

  // AI Services
  async getFakeCallScript(): Promise<FakeCallScript> {
    return this.send('/api/v1/ai/fake-call-script', { headers: this.getHeaders() });
  }

  async getSelfDefenseTips(): Promise<string[]> {
    return this.send('/api/v1/ai/self-defense-tips', { headers: this.getHeaders() });
  }

  async safetyChat(message: string, history: Array<{ role: string; parts: Array<{ text: string }> }> = []): Promise<{ response: string }> {
    return this.send('/api/v1/ai/safety-chat', {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message, history }),
    });
  }
}
