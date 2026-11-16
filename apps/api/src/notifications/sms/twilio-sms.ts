import twilio from 'twilio';
import type { SmsOutcome, SmsProvider } from './sms-provider';

/**
 * Twilio SMS (docs/specs/NOTIFICATIONS.md). Built to Twilio's documented API and tested
 * against a stub client; NEVER run against real Twilio, because no account exists yet.
 *
 * Configuration, all optional so the API boots without them. If any is missing the
 * provider is "not configured" and every attempt is ledgered NOT_ATTEMPTED — it can never
 * return "accepted" by default.
 *
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 *   TWILIO_MESSAGING_SERVICE_SID  (preferred)  or  TWILIO_FROM (an E.164 number)
 *   PUBLIC_API_URL                where Twilio can reach this API, e.g. https://api.example.com
 *                                 (used for the status callback; the signature check depends on
 *                                 it, so it is NEVER taken from the request's Host header)
 */

export interface TwilioConfig {
  readonly accountSid: string;
  readonly authToken: string;
  readonly messagingServiceSid?: string;
  readonly from?: string;
  readonly publicApiUrl: string;
}

export function getTwilioConfig(env: NodeJS.ProcessEnv = process.env): TwilioConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID?.trim() || undefined;
  const from = env.TWILIO_FROM?.trim() || undefined;
  const publicApiUrl = env.PUBLIC_API_URL?.trim().replace(/\/+$/, '');
  if (!accountSid || !authToken || !publicApiUrl || (!messagingServiceSid && !from)) return null;
  return { accountSid, authToken, messagingServiceSid, from, publicApiUrl };
}

/** The exact URL Twilio is told to call. It is part of what Twilio signs. */
export const statusCallbackUrl = (publicApiUrl: string, attemptId: string) =>
  `${publicApiUrl}/api/v1/webhooks/twilio/status?attempt=${encodeURIComponent(attemptId)}`;

/** How long Twilio may hold a message in its queue before giving up (seconds). */
export const SMS_VALIDITY_SECONDS = 600;

type TwilioClient = { messages: { create(p: Record<string, unknown>): Promise<{ sid: string; status: string }> } };

export class TwilioSms implements SmsProvider {
  constructor(
    private readonly config: TwilioConfig | null = getTwilioConfig(),
    private readonly clientFactory: (c: TwilioConfig) => TwilioClient = c => twilio(c.accountSid, c.authToken) as unknown as TwilioClient,
  ) {}

  configured(): boolean {
    return this.config !== null;
  }

  async send({ to, body, attemptId }: { to: string; body: string; attemptId: string }): Promise<SmsOutcome> {
    if (!this.config) return { kind: 'rejected', reason: 'PROVIDER_NOT_CONFIGURED' }; // callers check first; belt and braces
    const c = this.config;
    try {
      const message = await this.clientFactory(c).messages.create({
        to,
        body,
        ...(c.messagingServiceSid ? { messagingServiceSid: c.messagingServiceSid } : { from: c.from }),
        statusCallback: statusCallbackUrl(c.publicApiUrl, attemptId),
        validityPeriod: SMS_VALIDITY_SECONDS,
      });
      return { kind: 'accepted', providerMessageId: message.sid, status: message.status };
    } catch (e) {
      const err = e as { status?: number; code?: number };
      // An HTTP answer is Twilio refusing the request: definitely not accepted. Anything
      // without one (timeout, reset) is ambiguous. The error text is never kept: it can
      // contain the destination number.
      if (typeof err.status === 'number') {
        return { kind: 'rejected', reason: err.code ? `TWILIO_${err.code}` : `HTTP_${err.status}` };
      }
      return { kind: 'ambiguous' };
    }
  }
}
