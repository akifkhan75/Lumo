import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_DEVIATION_GRACE_SECONDS,
  DEFAULT_GRACE_SECONDS,
  DEFAULT_MAX_RECIPIENTS,
  DEFAULT_STEP_TIMEOUT_SECONDS,
  INITIAL_LADDER,
  stepLadder,
  type Channel,
  type Decision,
  type Directory,
  type EscalationPolicy,
  type LadderEvent,
  type LadderState,
} from '@lumo/safety-domain';
import { DispatchService, SKIP_TO_REASON } from '../notifications/dispatch.service';
import { NotificationQueue } from '../notifications/queue';
import { resolveRecipients } from '../trusted-contacts/recipients';
import { TrustedContactsService } from '../trusted-contacts/trusted-contacts.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Runs the escalation ladder (docs/specs/ESCALATION_POLICY.md). The pure evaluator in @lumo/safety-domain DECIDES;
 * this service EXECUTES the decisions and persists the ladder, in the incident's transaction, under its lock
 * (lock order: incident, then user cap, then attempt).
 *
 * The policy is SNAPSHOTTED onto the incident when it starts, so editing a policy mid-incident cannot change what a
 * running incident does. Timers are queue jobs, so a deploy or a restart mid-incident does not lose them.
 */

export type Tx = Prisma.TransactionClient;
type StoredPolicy = Prisma.EscalationPolicyGetPayload<object>;

const FAILED_STATES = new Set(['FAILED', 'EXPIRED']);

export function policyFromRow(row: StoredPolicy): EscalationPolicy {
  return {
    id: row.id,
    name: row.name,
    graceSeconds: row.graceSeconds,
    steps: row.steps as unknown as EscalationPolicy['steps'],
    maxRecipientsPerIncident: row.maxRecipientsPerIncident,
    stopOnAcknowledgement: row.stopOnAcknowledgement,
    resumeOnUnacknowledge: row.resumeOnUnacknowledge,
    promptEmergencyNumberOnFailure: row.promptEmergencyNumberOnFailure,
    deviationGraceSeconds: row.deviationGraceSeconds,
  };
}

/** What the person's own settings allow: SMS only if they opted in. Never leaves a step with nothing to try. */
export function allowedChannels(channels: readonly Channel[], sendSms: boolean): Channel[] {
  const kept = channels.filter(c => sendSms || (c !== 'sms' && c !== 'voice' && c !== 'device_direct_sms'));
  return kept.length > 0 ? [...kept] : ['push'];
}

export interface LadderView {
  readonly phase: LadderState['phase'];
  readonly stepOrder: number | null;
  readonly steps: number;
  /** When the step in flight times out, epoch ms. */
  readonly nextStepAt: number | null;
}

@Injectable()
export class EscalationService {
  private readonly logger = new Logger('Escalation');
  private readonly afterAdvance: ((incidentId: string, now: Date) => Promise<void>)[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: TrustedContactsService,
    private readonly dispatch: DispatchService,
    private readonly queue: NotificationQueue,
  ) {}

  /** The incident service registers here to bring the incident in line after the ladder moves on its own (a timer). */
  onAdvanced(listener: (incidentId: string, now: Date) => Promise<void>) {
    this.afterAdvance.push(listener);
  }

