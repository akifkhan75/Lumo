import { Injectable } from '@nestjs/common';
import { rollupIncident, simulatePractice, type Channel, type PracticeRecipient } from '@lumo/safety-domain';
import { EscalationService, type Tx } from '../escalation/escalation.service';
import { SKIP_TO_REASON } from '../notifications/dispatch.service';
import { resolveRecipients } from '../trusted-contacts/recipients';
import { TrustedContactsService } from '../trusted-contacts/trusted-contacts.service';

/**
 * The rehearsal's ledger (docs/specs/PRACTICE_MODE.md).
 *
 * This runs the same RESOLUTION a real incident does (who the policy would try, in order, over which channels, and who may not be tried
 * and why) and then writes a SIMULATED ledger from the pure `simulatePractice`. It touches no queue, no provider, no planner and no
 * `NotificationAttempt`: it writes `PracticeAttempt` rows, which no worker reads, and the database refuses a real attempt for a practice
 * incident in any case. Nothing here can send anything.
 */
@Injectable()
export class PracticeService {
  constructor(
    private readonly escalation: EscalationService,
    private readonly contacts: TrustedContactsService,
  ) {}

  async run(tx: Tx, incidentId: string, userId: string, now: Date): Promise<{ dispatched: number; reached: number; failed: number }> {
    const { policy } = await this.escalation.policyFor(tx, userId, null);
    const { eligible, skipped } = resolveRecipients(await this.contacts.list(tx, userId));
    const eligibleIds = new Set(eligible.map(c => c.id));
    const skippedWhy = new Map(skipped.map(s => [s.contactId, SKIP_TO_REASON[s.reason]]));

    // The order the ladder would try them in; each contact once, with the channels of the first step that names them.
    const recipients: PracticeRecipient[] = [];
    const seen = new Set<string>();
    for (const step of [...policy.steps].sort((a, b) => a.order - b.order)) {
      for (const r of step.recipients) {
        if (r.kind !== 'contact' || seen.has(r.id)) continue;
        seen.add(r.id);
        const known = eligibleIds.has(r.id) || skippedWhy.has(r.id);
        recipients.push({
          id: r.id,
          eligible: eligibleIds.has(r.id),
          ...(known && !eligibleIds.has(r.id) ? { skipReason: skippedWhy.get(r.id) } : known ? {} : { skipReason: 'CONTACT_REMOVED' }),
          channels: step.channels as Channel[],
        });
      }
    }

    const attempts = simulatePractice(recipients);
    for (const a of attempts) {
      await tx.practiceAttempt.create({
        data: {
          incidentId, recipientId: a.recipientId, channel: a.channel, state: a.state, reason: a.reason, queuedAt: now,
          sentAt: a.sentAfterS === null ? null : new Date(now.getTime() + a.sentAfterS * 1000),
          deliveredAt: a.deliveredAfterS === null ? null : new Date(now.getTime() + a.deliveredAfterS * 1000),
          failedAt: a.failedAfterS === null ? null : new Date(now.getTime() + a.failedAfterS * 1000),
        },
      });
    }
    const roll = rollupIncident(attempts);
    return { dispatched: recipients.filter(r => r.eligible).length, reached: roll.reached.length + roll.acknowledged.length, failed: roll.failed.length };
  }
}
