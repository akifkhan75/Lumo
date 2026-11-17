/** What the worker needs from a push service. The ledger decides what anything MEANS. */

export const PUSH_PROVIDER = 'PUSH_PROVIDER';

export interface PushTicket {
  readonly token: string;
  /** The service's receipt id. A ticket means the service ACCEPTED it, nothing more. */
  readonly id: string;
}

export type PushOutcome =
  | { readonly kind: 'accepted'; readonly tickets: readonly PushTicket[]; readonly deadTokens: readonly string[] }
  | { readonly kind: 'rejected'; readonly reason: string; readonly deadTokens: readonly string[] }
  | { readonly kind: 'ambiguous' };

export type PushReceipt = { readonly status: 'ok' } | { readonly status: 'error'; readonly error: string };

export interface PushProvider {
  /** False unless explicitly enabled. An unconfigured provider is never "accepted". */
  configured(): boolean;
  send(request: { tokens: readonly string[]; title: string; body: string; attemptId: string }): Promise<PushOutcome>;
  /** Receipts for earlier tickets. Ids with no receipt yet are absent from the result. */
  receipts(ids: readonly string[]): Promise<ReadonlyMap<string, PushReceipt> | null>;
}