  /**
   * The policy an incident will run. The user's stored default if they have one; otherwise one DERIVED from their
   * contacts: one contact per step in priority order, 120 s each, over push (and SMS only if they opted in).
   */
  async policyFor(tx: Tx, userId: string, sessionPolicyId?: string | null): Promise<{ policy: EscalationPolicy; stored: boolean }> {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { sendSmsOnSos: true } });
    // An incident raised by a JOURNEY runs that journey's own policy (its template's grace and timeouts), not the person's default.
    const row = sessionPolicyId
      ? await tx.escalationPolicy.findFirst({ where: { id: sessionPolicyId, userId } })
      : await tx.escalationPolicy.findFirst({ where: { userId, isDefault: true }, orderBy: { updatedAt: 'desc' } });
    if (row) {
      const p = policyFromRow(row);
      return { stored: true, policy: { ...p, steps: p.steps.map(s => ({ ...s, channels: allowedChannels(s.channels, user.sendSmsOnSos) })) } };
    }
    const list = await this.contacts.list(tx, userId);
    const channels: Channel[] = user.sendSmsOnSos ? ['push', 'sms'] : ['push'];
    return {
      stored: false,
      policy: {
        id: 'derived', name: 'Your contacts, in order', graceSeconds: DEFAULT_GRACE_SECONDS,
        steps: list.map((c, i) => ({ order: i + 1, recipients: [{ kind: 'contact' as const, id: c.id }], channels, timeoutSeconds: DEFAULT_STEP_TIMEOUT_SECONDS, requireAck: true })),
        maxRecipientsPerIncident: DEFAULT_MAX_RECIPIENTS, stopOnAcknowledgement: true, resumeOnUnacknowledge: true,
        promptEmergencyNumberOnFailure: true, deviationGraceSeconds: DEFAULT_DEVIATION_GRACE_SECONDS,
      },
    };
  }

  private async directory(tx: Tx, userId: string): Promise<{ directory: Directory; reasons: Map<string, string> }> {
    const { eligible, skipped } = resolveRecipients(await this.contacts.list(tx, userId));
    const contacts: Record<string, { consented: boolean }> = {};
    const reasons = new Map<string, string>();
    for (const c of eligible) contacts[c.id] = { consented: true };
    for (const s of skipped) { contacts[s.contactId] = { consented: false }; reasons.set(s.contactId, SKIP_TO_REASON[s.reason]); }
    return { directory: { contacts, circles: {} }, reasons };
  }

  private async load(tx: Tx, incidentId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "EmergencyIncident" WHERE "id" = ${incidentId} FOR UPDATE`;
    if (rows.length === 0) return null;
    return tx.emergencyIncident.findUniqueOrThrow({ where: { id: incidentId } });
  }

  private async persist(tx: Tx, incidentId: string, state: LadderState) {
    await tx.emergencyIncident.update({ where: { id: incidentId }, data: { ladder: state as unknown as Prisma.InputJsonValue } });
  }

  /** Carry out what the evaluator decided. */
  private async execute(tx: Tx, inc: { id: string; userId: string }, policy: EscalationPolicy, decisions: readonly Decision[], now: Date): Promise<{ dispatched: number }> {
    const { reasons } = await this.directory(tx, inc.userId);
    let dispatched = 0;
    for (const d of decisions) {
      switch (d.type) {
        case 'DISPATCH':
          dispatched += 1;
          await this.dispatch.planRecipientIn(tx, { incidentId: inc.id, userId: inc.userId, recipientId: d.recipientId, channels: d.channels, stepOrder: d.stepOrder, now });
          break;
        case 'SKIP': {
          if (d.reason === 'ALREADY_CONTACTED') break; // they already have attempts
          const step = policy.steps.find(s => s.order === d.stepOrder);
          const reason = d.reason === 'NOT_CONSENTED' ? (reasons.get(d.recipientId) ?? 'CONSENT_NOT_INVITED') : d.reason === 'UNKNOWN_RECIPIENT' ? 'CONTACT_REMOVED' : d.reason;
          await this.dispatch.planRecipientIn(tx, { incidentId: inc.id, userId: inc.userId, recipientId: d.recipientId, channels: step?.channels.slice(0, 1) ?? ['push'], stepOrder: d.stepOrder, skipReason: reason, now });
          break;
        }
        case 'SCHEDULE_TIMEOUT':
          await this.queue.enqueueStep(tx, inc.id, d.stepOrder, Math.max(0, Math.ceil((d.at - now.getTime()) / 1000)));
          break;
        case 'NOTIFY_USER_CAP':
          this.logger.warn(`the ${d.cap} cap truncated the ladder (incident ${inc.id}); the user must be told`);
          break;
        default:
          break; // HALT, RESUME, ACK_RECORDED, PROMPT_EMERGENCY_NUMBER, EXHAUSTED: carried by the ladder state and the rollup
      }
    }
    return { dispatched };
  }

  private async run(tx: Tx, inc: NonNullable<Awaited<ReturnType<EscalationService['load']>>>, event: LadderEvent, now: Date) {
    const policy = inc.policySnapshot as unknown as EscalationPolicy | null;
    const state = inc.ladder as unknown as LadderState | null;
    if (!policy || !state) return { ok: false as const, dispatched: 0 };
    const { directory } = await this.directory(tx, inc.userId);
    const r = stepLadder(state, event, { policy, directory, now: now.getTime(), spendCapRecipientsRemaining: null });
    if (!r.ok) return { ok: false as const, dispatched: 0 };
    await this.persist(tx, inc.id, r.state);
    const { dispatched } = await this.execute(tx, inc, policy, r.decisions, now);
    return { ok: true as const, dispatched };
  }

  /**
   * While the step in flight has nothing but failed attempts, nobody was reached and nobody will answer: advance at
   * once rather than wait out its timeout. A sent-but-unconfirmed message is NOT failed; that step waits.
   */
  private async settleFailedSteps(tx: Tx, incidentId: string, now: Date) {
    for (let guard = 0; guard < 50; guard++) {
      const inc = await tx.emergencyIncident.findUniqueOrThrow({ where: { id: incidentId } });
      const state = inc.ladder as unknown as LadderState | null;
      const policy = inc.policySnapshot as unknown as EscalationPolicy | null;
      if (!state || !policy || state.phase !== 'RUNNING') return;
      const step = policy.steps[state.stepIndex];
      const attempts = await tx.notificationAttempt.findMany({ where: { incidentId, purpose: 'ALERT', escalationStep: step.order }, select: { state: true } });
      if (attempts.length === 0 || !attempts.every(a => FAILED_STATES.has(a.state))) return;
      const out = await this.run(tx, inc, { type: 'STEP_ALL_FAILED', stepOrder: step.order }, now);
      if (!out.ok) return;
    }
  }

  // ---------------------------------------------------------------- the entry points

  /** Begin the ladder for an incident (inside its transaction). Returns how many people it dispatched to. */
  async start(tx: Tx, incidentId: string, now: Date): Promise<{ dispatched: number }> {
    const inc = await this.load(tx, incidentId);
    if (!inc) return { dispatched: 0 };
    const sessionPolicy = inc.sessionId ? (await tx.safetySession.findUnique({ where: { id: inc.sessionId }, select: { escalationPolicyId: true } }))?.escalationPolicyId : null;
    const { policy } = await this.policyFor(tx, inc.userId, sessionPolicy);
    await tx.emergencyIncident.update({
      where: { id: incidentId },
      data: { policySnapshot: policy as unknown as Prisma.InputJsonValue, ladder: INITIAL_LADDER as unknown as Prisma.InputJsonValue },
    });
    const fresh = await tx.emergencyIncident.findUniqueOrThrow({ where: { id: incidentId } });
    // A policy that fails validation (a stored one with no steps, a user with no contacts) never starts: nobody to try.
    const out = await this.run(tx, fresh, { type: 'START' }, now);
    if (!out.ok) {
      await this.persist(tx, incidentId, { ...INITIAL_LADDER, phase: 'EXHAUSTED' });
      return { dispatched: 0 };
    }
    await this.settleFailedSteps(tx, incidentId, now);
    return { dispatched: out.dispatched };
  }

  /** An acknowledgement: halt the ladder (in flight attempts are not cancelled, but no new step begins). */
  async halt(tx: Tx, incidentId: string, now: Date) {
    const inc = await this.load(tx, incidentId);
    if (inc) await this.run(tx, inc, { type: 'ACK' }, now);
  }

  /** The incident is being resolved: stop for good, without recording an acknowledgement. */
  async stop(tx: Tx, incidentId: string) {
    const inc = await tx.emergencyIncident.findUnique({ where: { id: incidentId } });
    const state = inc?.ladder as unknown as LadderState | null;
    if (state && (state.phase === 'RUNNING' || state.phase === 'IDLE')) await this.persist(tx, incidentId, { ...state, phase: 'HALTED', deadline: null });
  }

  /** "I can't help after all": carry on from the step that was in flight. */
  async resume(tx: Tx, incidentId: string, now: Date) {
    const inc = await this.load(tx, incidentId);
    if (inc) await this.run(tx, inc, { type: 'UNACK' }, now);
  }

  /** A step's timer fired (a queue job). Stale, early and repeated timers change nothing. */
  async timeout(incidentId: string, stepOrder: number, now: Date = new Date()): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const inc = await this.load(tx, incidentId);
      if (!inc || inc.state === 'CLOSED' || inc.state === 'CANCELLED') return;
      const out = await this.run(tx, inc, { type: 'STEP_TIMEOUT', stepOrder }, now);
      if (out.ok) await this.settleFailedSteps(tx, incidentId, now);
    });
    for (const l of this.afterAdvance) await l(incidentId, now).catch(() => undefined);
  }

  /** An attempt of this incident has failed: if that was the last live one in its step, move on. */
  async stepMayHaveFailed(incidentId: string, now: Date = new Date()): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const inc = await this.load(tx, incidentId);
      if (!inc || inc.state === 'CLOSED' || inc.state === 'CANCELLED') return;
      await this.settleFailedSteps(tx, incidentId, now);
    });
  }

  /** The ladder as the app shows it. */
  static view(ladder: unknown, policy: unknown): LadderView | null {
    const state = ladder as LadderState | null;
    const p = policy as EscalationPolicy | null;
    if (!state || !p) return null;
    return { phase: state.phase, stepOrder: p.steps[state.stepIndex]?.order ?? null, steps: p.steps.length, nextStepAt: state.phase === 'RUNNING' ? state.deadline : null };
  }
}
