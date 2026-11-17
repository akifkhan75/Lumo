/** What the worker needs from a voice provider. As with SMS, the ledger decides what anything MEANS. */

export const VOICE_PROVIDER = 'VOICE_PROVIDER';

export type VoiceOutcome =
  /** The provider accepted the request to place a call. NOT "answered". */
  | { readonly kind: 'accepted'; readonly providerMessageId: string; readonly status: string }
  | { readonly kind: 'rejected'; readonly reason: string }
  /** No answer from the provider: the call may or may not have been placed. */
  | { readonly kind: 'ambiguous' };

export interface VoiceProvider {
  /** False without credentials AND a caller number: a messaging service cannot place a call. */
  configured(): boolean;
  call(request: { to: string; script: string; attemptId: string }): Promise<VoiceOutcome>;
}
