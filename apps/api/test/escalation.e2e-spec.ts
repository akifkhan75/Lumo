/**
 * The escalation ladder (docs/specs/ESCALATION_POLICY.md) executed against real Postgres, the real HTTP pipeline and the
 * real pg-boss. Providers are fakes: nothing here reaches a phone. The pure evaluator is proven in @lumo/safety-domain;
 * this proves it is EXECUTED correctly: persisted, snapshotted, timed, and halted.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { EscalationService } from '../src/escalation/escalation.service';
import { NotificationQueue } from '../src/notifications/queue';
import { SendWorker } from '../src/notifications/send-worker';
import { PUSH_PROVIDER, type PushProvider } from '../src/notifications/push/push-provider';
import { SMS_PROVIDER, type SmsOutcome, type SmsProvider } from '../src/notifications/sms/sms-provider';

process.env.NOTIFICATIONS_QUEUE = 'on';
process.env.NOTIFICATIONS_QUEUE_SCHEMA = 'pgboss_escalation_e2e';
const RUN = `es_${Date.now()}_${randomUUID().slice(0, 6)}`;

class FakeSms implements SmsProvider {
  next: SmsOutcome = { kind: 'accepted', providerMessageId: 'SM', status: 'queued' };
  calls: { to: string; attemptId: string }[] = [];
  configured() { return true; }
  async send(r: { to: string; body: string; attemptId: string }) { this.calls.push({ to: r.to, attemptId: r.attemptId }); return this.next.kind === 'accepted' ? { ...this.next, providerMessageId: `SM_${randomUUID().slice(0, 8)}` } : this.next; }
}
class FakePush implements PushProvider {
  configured() { return true; }
  async send(r: { tokens: readonly string[] }) { return { kind: 'accepted' as const, tickets: r.tokens.map((token, i) => ({ token, id: `T${i}_${randomUUID().slice(0, 6)}` })), deadTokens: [] }; }
  async receipts() { return new Map(); }
}
const sms = new FakeSms();

let app: INestApplication;
let prisma: PrismaClient;
let escalation: EscalationService;
let worker: SendWorker;
let queue: NotificationQueue;

const api = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const key = () => `k-${randomUUID()}`;
const expoToken = () => `ExponentPushToken[${randomUUID().replace(/-/g, '').slice(0, 22)}]`;
/** Let the step in flight time out, as its queue job would after the deadline. */
// Each later step's deadline was set from the earlier timeout's clock, so the clock keeps moving forward.
const stepOn = (id: string, order: number) => escalation.timeout(id, order, new Date(Date.now() + order * 10 * 60_000));
const row = (id: string) => prisma.emergencyIncident.findUniqueOrThrow({ where: { id } });
const attemptsOf = (id: string) => prisma.notificationAttempt.findMany({ where: { incidentId: id }, orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }] });
const who = async (id: string) => (await attemptsOf(id)).map((a) => `${a.recipientId}:${a.channel}:${a.state}:${a.stateReason ?? ''}`);
const ladderOf = async (id: string) => (await row(id)).ladder as { phase: string; stepIndex: number; contacted: string[]; deadline: number | null };

