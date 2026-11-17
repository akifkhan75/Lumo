import 'server-only';

/** What the API returns to a link holder. Mirrors `PublicJourney` in apps/api; the API's test pins the exact keys. */
export interface PublicJourney {
  who: string;
  status: { code: 'on_the_way' | 'check_in_due' | 'alert_raised' | 'ended' | 'cancelled'; text: string };
  expectedArrivalAt: string | null;
  location: { latitude: number; longitude: number; accuracyM: number; capturedAt: string } | null;
  asOf: string;
  canRespond: boolean;
  responding: boolean;
}

export type JourneyResult =
  | { kind: 'ok'; journey: PublicJourney }
  | { kind: 'invalid' } // unknown, expired or revoked: one answer, so a token cannot be probed
  | { kind: 'pin_required' }
  | { kind: 'unavailable' }; // the API could not be reached: said plainly, never shown as "no journey"

const base = () => process.env.LUMO_API_URL ?? 'http://localhost:3005';

async function call(path: string, method: 'GET' | 'POST', pin: string | undefined): Promise<JourneyResult> {
  try {
    const res = await fetch(`${base()}/api/v1/j/${path}`, {
      method,
      cache: 'no-store',
      headers: pin ? { 'x-link-pin': pin } : undefined,
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return { kind: 'invalid' };
    if (res.status === 401) return { kind: 'pin_required' };
    if (!res.ok) return { kind: 'unavailable' };
    return { kind: 'ok', journey: (await res.json()) as PublicJourney };
  } catch {
    return { kind: 'unavailable' };
  }
}

const enc = encodeURIComponent;
export const getJourney = (token: string, pin?: string) => call(enc(token), 'GET', pin);
export const respond = (token: string, kind: 'respond' | 'unrespond', pin?: string) => call(`${enc(token)}/${kind}`, 'POST', pin);
