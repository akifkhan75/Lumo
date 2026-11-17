import twilio from 'twilio';
import type { VoiceOutcome, VoiceProvider } from './voice-provider';

/**
 * Twilio voice (docs/specs/NOTIFICATIONS.md). Built to Twilio's documented API; NEVER run
 * against real Twilio (no account).
 *
 * A call needs a CALLER NUMBER (`TWILIO_VOICE_FROM`): unlike SMS, a messaging service SID cannot
 * place one. So voice has its own configuration, and "SMS is configured" says nothing about it.
 * Without the number the provider is "not configured" and attempts are ledgered NOT_ATTEMPTED.
 */

export interface TwilioVoiceConfig {
  readonly accountSid: string;
  readonly authToken: string;
  readonly from: string;
  readonly publicApiUrl: string;
}

export function getTwilioVoiceConfig(env: NodeJS.ProcessEnv = process.env): TwilioVoiceConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const from = env.TWILIO_VOICE_FROM?.trim();
  const publicApiUrl = env.PUBLIC_API_URL?.trim().replace(/\/+$/, '');
  if (!accountSid || !authToken || !from || !publicApiUrl) return null;
  return { accountSid, authToken, from, publicApiUrl };
}

export const voiceCallbackUrl = (publicApiUrl: string, attemptId: string) =>
  `${publicApiUrl}/api/v1/webhooks/twilio/voice-status?attempt=${encodeURIComponent(attemptId)}`;

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** TwiML for the spoken script. The script carries the sender's NAME, which is user-supplied text. */
export function twimlFor(script: string): string {
  return `<Response><Say>${escapeXml(script)}</Say></Response>`;
}

/** Ring for at most this long before treating the call as unanswered. */
export const VOICE_RING_SECONDS = 30;

type CallClient = { calls: { create(p: Record<string, unknown>): Promise<{ sid: string; status: string }> } };

export class TwilioVoice implements VoiceProvider {
  constructor(
    private readonly config: TwilioVoiceConfig | null = getTwilioVoiceConfig(),
    private readonly clientFactory: (c: TwilioVoiceConfig) => CallClient = c => twilio(c.accountSid, c.authToken) as unknown as CallClient,
  ) {}

  configured(): boolean {
    return this.config !== null;
  }

  async call({ to, script, attemptId }: { to: string; script: string; attemptId: string }): Promise<VoiceOutcome> {
    if (!this.config) return { kind: 'rejected', reason: 'PROVIDER_NOT_CONFIGURED' };
    const c = this.config;
    try {
      const call = await this.clientFactory(c).calls.create({
        to,
        from: c.from,
        twiml: twimlFor(script),
        timeout: VOICE_RING_SECONDS,
        statusCallback: voiceCallbackUrl(c.publicApiUrl, attemptId),
        // Twilio sends only `completed` unless asked. "Answered" is recorded as a fact on the
        // attempt; it is never an acknowledgement (a voicemail also "answers").
        statusCallbackEvent: ['answered', 'completed'],
      });
      return { kind: 'accepted', providerMessageId: call.sid, status: call.status };
    } catch (e) {
      const err = e as { status?: number; code?: number };
      if (typeof err.status === 'number') return { kind: 'rejected', reason: err.code ? `TWILIO_${err.code}` : `HTTP_${err.status}` };
      return { kind: 'ambiguous' };
    }
  }
}
