import type { PushOutcome, PushProvider, PushReceipt } from './push-provider';

/**
 * Expo Push Service (docs/specs/NOTIFICATIONS.md). Built to Expo's documented API (fetched,
 * not recalled); NEVER run against the real service.
 *
 * What the service tells us is WEAK, and the ledger treats it that way:
 *   - a TICKET with status ok = Expo accepted the message;
 *   - a RECEIPT with status ok = FCM or APNs accepted it from Expo. Expo's own docs: "this doesn't
 *     guarantee that the device has received the message".
 * Neither is DELIVERED. Only the device can say that (the receipt endpoint).
 *
 * Configuration: EXPO_PUSH_ENABLED=true (explicit, so a development machine never pushes by
 * accident), and optionally EXPO_ACCESS_TOKEN if the project requires an authenticated sender.
 */

export const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const TIMEOUT_MS = 10_000;

export interface ExpoConfig {
  readonly accessToken?: string;
}

export function getExpoConfig(env: NodeJS.ProcessEnv = process.env): ExpoConfig | null {
  if ((env.EXPO_PUSH_ENABLED ?? '').toLowerCase() !== 'true') return null;
  return { accessToken: env.EXPO_ACCESS_TOKEN?.trim() || undefined };
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class ExpoPush implements PushProvider {
  constructor(
    private readonly config: ExpoConfig | null = getExpoConfig(),
    private readonly fetchFn: Fetch = fetch as unknown as Fetch,
  ) {}

  configured(): boolean {
    return this.config !== null;
  }

  private async post(url: string, payload: unknown): Promise<{ status: number; body: unknown } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(this.config?.accessToken ? { Authorization: `Bearer ${this.config.accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    } catch {
      return null; // no answer: timeout, reset, DNS
    } finally {
      clearTimeout(timer);
    }
  }

  async send({ tokens, title, body, attemptId }: { tokens: readonly string[]; title: string; body: string; attemptId: string }): Promise<PushOutcome> {
    if (!this.config) return { kind: 'rejected', reason: 'PROVIDER_NOT_CONFIGURED', deadTokens: [] };
    // Ids and the sender's name only: this crosses third parties and shows on a lock screen.
    const messages = tokens.map(to => ({ to, title, body, data: { attemptId }, sound: 'default', priority: 'high' }));
    const res = await this.post(EXPO_SEND_URL, messages);
    if (res === null) return { kind: 'ambiguous' };
    if (res.status < 200 || res.status >= 300) return { kind: 'rejected', reason: `HTTP_${res.status}`, deadTokens: [] };

    const data = (res.body as { data?: unknown } | null)?.data;
    if (!Array.isArray(data) || data.length !== tokens.length) {
      // A 2xx we cannot read: the service may have accepted them. Not a rejection.
      return { kind: 'ambiguous' };
    }
    const tickets: { token: string; id: string }[] = [];
    const deadTokens: string[] = [];
    let firstError = 'EXPO_ERROR';
    data.forEach((t: { status?: string; id?: string; details?: { error?: string } }, i) => {
      if (t?.status === 'ok' && typeof t.id === 'string') tickets.push({ token: tokens[i], id: t.id });
      else {
        const err = t?.details?.error;
        if (err === 'DeviceNotRegistered') deadTokens.push(tokens[i]);
        if (firstError === 'EXPO_ERROR' && err) firstError = `EXPO_${err}`;
      }
    });
    return tickets.length > 0 ? { kind: 'accepted', tickets, deadTokens } : { kind: 'rejected', reason: firstError, deadTokens };
  }

  async receipts(ids: readonly string[]): Promise<ReadonlyMap<string, PushReceipt> | null> {
    if (!this.config || ids.length === 0) return null;
    const res = await this.post(EXPO_RECEIPTS_URL, { ids });
    if (res === null || res.status < 200 || res.status >= 300) return null;
    const data = (res.body as { data?: Record<string, { status?: string; details?: { error?: string } }> } | null)?.data;
    if (!data || typeof data !== 'object') return null;
    const out = new Map<string, PushReceipt>();
    for (const [id, r] of Object.entries(data)) {
      if (r?.status === 'ok') out.set(id, { status: 'ok' });
      else if (r?.status === 'error') out.set(id, { status: 'error', error: r.details?.error ?? 'UNKNOWN' });
    }
    return out;
  }
}
