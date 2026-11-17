import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  apply,
  ATTEMPT_MACHINE,
  CHANNEL_CAPABILITIES,
  initialSnapshot,
  type Actor,
  type AttemptEvent,
  type AttemptState,
  type Channel,
  type DeliveredEvidence,
  type Rejection,
} from '@lumo/safety-domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The ONLY writer of NotificationAttempt state (docs/specs/NOTIFICATIONS.md).
 *
 * In one transaction it locks the attempt row, asks the state machine whether the
 * transition is legal for THIS channel, appends the NotificationEvent and updates the
 * materialised state. Nothing else — no controller, adapter or job — changes `state`,
 * which is what lets the ledger be evidence: every state on every row has an event
 * behind it, and the machine's channel guards decided it.
 *
 * A refused transition changes nothing and is RETURNED, not thrown: a provider
 * callback that arrives twice, or late, is normal, and must not turn into a retry
 * storm or an error page.
 *
 * Nothing here logs a number, a message or a coordinate: attempts are named by id.
 */

export type Tx = Prisma.TransactionClient;

export interface Step {
  readonly event: AttemptEvent;
  readonly by: Actor;
  /** Why. Becomes the event's reason; never a message body or a number. */
  readonly reason?: string;
  /** Who is vouching, for RECEIPT_DELIVERED. The machine rejects the wrong source. */
  readonly evidence?: Exclude<DeliveredEvidence, 'none'>;
  /** Skip this step (without error) unless the attempt is in this state. */
  readonly onlyFrom?: AttemptState;
  readonly providerMessageId?: string;
  readonly providerStatus?: string;
}

export type Applied = {
  readonly applied: true;
  readonly from: AttemptState;
  readonly to: AttemptState;
  readonly effects: readonly string[];
  readonly steps: number;
};
export type NotApplied =
  | { readonly applied: false; readonly why: 'NOT_FOUND' }
  | { readonly applied: false; readonly why: Rejection; readonly state: AttemptState; readonly event: AttemptEvent };
export type LedgerResult = Applied | NotApplied;

const STAMP: Partial<Record<AttemptState, 'sentAt' | 'deliveredAt' | 'acknowledgedAt' | 'failedAt'>> = {
  SENT: 'sentAt',
  DELIVERED: 'deliveredAt',
  ACKNOWLEDGED: 'acknowledgedAt',
  FAILED: 'failedAt',
};

@Injectable()
export class LedgerService {
  private readonly logger = new Logger('Ledger');
  /** Counts only; no identifiers of people. Replaced by real metrics in 1.15. */
  readonly counters = new Map<string, number>();

  private readonly listeners: ((attemptId: string, result: Applied) => Promise<void>)[] = [];

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Told AFTER an attempt's state changed and its transaction committed (never for a caller that
   * supplied its own transaction: that caller recomputes itself). The incident rollup listens here.
   * A listener failing is logged and never undoes or blocks the ledger write.
   */
  onApplied(listener: (attemptId: string, result: Applied) => Promise<void>) {
    this.listeners.push(listener);
  }

  private count(name: string) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
  }

  /**
   * Record a provider's status on the attempt WITHOUT changing its state — e.g. that a call was
   * answered. It is a fact about the attempt, not a transition; no event is written because
   * no state changed. Never lowers anything: it only sets the text.
   */
  async recordProviderStatus(attemptId: string, providerStatus: string): Promise<void> {
    await this.prisma.notificationAttempt.updateMany({ where: { id: attemptId }, data: { providerStatus } });
  }

  /** Apply one or more steps atomically. A refused step stops the run; earlier steps stand. */
  async apply(attemptId: string, steps: readonly Step[], now: Date = new Date(), tx?: Tx): Promise<LedgerResult> {
    if (tx) return this.run(tx, attemptId, steps, now);
    const result = await this.prisma.$transaction(t => this.run(t, attemptId, steps, now));
    if (result.applied) {
      for (const listener of this.listeners) {
        await listener(attemptId, result).catch(() => this.count('listener.failed'));
      }
    }
    return result;
  }

  private async run(tx: Tx, attemptId: string, steps: readonly Step[], now: Date): Promise<LedgerResult> {
    // Lock the row: two callbacks for one attempt must be applied one after the other.
    const rows = await tx.$queryRaw<{ state: AttemptState; channel: Channel }[]>`
      SELECT "state", "channel" FROM "NotificationAttempt" WHERE "id" = ${attemptId} FOR UPDATE`;
    if (rows.length === 0) return { applied: false, why: 'NOT_FOUND' };

    const capability = CHANNEL_CAPABILITIES[rows[0].channel];
    const first = rows[0].state;
    let state = first;
    const effects: string[] = [];
    let done = 0;

    for (const step of steps) {
      if (step.onlyFrom !== undefined && step.onlyFrom !== state) continue;

      const out = apply(
        ATTEMPT_MACHINE,
        initialSnapshot(state),
        step.event,
        { at: now.getTime(), by: step.by, reason: step.reason ?? null },
        { capability, evidence: step.evidence },
      );
      if (!out.ok) {
        // Counted, never logged with detail: a late or duplicate callback is routine.
        this.count(`rejected.${out.rejection}.${step.event}`);
        if (done === 0) return { applied: false, why: out.rejection, state, event: step.event };
        break;
      }

      const to = out.snapshot.state;
      await tx.notificationEvent.create({
        data: { attemptId, toState: to, reason: step.reason ?? null, occurredAt: now },
      });
      const stamp = STAMP[to];
      await tx.notificationAttempt.update({
        where: { id: attemptId },
        data: {
          state: to,
          stateReason: step.reason ?? null,
          ...(stamp ? { [stamp]: now } : {}),
          ...(step.providerMessageId !== undefined ? { providerMessageId: step.providerMessageId } : {}),
          ...(step.providerStatus !== undefined ? { providerStatus: step.providerStatus } : {}),
        },
      });
      effects.push(...out.record.effects);
      state = to;
      done += 1;
    }

    if (done === 0) return { applied: false, why: 'ILLEGAL_TRANSITION', state, event: steps[0]?.event ?? 'TTL_ELAPSED' };
    this.count(`applied.${state}`);
    return { applied: true, from: first, to: state, effects, steps: done };
  }
}