/** An owner with `n` contacts in priority order. `agree` says which have agreed; `claim` which claimed from a signed-in account. */
async function owner(label: string, n: number, o: { agree?: boolean[]; claim?: number[]; sms?: boolean } = {}) {
  const s = await api().post('/api/v1/auth/signup').send({ name: `Owner ${label}`, email: `${RUN}_${label}@example.com`, password: 'password123' }).expect(201);
  const token = s.body.token as string;
  const userId = s.body.user.id as string;
  await prisma.user.update({ where: { id: userId }, data: { sendSmsOnSos: o.sms ?? true } });
  const put = await api().put('/api/v1/settings').set(auth(token)).send({ trustedContacts: Array.from({ length: n }, (_, i) => ({ name: `C${i}`, phone: `+92300123450${i}` })) }).expect(200);
  const ids: string[] = put.body.trustedContacts.map((c: { id: string }) => c.id);
  const claimers: Record<number, { token: string; userId: string }> = {};
  for (let i = 0; i < n; i++) {
    if (!(o.agree?.[i] ?? true) && !o.claim?.includes(i)) continue;
    const inv = await api().post(`/api/v1/trusted-contacts/${ids[i]}/invite`).set(auth(token)).expect(201);
    if (o.claim?.includes(i)) {
      const c = await api().post('/api/v1/auth/signup').send({ name: `Contact ${label}${i}`, email: `${RUN}_${label}_c${i}@example.com`, password: 'password123' }).expect(201);
      await api().post(`${inv.body.path}/claim`).set(auth(c.body.token)).expect(200);
      await api().post('/api/v1/devices').set(auth(c.body.token)).send({ platform: 'android', osVersion: '14', pushToken: expoToken() }).expect(201);
      claimers[i] = { token: c.body.token, userId: c.body.user.id };
    } else {
      await api().post(`${inv.body.path}/accept`).expect(200);
    }
  }
  return { token, userId, ids, claimers };
}
const sos = (token: string, b: Record<string, unknown> = {}) =>
  api().post('/api/v1/sos').set(auth(token)).set('Idempotency-Key', key()).send({ triggerType: 'manual', triggeredAt: new Date().toISOString(), ...b });
const smsOf = async (incidentId: string, recipientId: string) => (await attemptsOf(incidentId)).find((a) => a.recipientId === recipientId && a.channel === 'sms')!;

