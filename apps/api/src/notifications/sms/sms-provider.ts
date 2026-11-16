/**
 * What the worker needs from an SMS provider. Small on purpose: the ledger decides what
 * anything MEANS; the provider only says what happened to the request.
 */

export const SMS_PROVIDER = 'SMS_PROVIDER';

export type SmsOutcome =
  /** The provider accepted the request and gave it an id. NOT "delivered". */
  | { readonly kind: 'accepted'; readonly providerMessageId: string; readonly status: string }
  /** The provider ANSWERED and refused. Definitely not accepted. */
  | { readonly kind: 'rejected'; readonly reason: string }
  /**
   * No answer (timeout, dropped connection). The message may or may not have gone, so
   * nothing may be recorded and nothing may be re-sent: see "At most once".
   */
  | { readonly kind: 'ambiguous' };

export interface SmsProvider {
  /** False when credentials are missing. An unconfigured provider is never "accepted". */
  configured(): boolean;
  send(request: { to: string; body: string; attemptId: string }): Promise<SmsOutcome>;
}
