import { maxState, type AttemptState, type ChannelCapability, type DeliveredEvidence } from './capabilities';
import { rowsFrom, type Machine, type Row } from './machine';
import { ATTEMPT_STATES } from './capabilities';

/**
 * NotificationAttempt — one per recipient per channel; the unit of truth behind
 * the Delivery Ledger (docs/specs/DELIVERY_LEDGER.md, SAFETY_STATE_MACHINES.md §6a).
 *
 * Every guard that matters here is a CHANNEL guard: a transition above what the
 * channel can truthfully report is rejected, which is what makes the ledger
 * structurally honest.
 */

export const ATTEMPT_EVENTS = [
  'PROVIDER_ACCEPTED',
  'PROVIDER_REJECTED',
  'TTL_ELAPSED',
  'SPEND_CAP_REACHED',
  'RECEIPT_DELIVERED',
  'ACK',
  'CHANNEL_CANNOT_REPORT',
] as const;
export type AttemptEvent = (typeof ATTEMPT_EVENTS)[number];

export interface AttemptContext {
  /** The channel's capability. Passed in so a region profile can narrow it. */
  readonly capability: ChannelCapability;
  /**
   * Who is reporting a delivery. Only read for RECEIPT_DELIVERED. A provider
   * receipt on a channel whose delivery must be vouched for by the device is
   * rejected — see DeliveredEvidence.
   */
  readonly evidence?: Exclude<DeliveredEvidence, 'none'>;
}

const canReportDelivered = (c: AttemptContext) =>
  c.capability.automaticCeiling === 'DELIVERED' &&
  c.evidence !== undefined &&
  c.evidence === c.capability.deliveredEvidence;

const canBeAcknowledged = (c: AttemptContext) => c.capability.humanAck;

// A channel that stops at SENT cannot report further. SMS can also reach this
// state at runtime: its receipts are provider-dependent, so the provider may tell
// us this particular destination has none.
const cannotReport = (c: AttemptContext) =>
  c.capability.automaticCeiling === 'SENT' || c.capability.receipts === 'provider-dependent';

const mayReachBeyondSent = (c: AttemptContext) => maxState(c.capability) !== 'SENT';

const rows: Row<AttemptState, AttemptEvent, AttemptContext>[] = [
  ...rowsFrom<AttemptState, AttemptEvent, AttemptContext>('QUEUED', 'PROVIDER_ACCEPTED', 'SENT', ['system']),
  ...rowsFrom<AttemptState, AttemptEvent, AttemptContext>('QUEUED', 'PROVIDER_REJECTED', 'FAILED', ['system'], {
    effects: ['triggerFallback'],
  }),
  ...rowsFrom<AttemptState, AttemptEvent, AttemptContext>('QUEUED', 'TTL_ELAPSED', 'EXPIRED', ['system'], {
    effects: ['triggerFallback'],
  }),
  // A cap hit is surfaced to the user, never silently truncated (PLAT-5).
  ...rowsFrom<AttemptState, AttemptEvent, AttemptContext>('QUEUED', 'SPEND_CAP_REACHED', 'FAILED', ['system', 'policy'], {
    effects: ['recordReasonSpendCap', 'notifyUserSpendCap'],
  }),
  ...rowsFrom<AttemptState, AttemptEvent, AttemptContext>('SENT', 'RECEIPT_DELIVERED', 'DELIVERED', ['system', 'contact'], {
    guard: canReportDelivered,
  }),
  // An acknowledgement may arrive before any delivery receipt.
  ...rowsFrom<AttemptState, AttemptEvent, AttemptContext>(['SENT', 'DELIVERED'], 'ACK', 'ACKNOWLEDGED', ['contact'], {
    guard: canBeAcknowledged,
    effects: ['haltEscalation'],
  }),
  ...rowsFrom<AttemptState, AttemptEvent, AttemptContext>('SENT', 'CHANNEL_CANNOT_REPORT', 'UNKNOWN', ['system'], {
    guard: cannotReport,
  }),
  // The two rows below share (SENT, TTL_ELAPSED) and differ only by guard.
  ...rowsFrom<AttemptState, AttemptEvent, AttemptContext>('SENT', 'TTL_ELAPSED', 'EXPIRED', ['system'], {
    guard: mayReachBeyondSent,
    effects: ['triggerFallback'],
  }),
  ...rowsFrom<AttemptState, AttemptEvent, AttemptContext>('SENT', 'TTL_ELAPSED', 'UNKNOWN', ['system'], {
    guard: (c) => !mayReachBeyondSent(c),
  }),
];

export const ATTEMPT_MACHINE: Machine<AttemptState, AttemptEvent, AttemptContext> = {
  name: 'NotificationAttempt',
  states: ATTEMPT_STATES,
  events: ATTEMPT_EVENTS,
  rows,
  rememberPriorOn: [],
};

/**
 * Terminal means no further transition is possible on this channel.
 * DELIVERED is terminal only where nobody can acknowledge through the channel.
 */
export function isAttemptTerminal(state: AttemptState, capability: ChannelCapability): boolean {
  switch (state) {
    case 'ACKNOWLEDGED':
    case 'FAILED':
    case 'EXPIRED':
    case 'UNKNOWN':
      return true;
    case 'DELIVERED':
      return !capability.humanAck;
    default:
      return false; // QUEUED, SENT
  }
}

/** How an attempt counts toward the incident rollup. */
export type AttemptStanding = 'acknowledged' | 'reached' | 'pending' | 'failed';

/**
 * - `acknowledged` — a human said they are responding.
 * - `reached`      — the message left the system and settled as far as this
 *   channel can ever tell us. Includes UNKNOWN: an unconfirmed message is still
 *   a message that went out, and the copy says "sent", never "delivered".
 * - `pending`      — still in flight, or waiting on a receipt that can still come.
 * - `failed`       — FAILED or EXPIRED. Never success.
 */
export function attemptStanding(state: AttemptState, capability: ChannelCapability): AttemptStanding {
  switch (state) {
    case 'ACKNOWLEDGED':
      return 'acknowledged';
    case 'DELIVERED':
    case 'UNKNOWN':
      return 'reached';
    case 'SENT':
      // At its ceiling only if this channel can never report more than SENT.
      return capability.automaticCeiling === 'SENT' ? 'reached' : 'pending';
    case 'FAILED':
    case 'EXPIRED':
      return 'failed';
    default:
      return 'pending'; // QUEUED
  }
}