beforeAll(async () => {
  prisma = new PrismaClient();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getOptionsToken()).useValue([{ name: 'short', ttl: 1000, limit: 1_000_000 }])
    .overrideProvider(SMS_PROVIDER).useValue(sms)
    .overrideProvider(PUSH_PROVIDER).useValue(new FakePush())
    .compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  escalation = app.get(EscalationService);
  worker = app.get(SendWorker);
  queue = app.get(NotificationQueue);
});
beforeEach(() => {
  sms.next = { kind: 'accepted', providerMessageId: 'SM', status: 'queued' };
  sms.calls = [];
  // Deterministic: sending is driven by hand, and the ladder's own step jobs are driven by `stepOn`.
  queue.setHandlers({ send: async () => {}, expire: async () => {}, receipts: async () => {}, step: async () => {} });
});
afterAll(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lumo.erasure = 'on'`;
    await tx.contactInvite.deleteMany({ where: { contact: { user: { email: { startsWith: RUN } } } } });
    await tx.user.deleteMany({ where: { email: { startsWith: RUN } } });
  });
  await prisma.$disconnect();
  await app.close();
});

describe('the ladder runs one contact at a time, in priority order', () => {
  it('only the first contact is alerted at once; the next waits for the first step to give way', async () => {
    const o = await owner('seq', 3);
    const r = await sos(o.token).expect(201);
    expect((await attemptsOf(r.body.id)).filter((a) => a.state === 'QUEUED').map((a) => a.recipientId)).toEqual([o.ids[0]]);
    expect(await ladderOf(r.body.id)).toMatchObject({ phase: 'RUNNING', stepIndex: 0 });

    await stepOn(r.body.id, 1);
    expect((await attemptsOf(r.body.id)).map((a) => a.recipientId)).toContain(o.ids[1]);
    expect((await attemptsOf(r.body.id)).map((a) => a.recipientId)).not.toContain(o.ids[2]);
    await stepOn(r.body.id, 2);
    expect((await attemptsOf(r.body.id)).map((a) => a.recipientId)).toContain(o.ids[2]);
  });

  it('each attempt records the step it belongs to', async () => {
    const o = await owner('stepno', 2);
    const r = await sos(o.token).expect(201);
    await stepOn(r.body.id, 1);
    const steps = (await attemptsOf(r.body.id)).map((a) => [a.recipientId, a.escalationStep]);
    expect(steps).toEqual(expect.arrayContaining([[o.ids[0], 1], [o.ids[1], 2]]));
  });

  it('the view says which step is in flight and when it gives way', async () => {
    const o = await owner('view', 2);
    const r = await sos(o.token).expect(201);
    expect(r.body.escalation).toMatchObject({ phase: 'RUNNING', stepOrder: 1, steps: 2 });
    expect(r.body.escalation.nextStepAt).toBeGreaterThan(Date.now());
  });

  it('a stale, early or repeated timer changes nothing', async () => {
    const o = await owner('stale', 3);
    const r = await sos(o.token).expect(201);
    const before = await who(r.body.id);
    await escalation.timeout(r.body.id, 1, new Date()); // fired early
    await stepOn(r.body.id, 2); // a timer for a step that is not in flight
    expect(await who(r.body.id)).toEqual(before);
    await stepOn(r.body.id, 1);
    const after = await who(r.body.id);
    await stepOn(r.body.id, 1); // the same timer again
    expect(await who(r.body.id)).toEqual(after);
  });

  it('a contact who has already been alerted is not alerted again by a later step', async () => {
    const o = await owner('once', 2);
    const r = await sos(o.token).expect(201);
    await stepOn(r.body.id, 1);
    await stepOn(r.body.id, 2);
    const mine = (await attemptsOf(r.body.id)).filter((a) => a.recipientId === o.ids[0] && a.channel === 'sms');
    expect(mine).toHaveLength(1);
  });
});

describe('waiting, and not waiting', () => {
  it('a text that was SENT and is unconfirmed holds the step: it may yet arrive', async () => {
    const o = await owner('unconfirmed', 2);
    const r = await sos(o.token).expect(201);
    await worker.send((await smsOf(r.body.id, o.ids[0])).id);
    expect((await ladderOf(r.body.id)).stepIndex).toBe(0);
    expect((await attemptsOf(r.body.id)).map((a) => a.recipientId)).not.toContain(o.ids[1]);
  });

  it('when every attempt of the step has FAILED the ladder moves on at once, without waiting out the timeout', async () => {
    const o = await owner('fastfail', 3);
    const r = await sos(o.token).expect(201);
    sms.next = { kind: 'rejected', reason: 'TWILIO_21211' };
    await worker.send((await smsOf(r.body.id, o.ids[0])).id);
    // no timer was fired: the failure itself moved the ladder on
    expect((await attemptsOf(r.body.id)).map((a) => a.recipientId)).toContain(o.ids[1]);
    expect((await ladderOf(r.body.id)).stepIndex).toBe(1);
  });

  it('with SMS off and nobody linked to push, the whole ladder runs out immediately: nobody reached', async () => {
    const o = await owner('smsoff', 3, { sms: false });
    const r = await sos(o.token).expect(201);
    expect(r.body.state).toBe('ALL_CHANNELS_FAILED');
    expect(await ladderOf(r.body.id)).toMatchObject({ phase: 'EXHAUSTED' });
    expect(r.body.attempts.map((a: { reason: string }) => a.reason)).toEqual(['NO_ADDRESS', 'NO_ADDRESS', 'NO_ADDRESS']);
  });

  it('every send refused, one after another: ALL_CHANNELS_FAILED, and the dial prompt is the app’s next action', async () => {
    const o = await owner('allfail', 2);
    const r = await sos(o.token).expect(201);
    sms.next = { kind: 'rejected', reason: 'TWILIO_21211' };
    await worker.send((await smsOf(r.body.id, o.ids[0])).id);
    await worker.send((await smsOf(r.body.id, o.ids[1])).id);
    expect((await row(r.body.id)).state).toBe('ALL_CHANNELS_FAILED');
    expect((await ladderOf(r.body.id)).phase).toBe('EXHAUSTED');
  });

  it('the incident does not settle while a later step is still to come', async () => {
    const o = await owner('notyet', 2);
    const r = await sos(o.token).expect(201);
    const a = await smsOf(r.body.id, o.ids[0]);
    await worker.send(a.id);
    await worker.expire(a.id); // UNKNOWN: sent, unconfirmed, and settled
    expect((await row(r.body.id)).state).toBe('NOTIFYING'); // step 2 is still to come
    await stepOn(r.body.id, 1);
    const b = await smsOf(r.body.id, o.ids[1]);
    await worker.send(b.id);
    await worker.expire(b.id);
    expect((await row(r.body.id)).state).toBe('NOTIFIED'); // the ladder is out of steps
  });
});

describe('consent, and the limits', () => {
  it('a contact who has not agreed is skipped and ledgered with the reason, and the ladder does not wait on them', async () => {
    const o = await owner('consent', 3, { agree: [false, true, true] });
    const r = await sos(o.token).expect(201);
    const a = await attemptsOf(r.body.id);
    expect(a.filter((x) => x.recipientId === o.ids[0]).every((x) => x.state === 'FAILED' && x.stateReason === 'CONSENT_NOT_INVITED')).toBe(true);
    expect(a.filter((x) => x.recipientId === o.ids[1] && x.state === 'QUEUED').length).toBeGreaterThan(0); // straight on to contact 2
    expect(sms.calls).toHaveLength(0);
  });

  it('the policy maximum binds: the contact beyond it is ledgered MAX_RECIPIENTS', async () => {
    const o = await owner('max', 3);
    await api().put('/api/v1/escalation-policy').set(auth(o.token)).send({
      name: 'Just one', graceSeconds: 300, maxRecipientsPerIncident: 1, stopOnAcknowledgement: true, resumeOnUnacknowledge: true,
      promptEmergencyNumberOnFailure: true, deviationGraceSeconds: 180,
      steps: [0, 1, 2].map((i) => ({ order: i + 1, recipients: [{ kind: 'contact', id: o.ids[i] }], channels: ['sms'], timeoutSeconds: 120, requireAck: true })),
    }).expect(200);
    const r = await sos(o.token).expect(201);
    await stepOn(r.body.id, 1);
    const reasons = (await attemptsOf(r.body.id)).filter((a) => a.recipientId !== o.ids[0]).map((a) => a.stateReason);
    expect(reasons).toContain('MAX_RECIPIENTS');
    expect((await attemptsOf(r.body.id)).filter((a) => a.state === 'QUEUED')).toHaveLength(1);
  });

  it('the daily cap truncating a step is ledgered per attempt and the user can see it', async () => {
    const o = await owner('cap', 2);
    const spent = await prisma.emergencyIncident.create({ data: { userId: o.userId, idempotencyKey: key(), triggerType: 'manual', triggeredAt: new Date(), regionProfileId: 'UNRESOLVED', state: 'CLOSED' } });
    for (let i = 0; i < 30; i++) await prisma.notificationAttempt.create({ data: { incidentId: spent.id, recipientId: randomUUID(), channel: 'sms', escalationStep: 0, state: 'SENT', reservedAt: new Date() } });
    const r = await sos(o.token).expect(201);
    expect(r.body.capped).toContain(o.ids[0]);
    expect((await attemptsOf(r.body.id)).find((a) => a.recipientId === o.ids[0] && a.channel === 'sms')!.stateReason).toBe('SPEND_CAP');
  });
});

describe('acknowledgement halts the ladder, and un-acknowledging resumes it', () => {
  it('an acknowledgement at step 2 means step 3 never happens, even when its timer fires', async () => {
    const o = await owner('ackhalt', 3, { claim: [1] });
    const r = await sos(o.token).expect(201);
    await stepOn(r.body.id, 1);
    await api().post(`/api/v1/incidents/${r.body.id}/ack`).set(auth(o.claimers[1].token)).expect(200).expect({ recorded: true });
    expect((await row(r.body.id)).state).toBe('ACKNOWLEDGED');
    expect(await ladderOf(r.body.id)).toMatchObject({ phase: 'HALTED' });
    await stepOn(r.body.id, 2); // the timer that would have started step 3
    expect((await attemptsOf(r.body.id)).map((a) => a.recipientId)).not.toContain(o.ids[2]);
  });

  it('un-acknowledging resumes from the step that was in flight — not from the beginning — and does not re-alert them', async () => {
    const o = await owner('unack', 3, { claim: [1] });
    const r = await sos(o.token).expect(201);
    await stepOn(r.body.id, 1);
    const alertedBefore = (await attemptsOf(r.body.id)).length;
    await api().post(`/api/v1/incidents/${r.body.id}/ack`).set(auth(o.claimers[1].token)).expect(200);
    await api().post(`/api/v1/incidents/${r.body.id}/unack`).set(auth(o.claimers[1].token)).expect(200).expect({ recorded: true });
    expect(await ladderOf(r.body.id)).toMatchObject({ phase: 'RUNNING', stepIndex: 1 });
    expect((await attemptsOf(r.body.id)).length).toBe(alertedBefore); // nobody was re-dispatched
    await stepOn(r.body.id, 2); // the re-armed timeout moves on to contact 3
    expect((await attemptsOf(r.body.id)).map((a) => a.recipientId)).toContain(o.ids[2]);
    expect((await attemptsOf(r.body.id)).filter((a) => a.recipientId === o.ids[0] && a.channel === 'sms')).toHaveLength(1);
  });

  it('resolving stops the ladder for good: a later timer starts nothing', async () => {
    const o = await owner('resolved', 3);
    const r = await sos(o.token).expect(201);
    await api().post(`/api/v1/incidents/${r.body.id}/resolve`).set(auth(o.token)).expect(200);
    const before = (await attemptsOf(r.body.id)).length;
    await stepOn(r.body.id, 1);
    expect((await attemptsOf(r.body.id)).length).toBe(before);
    expect((await ladderOf(r.body.id)).phase).toBe('HALTED');
  });

  it('a cancelled-in-countdown incident never starts a ladder', async () => {
    const o = await owner('cancelled', 2);
    const r = await sos(o.token, { countdownSeconds: 3 }).expect(201);
    await api().post(`/api/v1/incidents/${r.body.id}/cancel`).set(auth(o.token)).expect(200);
    expect((await row(r.body.id)).ladder).toBeNull();
    expect(await attemptsOf(r.body.id)).toHaveLength(0);
  });
});

describe('the policy is snapshotted, and visible before it runs', () => {
  const put = (token: string, ids: string[], over: Record<string, unknown> = {}) => api().put('/api/v1/escalation-policy').set(auth(token)).send({
    name: 'Mine', graceSeconds: 300, maxRecipientsPerIncident: 5, stopOnAcknowledgement: true, resumeOnUnacknowledge: true,
    promptEmergencyNumberOnFailure: true, deviationGraceSeconds: 180,
    steps: ids.map((id, i) => ({ order: i + 1, recipients: [{ kind: 'contact', id }], channels: ['sms'], timeoutSeconds: 120, requireAck: true })), ...over,
  });

  it('with no stored policy it shows the one derived from the contacts, in plain words, before anything runs', async () => {
    const o = await owner('derived', 2);
    const g = await api().get('/api/v1/escalation-policy').set(auth(o.token)).expect(200);
    expect(g.body.stored).toBe(false);
    expect(g.body.policy.steps).toHaveLength(2);
    expect(g.body.description.join(' ')).toContain('C0');
    expect(g.body.description.join(' ')).toContain('Try to alert');
    expect(g.body.description.join(' ').toLowerCase()).not.toMatch(/will be notified|help is/);
  });

  it('a grace below the minimum is refused with its own message; so is a step that can only email', async () => {
    const o = await owner('invalid', 2);
    const low = await put(o.token, o.ids, { graceSeconds: 10 }).expect(400);
    expect(JSON.stringify(low.body)).toMatch(/at least 60 seconds/);
    const mail = await put(o.token, o.ids, { steps: [{ order: 1, recipients: [{ kind: 'contact', id: o.ids[0] }], channels: ['email'], timeoutSeconds: 120, requireAck: true }] }).expect(400);
    expect(JSON.stringify(mail.body)).toMatch(/emergency-grade/);
  });

  it('only your own contacts can be named; circles are not accepted yet', async () => {
    const a = await owner('own_a', 1);
    const b = await owner('own_b', 1);
    await put(a.token, [b.ids[0]]).expect(400);
    await api().put('/api/v1/escalation-policy').set(auth(a.token)).send({ name: 'x', graceSeconds: 300, maxRecipientsPerIncident: 5, stopOnAcknowledgement: true, resumeOnUnacknowledge: true, promptEmergencyNumberOnFailure: true, deviationGraceSeconds: 180, steps: [{ order: 1, recipients: [{ kind: 'circle', id: 'c' }], channels: ['sms'], timeoutSeconds: 120, requireAck: true }] }).expect(400);
  });

  it('a stored policy is used, and read back; and it needs a login', async () => {
    const o = await owner('stored', 3);
    await put(o.token, [o.ids[2], o.ids[0]]).expect(200); // a different order, and only two
    const g = await api().get('/api/v1/escalation-policy').set(auth(o.token)).expect(200);
    expect(g.body.stored).toBe(true);
    expect(g.body.policy.steps.map((s: { recipients: { id: string }[] }) => s.recipients[0].id)).toEqual([o.ids[2], o.ids[0]]);
    const r = await sos(o.token).expect(201);
    expect((await attemptsOf(r.body.id)).filter((a) => a.state === 'QUEUED').map((a) => a.recipientId)).toEqual([o.ids[2]]);
    await api().get('/api/v1/escalation-policy').expect(401);
  });

  it('editing the policy mid-incident does not change what a running incident does', async () => {
    const o = await owner('snapshot', 3);
    await put(o.token, [o.ids[0], o.ids[1]]).expect(200);
    const r = await sos(o.token).expect(201);
    await put(o.token, [o.ids[2]]).expect(200); // changed after the incident began
    await stepOn(r.body.id, 1);
    const queued = (await attemptsOf(r.body.id)).filter((a) => a.state === 'QUEUED').map((a) => a.recipientId);
    expect(queued).toEqual(expect.arrayContaining([o.ids[0], o.ids[1]]));
    expect(queued).not.toContain(o.ids[2]);
  });

  it('SMS in a stored policy is still bounded by the person’s own setting', async () => {
    const o = await owner('smsbound', 1, { sms: false });
    await put(o.token, [o.ids[0]]).expect(200); // the policy asks for sms
    const r = await sos(o.token).expect(201);
    expect((await attemptsOf(r.body.id)).map((a) => a.channel)).toEqual(['push']);
  });

  it('the emergency token cannot read or change the policy', async () => {
    const o = await owner('tokpol', 1);
    const tok = (await api().post('/api/v1/emergency-token').set(auth(o.token)).send({ deviceKey: 'install-escal-01' }).expect(201)).body.token;
    await api().get('/api/v1/escalation-policy').set(auth(tok)).expect(401);
    await api().put('/api/v1/escalation-policy').set(auth(tok)).send({}).expect(401);
  });
});

describe('the timers are real queue jobs', () => {
  it('a step times out and the next contact is alerted without anyone calling anything', { timeout: 40_000 }, async () => {
    const o = await owner('realtimer', 2);
    await api().put('/api/v1/escalation-policy').set(auth(o.token)).send({
      name: 'Quick', graceSeconds: 300, maxRecipientsPerIncident: 5, stopOnAcknowledgement: true, resumeOnUnacknowledge: true,
      promptEmergencyNumberOnFailure: true, deviationGraceSeconds: 180,
      steps: o.ids.map((id, i) => ({ order: i + 1, recipients: [{ kind: 'contact', id }], channels: ['sms'], timeoutSeconds: 10, requireAck: true })),
    }).expect(200);
    queue.setHandlers({ send: async () => {}, expire: async () => {}, receipts: async () => {}, step: (id, order) => escalation.timeout(id, order) });
    await prisma.$executeRawUnsafe(`DELETE FROM pgboss_escalation_e2e.job WHERE name = 'incident.step' AND state = 'created'`);
    const r = await sos(o.token).expect(201);
    expect((await attemptsOf(r.body.id)).map((a) => a.recipientId)).not.toContain(o.ids[1]);
    for (let i = 0; i < 80 && !(await attemptsOf(r.body.id)).some((a) => a.recipientId === o.ids[1]); i++) await new Promise((res) => setTimeout(res, 500));
    expect((await attemptsOf(r.body.id)).map((a) => a.recipientId)).toContain(o.ids[1]);
    expect((await ladderOf(r.body.id)).stepIndex).toBe(1);
  });

  it('the ladder is persisted on the incident, so a restart loses nothing', async () => {
    const o = await owner('persist', 2);
    const r = await sos(o.token).expect(201);
    const inc = await row(r.body.id);
    expect(inc.ladder).toMatchObject({ phase: 'RUNNING' });
    expect(inc.policySnapshot).toMatchObject({ steps: expect.any(Array) });
    const jobs = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM pgboss_escalation_e2e.job WHERE name = 'incident.step' AND data->>'incidentId' = $1`, r.body.id);
    expect(Number(jobs[0].n)).toBe(1);
  });
});
