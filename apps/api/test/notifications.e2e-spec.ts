/**
 * The ledger, the queue, the SMS worker and the Twilio webhook, against real Postgres and the
 * real pg-boss (docs/specs/NOTIFICATIONS.md). The SMS provider is a fake, so NOTHING here talks
 * to Twilio: this proves the ledger and the plumbing, not delivery to a phone.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConsoleLogger, INestApplication, Logger } from '@nestjs/common';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import twilio from 'twilio';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { DispatchService } from '../src/notifications/dispatch.service';
import { LedgerService } from '../src/notifications/ledger.service';
import { NotificationQueue } from '../src/notifications/queue';
import { SendWorker } from '../src/notifications/send-worker';
import { SMS_PROVIDER, type SmsOutcome, type SmsProvider } from '../src/notifications/sms/sms-provider';
import { VOICE_PROVIDER, type VoiceOutcome, type VoiceProvider } from '../src/notifications/voice/voice-provider';
import { PUSH_PROVIDER, type PushOutcome, type PushProvider, type PushReceipt } from '../src/notifications/push/push-provider';
import { TrustedContactsService } from '../src/trusted-contacts/trusted-contacts.service';
import { rollupIncident } from '@lumo/safety-domain';

const RUN = `nt_${Date.now()}_${randomUUID().slice(0, 6)}`;
const TWILIO = { sid: 'ACtest', token: 'test-auth-token-not-real', url: 'https://api.lumo.test' };
process.env.TWILIO_ACCOUNT_SID = TWILIO.sid;
process.env.TWILIO_AUTH_TOKEN = TWILIO.token;
process.env.TWILIO_MESSAGING_SERVICE_SID = 'MGtest';
process.env.PUBLIC_API_URL = TWILIO.url;
// Its own queue: other suites' workers must not be able to take this suite's jobs.
process.env.NOTIFICATIONS_QUEUE = 'on';
process.env.NOTIFICATIONS_QUEUE_SCHEMA = 'pgboss_notifications_e2e';

class FakeSms implements SmsProvider {
  isConfigured = true;
  next: SmsOutcome = { kind: 'accepted', providerMessageId: 'SM_default', status: 'queued' };
  calls: { to: string; body: string; attemptId: string }[] = [];
  configured() { return this.isConfigured; }
  async send(r: { to: string; body: string; attemptId: string }) { this.calls.push(r); return this.next; }
}

class FakeVoice implements VoiceProvider {
  isConfigured = true;
  next: VoiceOutcome = { kind: 'accepted', providerMessageId: 'CA_default', status: 'queued' };
  calls: { to: string; script: string; attemptId: string }[] = [];
  configured() { return this.isConfigured; }
  async call(r: { to: string; script: string; attemptId: string }) { this.calls.push(r); return this.next; }
}
const fakeVoice = new FakeVoice();

class FakePush implements PushProvider {
  isConfigured = true;
  next: PushOutcome | null = null; // null: accept every token with a fresh ticket
  receiptMap: ReadonlyMap<string, PushReceipt> | null = new Map();
  calls: { tokens: readonly string[]; title: string; body: string; attemptId: string }[] = [];
  configured() { return this.isConfigured; }
  async send(r: { tokens: readonly string[]; title: string; body: string; attemptId: string }): Promise<PushOutcome> {
    this.calls.push(r);
    return this.next ?? { kind: 'accepted', tickets: r.tokens.map((token, i) => ({ token, id: `T${i}_${randomUUID().slice(0, 6)}` })), deadTokens: [] };
  }
  async receipts() { return this.receiptMap; }
}
const fakePush = new FakePush();

let app: INestApplication;
let prisma: PrismaClient;
let dispatch: DispatchService;
let ledger: LedgerService;
let worker: SendWorker;
let queue: NotificationQueue;
const fake = new FakeSms();
const lines: string[] = [];

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const api = () => request(app.getHttpServer());

/** A user with one contact, optionally brought all the way to "agreed". */
async function scenario(label: string, opts: { agree?: boolean; phone?: string; region?: string } = {}) {
  const phone = opts.phone ?? '+923001234567';
  const s = await api().post('/api/v1/auth/signup').send({ name: `Owner ${label}`, email: `${RUN}_${label}@example.com`, password: 'password123' }).expect(201);
  const token = s.body.token as string;
  const userId = s.body.user.id as string;
  const put = await api().put('/api/v1/settings').set(auth(token)).send({ trustedContacts: [{ name: 'Ayesha', phone }] }).expect(200);
  const contactId = put.body.trustedContacts[0].id as string;
  if (opts.agree) {
    const inv = await api().post(`/api/v1/trusted-contacts/${contactId}/invite`).set(auth(token)).expect(201);
    await api().post(`${inv.body.path}/accept`).expect(200);
  }
  const incident = await prisma.emergencyIncident.create({
    data: { userId, idempotencyKey: randomUUID(), triggerType: 'manual', triggeredAt: new Date(), regionProfileId: opts.region ?? 'PK', state: 'NOTIFYING' },
  });
  return { token, userId, contactId, incidentId: incident.id, phone };
}
const plan = (s: { incidentId: string; userId: string }, channels: ('sms' | 'push' | 'voice')[] = ['sms']) =>
  dispatch.plan({ incidentId: s.incidentId, userId: s.userId, channels });
const attempt = (id: string) => prisma.notificationAttempt.findUniqueOrThrow({ where: { id } });
const events = async (id: string) => (await prisma.notificationEvent.findMany({ where: { attemptId: id }, orderBy: { seq: 'asc' } })).map((e) => `${e.toState}${e.reason ? `:${e.reason}` : ''}`);

/** A signed Twilio callback, exactly as Twilio would send it. */
function callback(attemptId: string, params: Record<string, string>, over: { url?: string; token?: string } = {}) {
  const path = `/api/v1/webhooks/twilio/status?attempt=${attemptId}`;
  const signature = twilio.getExpectedTwilioSignature(over.token ?? TWILIO.token, over.url ?? `${TWILIO.url}${path}`, params);
  return api().post(path).set('X-Twilio-Signature', signature).type('form').send(params);
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const spy = (m: string) => (msg: unknown, ...rest: unknown[]) => { lines.push(`${m} ${String(msg)} ${rest.map(String).join(' ')}`); };
  Logger.overrideLogger(false);
  class Capturing extends ConsoleLogger { log = spy('log'); error = spy('error'); warn = spy('warn'); debug = spy('debug'); verbose = spy('verbose'); }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getOptionsToken()).useValue([{ name: 'short', ttl: 1000, limit: 1_000_000 }])
    .overrideProvider(SMS_PROVIDER).useValue(fake)
    .overrideProvider(VOICE_PROVIDER).useValue(fakeVoice)
    .overrideProvider(PUSH_PROVIDER).useValue(fakePush)
    .compile();
  app = moduleRef.createNestApplication({ logger: new Capturing() });
  configureApp(app);
  await app.init();
  dispatch = app.get(DispatchService);
  ledger = app.get(LedgerService);
  worker = app.get(SendWorker);
  queue = app.get(NotificationQueue);
});

beforeEach(() => {
  fake.isConfigured = true;
  fake.next = { kind: 'accepted', providerMessageId: `SM_${randomUUID().slice(0, 8)}`, status: 'queued' };
  fake.calls = [];
  fakeVoice.isConfigured = true;
  fakeVoice.next = { kind: 'accepted', providerMessageId: `CA_${randomUUID().slice(0, 8)}`, status: 'queued' };
  fakeVoice.calls = [];
  fakePush.isConfigured = true;
  fakePush.next = null;
  fakePush.receiptMap = new Map();
  fakePush.calls = [];
  // Deterministic: jobs are drained by hand unless a test wants the real queue.
  queue.setHandlers({ send: async () => {}, expire: async () => {}, receipts: async () => {} });
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

describe('planning: an attempt and its jobs exist together or not at all', () => {
  it('commits the attempt, its first event and both jobs', async () => {
    const s = await scenario('commit', { agree: true });
    const [p] = await plan(s);
    expect(p).toMatchObject({ outcome: 'queued', channel: 'sms', recipientId: s.contactId });
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED']);
    const jobs = await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM pgboss_notifications_e2e.job WHERE data->>'attemptId' = $1 ORDER BY name`, p.attemptId);
    expect(jobs.map((j) => j.name)).toEqual(['notify.expire', 'notify.send']);
  });

  it('a rolled-back plan leaves no attempt and no job', async () => {
    const s = await scenario('rollback', { agree: true });
    let ids: string[] = [];
    await prisma.$transaction(async (tx) => {
      ids = (await dispatch.planIn(tx, { incidentId: s.incidentId, userId: s.userId, channels: ['sms'] })).map((p) => p.attemptId);
      throw new Error('rollback');
    }).catch(() => {});
    expect(ids).toHaveLength(1);
    expect(await prisma.notificationAttempt.count({ where: { id: { in: ids } } })).toBe(0);
    const jobs = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM pgboss_notifications_e2e.job WHERE data->>'attemptId' = ANY($1)`, ids);
    expect(Number(jobs[0].n)).toBe(0);
  });

  it('a contact who may not be alerted is ledgered with the reason, not dropped', async () => {
    const s = await scenario('skipped'); // never invited
    const [p] = await plan(s);
    expect(p).toMatchObject({ outcome: 'not_attempted', reason: 'CONSENT_NOT_INVITED' });
    expect((await attempt(p.attemptId)).state).toBe('FAILED');
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED', 'FAILED:CONSENT_NOT_INVITED']);
    expect(fake.calls).toHaveLength(0);
    expect(await prisma.$queryRawUnsafe(`SELECT 1 FROM pgboss_notifications_e2e.job WHERE data->>'attemptId' = $1`, p.attemptId)).toHaveLength(0);
  });

  it('push has no address for a contact: ledgered NO_ADDRESS, and no device is guessed from a matching email', async () => {
    const s = await scenario('push', { agree: true });
    // Someone registers a device under the contact's own phone/email identity: must change nothing.
    const p = (await plan(s, ['sms', 'push'])).find((x) => x.channel === 'push')!;
    expect(p).toMatchObject({ outcome: 'not_attempted', reason: 'NO_ADDRESS' });
    expect((await attempt(p.attemptId)).reservedAt).toBeNull(); // nothing to send to, so no budget spent
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED', 'FAILED:NO_ADDRESS']);
  });

  it('is idempotent per recipient and channel and attempt number', async () => {
    const s = await scenario('dup', { agree: true });
    await plan(s);
    await expect(plan(s)).rejects.toThrow(); // unique (incident, recipient, channel, attemptNumber)
  });
});

describe('sending', () => {
  it('claims, calls the provider once, and records SENT with the provider id — never DELIVERED', async () => {
    const s = await scenario('send', { agree: true });
    const [p] = await plan(s);
    fake.next = { kind: 'accepted', providerMessageId: 'SM123', status: 'queued' };
    await worker.send(p.attemptId);
    const a = await attempt(p.attemptId);
    expect(a).toMatchObject({ state: 'SENT', providerMessageId: 'SM123', providerStatus: 'queued' });
    expect(a.claimedAt).not.toBeNull();
    expect(a.deliveredAt).toBeNull();
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED', 'SENT:PROVIDER_ACCEPTED']);
    expect(fake.calls).toEqual([{ to: s.phone, body: expect.stringContaining('asked Lumo to alert you'), attemptId: p.attemptId }]);
  });

  it('a redelivered job sends nothing: at most one provider call', async () => {
    const s = await scenario('redeliver', { agree: true });
    const [p] = await plan(s);
    await Promise.all([worker.send(p.attemptId), worker.send(p.attemptId), worker.send(p.attemptId)]);
    await worker.send(p.attemptId);
    expect(fake.calls).toHaveLength(1);
  });

  it('with no credentials the attempt is NOT_ATTEMPTED / PROVIDER_NOT_CONFIGURED — never accepted', async () => {
    const s = await scenario('noconf', { agree: true });
    const [p] = await plan(s);
    fake.isConfigured = false;
    await worker.send(p.attemptId);
    expect((await attempt(p.attemptId)).state).toBe('FAILED');
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED', 'FAILED:PROVIDER_NOT_CONFIGURED']);
    expect(fake.calls).toHaveLength(0);
  });

  it('re-checks consent at send time: withdrawn between planning and sending → nothing is sent', async () => {
    const s = await scenario('withdrawn', { agree: true });
    const [p] = await plan(s);
    const inv = await prisma.contactInvite.findFirstOrThrow({ where: { contactId: s.contactId } });
    await prisma.contactInvite.update({ where: { id: inv.id }, data: { endedAt: new Date(), endedReason: 'CONTACT_WITHDREW' } });
    await prisma.consentRecord.updateMany({ where: { grantedById: s.contactId }, data: { revokedAt: new Date(), revokedReason: 'CONTACT_WITHDREW' } });
    await worker.send(p.attemptId);
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED', 'FAILED:CONSENT_WITHDRAWN']);
    expect(fake.calls).toHaveLength(0);
  });

  it('a removed contact is not sent to', async () => {
    const s = await scenario('removed', { agree: true });
    const [p] = await plan(s);
    await api().put('/api/v1/settings').set(auth(s.token)).send({ trustedContacts: [] }).expect(200);
    await worker.send(p.attemptId);
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED', 'FAILED:CONTACT_REMOVED']);
    expect(fake.calls).toHaveLength(0);
  });

  it('a provider that refuses is FAILED with the provider’s reason', async () => {
    const s = await scenario('refused', { agree: true });
    const [p] = await plan(s);
    fake.next = { kind: 'rejected', reason: 'TWILIO_21211' };
    await worker.send(p.attemptId);
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED', 'FAILED:TWILIO_21211']);
  });

  it('an unanswered request records nothing, never re-sends, and expires as SEND_OUTCOME_UNKNOWN', async () => {
    const s = await scenario('ambiguous', { agree: true });
    const [p] = await plan(s);
    fake.next = { kind: 'ambiguous' };
    await worker.send(p.attemptId);
    expect((await attempt(p.attemptId)).state).toBe('QUEUED');
    await worker.send(p.attemptId); // a retry of the job
    expect(fake.calls).toHaveLength(1);
    await worker.expire(p.attemptId);
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED', 'EXPIRED:SEND_OUTCOME_UNKNOWN']);
  });

  it('the real queue delivers the job to the worker', { timeout: 30_000 }, async () => {
    const s = await scenario('realqueue', { agree: true });
    // Earlier tests left their (no-op'd) jobs queued; drain them so this one is not waiting in line.
    await prisma.$executeRawUnsafe(`DELETE FROM pgboss_notifications_e2e.job WHERE name IN ('notify.send','notify.expire') AND state = 'created'`);
    queue.setHandlers({ send: (id) => worker.send(id), expire: (id) => worker.expire(id), receipts: (id) => worker.checkReceipts(id) });
    const [p] = await plan(s);
    for (let i = 0; i < 40 && (await attempt(p.attemptId)).state === 'QUEUED'; i++) await new Promise((r) => setTimeout(r, 250));
    expect((await attempt(p.attemptId)).state).toBe('SENT');
    expect(fake.calls.filter((c) => c.attemptId === p.attemptId)).toHaveLength(1);
  });
});

describe('expiry: what silence means', () => {
  async function sent(label: string) {
    const s = await scenario(label, { agree: true });
    const [p] = await plan(s);
    await worker.send(p.attemptId);
    return p.attemptId;
  }

  it('an SMS still at SENT with no receipt is UNKNOWN ("delivery unconfirmed"), not EXPIRED', async () => {
    const id = await sent('unk');
    await worker.expire(id);
    expect(await events(id)).toEqual(['QUEUED:PLANNED', 'SENT:PROVIDER_ACCEPTED', 'UNKNOWN:NO_RECEIPT_BY_TTL']);
  });

  it('a message that never left the queue and was never claimed is EXPIRED / NEVER_SENT', async () => {
    const s = await scenario('never', { agree: true });
    const [p] = await plan(s);
    await worker.expire(p.attemptId);
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED', 'EXPIRED:NEVER_SENT']);
  });

  it('a delivered attempt is left alone', async () => {
    const id = await sent('settled');
    await callback(id, { MessageSid: (await attempt(id)).providerMessageId!, MessageStatus: 'delivered' }).expect(200);
    await worker.expire(id);
    expect((await attempt(id)).state).toBe('DELIVERED');
  });

  it('a receipt arriving after UNKNOWN is rejected and counted, not applied', async () => {
    const id = await sent('late');
    await worker.expire(id);
    const before = ledger.counters.get('rejected.ILLEGAL_TRANSITION.RECEIPT_DELIVERED') ?? 0;
    await callback(id, { MessageSid: (await attempt(id)).providerMessageId!, MessageStatus: 'delivered' }).expect(200);
    expect((await attempt(id)).state).toBe('UNKNOWN');
    expect(ledger.counters.get('rejected.ILLEGAL_TRANSITION.RECEIPT_DELIVERED')).toBe(before + 1);
  });
});

describe('the Twilio webhook', () => {
  async function sent(label: string) {
    const s = await scenario(label, { agree: true });
    const [p] = await plan(s);
    await worker.send(p.attemptId);
    return { id: p.attemptId, sid: (await attempt(p.attemptId)).providerMessageId! };
  }

  it('delivered → DELIVERED, with the provider named as the evidence', async () => {
    const { id, sid } = await sent('wh_ok');
    await callback(id, { MessageSid: sid, MessageStatus: 'delivered' }).expect(200);
    expect(await events(id)).toEqual(['QUEUED:PLANNED', 'SENT:PROVIDER_ACCEPTED', 'DELIVERED:PROVIDER_RECEIPT']);
    expect((await attempt(id)).deliveredAt).not.toBeNull();
  });

  it('undelivered → FAILED with Twilio’s error code', async () => {
    const { id, sid } = await sent('wh_fail');
    await callback(id, { MessageSid: sid, MessageStatus: 'undelivered', ErrorCode: '30003' }).expect(200);
    expect(await events(id)).toEqual(['QUEUED:PLANNED', 'SENT:PROVIDER_ACCEPTED', 'FAILED:TWILIO_30003']);
  });

  it('a callback that beats the worker records the acceptance it implies, then the receipt', async () => {
    const s = await scenario('wh_early', { agree: true });
    const [p] = await plan(s); // still QUEUED: the worker has not run
    await callback(p.attemptId, { MessageSid: 'SM_early', MessageStatus: 'delivered' }).expect(200);
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED', 'SENT:INFERRED_FROM_CALLBACK', 'DELIVERED:PROVIDER_RECEIPT']);
    expect((await attempt(p.attemptId)).providerMessageId).toBe('SM_early');
    // …and when the worker then runs it finds the attempt claimed-or-settled and sends nothing.
    await worker.send(p.attemptId);
    expect(fake.calls).toHaveLength(0);
  });

  it('a duplicate callback and a stale "sent" after DELIVERED are no-ops', async () => {
    const { id, sid } = await sent('wh_dup');
    await callback(id, { MessageSid: sid, MessageStatus: 'delivered' }).expect(200);
    await callback(id, { MessageSid: sid, MessageStatus: 'delivered' }).expect(200);
    await callback(id, { MessageSid: sid, MessageStatus: 'sent' }).expect(200);
    expect(await events(id)).toEqual(['QUEUED:PLANNED', 'SENT:PROVIDER_ACCEPTED', 'DELIVERED:PROVIDER_RECEIPT']);
  });

  it('a terminal attempt is never changed by a later callback', async () => {
    const { id, sid } = await sent('wh_term');
    await callback(id, { MessageSid: sid, MessageStatus: 'undelivered' }).expect(200);
    await callback(id, { MessageSid: sid, MessageStatus: 'delivered' }).expect(200);
    expect((await attempt(id)).state).toBe('FAILED');
  });

  it('a message id that is not the recorded one is ignored', async () => {
    const { id } = await sent('wh_mismatch');
    await callback(id, { MessageSid: 'SM_someone_else', MessageStatus: 'delivered' }).expect(200);
    expect((await attempt(id)).state).toBe('SENT');
  });

  it('an unknown attempt is ignored and counted', async () => {
    const before = ledger.counters.get('webhook.unmatched') ?? 0;
    await callback(randomUUID(), { MessageSid: 'SM_x', MessageStatus: 'delivered' }).expect(200);
    expect(ledger.counters.get('webhook.unmatched')).toBe(before + 1);
  });

  it('refuses a missing signature, a wrong signature, and a signature over the wrong URL — and applies nothing', async () => {
    const { id, sid } = await sent('wh_sig');
    const params = { MessageSid: sid, MessageStatus: 'delivered' };
    const path = `/api/v1/webhooks/twilio/status?attempt=${id}`;
    await api().post(path).type('form').send(params).expect(403);
    await callback(id, params, { token: 'wrong-token' }).expect(403);
    await callback(id, params, { url: `https://evil.example${path}` }).expect(403);
    expect((await attempt(id)).state).toBe('SENT');
  });

  it('the signed URL comes from configuration, not from the Host header', async () => {
    const { id, sid } = await sent('wh_host');
    const params = { MessageSid: sid, MessageStatus: 'delivered' };
    const path = `/api/v1/webhooks/twilio/status?attempt=${id}`;
    const signature = twilio.getExpectedTwilioSignature(TWILIO.token, `${TWILIO.url}${path}`, params);
    // A forged Host does not break a genuine callback…
    await api().post(path).set('Host', 'forged.example').set('X-Twilio-Signature', signature).type('form').send(params).expect(200);
    expect((await attempt(id)).state).toBe('DELIVERED');
    // …and a signature computed for the attacker's Host does not pass.
    const { id: id2, sid: sid2 } = await sent('wh_host2');
    const p2 = { MessageSid: sid2, MessageStatus: 'delivered' };
    const path2 = `/api/v1/webhooks/twilio/status?attempt=${id2}`;
    const forged = twilio.getExpectedTwilioSignature(TWILIO.token, `https://forged.example${path2}`, p2);
    await api().post(path2).set('Host', 'forged.example').set('X-Twilio-Signature', forged).type('form').send(p2).expect(403);
  });

  it('is not throttled: a burst of callbacks is all accepted', async () => {
    const { id, sid } = await sent('wh_burst');
    const results = await Promise.all(Array.from({ length: 30 }, () => callback(id, { MessageSid: sid, MessageStatus: 'sent' })));
    expect(results.every((r) => r.status === 200)).toBe(true);
  });
});

describe('the ledger writer', () => {
  it('a refused transition changes nothing: push cannot be DELIVERED on a provider receipt', async () => {
    const s = await scenario('ledger_push', { agree: true });
    const a = await prisma.notificationAttempt.create({ data: { incidentId: s.incidentId, recipientId: s.contactId, channel: 'push', escalationStep: 0, state: 'SENT' } });
    const out = await ledger.apply(a.id, [{ event: 'RECEIPT_DELIVERED', by: 'system', evidence: 'provider' }]);
    expect(out).toMatchObject({ applied: false, why: 'GUARD_FAILED' });
    expect((await attempt(a.id)).state).toBe('SENT');
    expect(await events(a.id)).toEqual([]);
  });

  it('an SMS cannot be acknowledged: no human can answer through it', async () => {
    const s = await scenario('ledger_ack', { agree: true });
    const [p] = await plan(s);
    await worker.send(p.attemptId);
    const out = await ledger.apply(p.attemptId, [{ event: 'ACK', by: 'contact' }]);
    expect(out).toMatchObject({ applied: false, why: 'GUARD_FAILED' });
  });

  it('an unknown attempt is reported, not thrown', async () => {
    expect(await ledger.apply(randomUUID(), [{ event: 'TTL_ELAPSED', by: 'system' }])).toEqual({ applied: false, why: 'NOT_FOUND' });
  });

  it('concurrent callbacks for one attempt are applied one after the other, never both', async () => {
    const s = await scenario('ledger_race', { agree: true });
    const [p] = await plan(s);
    await worker.send(p.attemptId);
    const sid = (await attempt(p.attemptId)).providerMessageId!;
    await Promise.all([
      callback(p.attemptId, { MessageSid: sid, MessageStatus: 'delivered' }),
      callback(p.attemptId, { MessageSid: sid, MessageStatus: 'undelivered' }),
    ]);
    const evs = await events(p.attemptId);
    expect(evs).toHaveLength(3); // QUEUED, SENT, then exactly ONE of DELIVERED / FAILED
    expect(['DELIVERED', 'FAILED']).toContain((await attempt(p.attemptId)).state);
  });
});

describe('logging', () => {
  it('no phone number, message body or signature appears in any log line', async () => {
    const phone = '+923009876543';
    const s = await scenario('logs', { agree: true, phone });
    const [p] = await plan(s);
    await worker.send(p.attemptId);
    const sid = (await attempt(p.attemptId)).providerMessageId!;
    await callback(p.attemptId, { MessageSid: sid, MessageStatus: 'delivered', To: phone, Body: 'secret body text' });
    await callback(p.attemptId, { MessageSid: sid, MessageStatus: 'delivered' }, { token: 'wrong' }); // a 403 is logged
    const all = lines.join('\n');
    expect(all).not.toContain('9876543');
    expect(all).not.toContain('secret body text');
    expect(all).not.toContain('asked Lumo to alert you');
    expect(all.toLowerCase()).not.toContain('x-twilio-signature');
  });
});


// ===================================================================== milestone 1.7b (part 1)

async function newIncident(userId: string, region = 'PK') {
  return (await prisma.emergencyIncident.create({
    data: { userId, idempotencyKey: randomUUID(), triggerType: 'manual', triggeredAt: new Date(), regionProfileId: region, state: 'NOTIFYING' },
  })).id;
}
/** Spend `n` of a user's daily budget on a channel, as if earlier incidents had. */
async function spend(userId: string, channel: 'sms' | 'voice', n: number, at = new Date()) {
  const incidentId = await newIncident(userId);
  for (let i = 0; i < n; i++) {
    await prisma.notificationAttempt.create({ data: { incidentId, recipientId: randomUUID(), channel, escalationStep: 0, state: 'SENT', reservedAt: at } });
  }
}
/** A user with several agreed contacts, in priority order. */
async function crowd(label: string, count: number, region = 'PK') {
  const s = await api().post('/api/v1/auth/signup').send({ name: `Owner ${label}`, email: `${RUN}_${label}@example.com`, password: 'password123' }).expect(201);
  const token = s.body.token as string;
  const userId = s.body.user.id as string;
  const phones = Array.from({ length: count }, (_, i) => `+92300123450${i}`);
  const put = await api().put('/api/v1/settings').set(auth(token)).send({ trustedContacts: phones.map((phone, i) => ({ name: `C${i}`, phone })) }).expect(200);
  const ids = put.body.trustedContacts.map((c: { id: string }) => c.id) as string[];
  for (const id of ids) {
    const inv = await api().post(`/api/v1/trusted-contacts/${id}/invite`).set(auth(token)).expect(201);
    await api().post(`${inv.body.path}/accept`).expect(200);
  }
  return { token, userId, ids, incidentId: await newIncident(userId, region) };
}

describe('the claim is not taken until the provider is about to be called', () => {
  it('a lookup that throws leaves the attempt unclaimed, so the retry still sends', async () => {
    const s = await scenario('claimfix', { agree: true });
    const [p] = await plan(s);
    const contacts = app.get(TrustedContactsService);
    const original = contacts.findActive.bind(contacts);
    let first = true;
    contacts.findActive = async (...args: Parameters<typeof original>) => {
      if (first) { first = false; throw new Error('database blip'); }
      return original(...args);
    };
    try {
      await expect(worker.send(p.attemptId)).rejects.toThrow('database blip');
      expect((await attempt(p.attemptId)).claimedAt).toBeNull(); // nothing was sent, so nothing is claimed
      await worker.send(p.attemptId); // the job's retry
    } finally {
      contacts.findActive = original;
    }
    expect((await attempt(p.attemptId)).state).toBe('SENT');
    expect(fake.calls).toHaveLength(1);
  });
});

describe('region gating, by the incident’s region', () => {
  it('US SMS waits for A2P 10DLC registration: NOT_ATTEMPTED / REGISTRATION_INCOMPLETE, nothing sent', async () => {
    const s = await scenario('us', { agree: true, region: 'US' });
    const [p] = await plan(s);
    expect(p).toMatchObject({ outcome: 'not_attempted', reason: 'REGISTRATION_INCOMPLETE' });
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED', 'FAILED:REGISTRATION_INCOMPLETE']);
    expect(fake.calls).toHaveLength(0);
  });

  it('a channel the market does not list is off there: PK has no voice', async () => {
    const s = await scenario('pkvoice', { agree: true, region: 'PK' });
    const [p] = await plan(s, ['voice']);
    expect(p).toMatchObject({ outcome: 'not_attempted', reason: 'CHANNEL_DISABLED_FOR_REGION' });
  });

  it('the incident’s region decides, not the account’s', async () => {
    const s = await scenario('acct', { agree: true, region: 'PK' });
    await prisma.user.update({ where: { id: s.userId }, data: { regionProfileId: 'US' } }); // account says US
    const [p] = await plan(s);
    expect(p.outcome).toBe('queued'); // the DEVICE is in PK
  });

  it('with no profile for the incident, nothing is gated, and the strictest known cap applies', async () => {
    const s = await scenario('noprofile', { agree: true, region: 'UNRESOLVED' });
    await spend(s.userId, 'sms', 29); // the strictest sms cap among known profiles is 30
    const [p] = await plan(s);
    expect(p.outcome).toBe('queued');
    const s2 = await scenario('noprofile2', { agree: true, region: 'UNRESOLVED' });
    await spend(s2.userId, 'sms', 30);
    expect((await plan(s2))[0]).toMatchObject({ outcome: 'capped', reason: 'SPEND_CAP' });
  });
});

describe('the daily cap (PLAT-5)', () => {
  it('budget goes to contacts in priority order; the rest are FAILED / SPEND_CAP and the user must be told', async () => {
    const c = await crowd('cap_order', 3);
    await spend(c.userId, 'sms', 28); // PK sms cap is 30: two left
    const planned = await dispatch.plan({ incidentId: c.incidentId, userId: c.userId, channels: ['sms'] });
    expect(planned.map((p) => [p.recipientId, p.outcome])).toEqual([[c.ids[0], 'queued'], [c.ids[1], 'queued'], [c.ids[2], 'capped']]);
    const capped = planned[2];
    expect(await events(capped.attemptId)).toEqual(['QUEUED:PLANNED', 'FAILED:SPEND_CAP']);
    expect((await attempt(capped.attemptId)).reservedAt).toBeNull(); // a capped attempt costs no budget
  });

  it('an all-capped plan rolls up to ALL_CHANNELS_FAILED', async () => {
    const c = await crowd('cap_all', 2);
    await spend(c.userId, 'sms', 30);
    const planned = await dispatch.plan({ incidentId: c.incidentId, userId: c.userId, channels: ['sms'] });
    expect(planned.every((p) => p.outcome === 'capped')).toBe(true);
    const rows = await prisma.notificationAttempt.findMany({ where: { incidentId: c.incidentId } });
    expect(rollupIncident(rows.map((r) => ({ recipientId: r.recipientId, channel: r.channel, state: r.state }))).outcome).toBe('ALL_CHANNELS_FAILED');
  });

  it('skipped and capped attempts spend nothing; only queued ones are reserved', async () => {
    const s = await scenario('cap_skip'); // never invited
    const before = await prisma.notificationAttempt.count({ where: { incident: { userId: s.userId }, reservedAt: { not: null } } });
    await plan(s);
    expect(await prisma.notificationAttempt.count({ where: { incident: { userId: s.userId }, reservedAt: { not: null } } })).toBe(before);
  });

  it('reservations older than 24 hours no longer count, and another user’s never do', async () => {
    const c = await crowd('cap_window', 1);
    await spend(c.userId, 'sms', 30, new Date(Date.now() - 25 * 60 * 60 * 1000)); // yesterday
    const other = await scenario('cap_other');
    await spend(other.userId, 'sms', 30);
    const [p] = await dispatch.plan({ incidentId: c.incidentId, userId: c.userId, channels: ['sms'] });
    expect(p.outcome).toBe('queued');
  });

  it('concurrent plans for one user cannot overspend the budget', async () => {
    const c = await crowd('cap_race', 1);
    await spend(c.userId, 'sms', 29); // exactly one left
    const incidents = await Promise.all(Array.from({ length: 5 }, () => newIncident(c.userId)));
    const results = await Promise.all(incidents.map((incidentId) => dispatch.plan({ incidentId, userId: c.userId, channels: ['sms'] })));
    const outcomes = results.flat().map((p) => p.outcome);
    expect(outcomes.filter((o) => o === 'queued')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'capped')).toHaveLength(4);
  });

  it('a plan for another user’s incident is refused', async () => {
    const a = await scenario('cap_owner', { agree: true });
    const b = await scenario('cap_intruder', { agree: true });
    await expect(dispatch.plan({ incidentId: a.incidentId, userId: b.userId, channels: ['sms'] })).rejects.toThrow(/does not belong/);
  });
});

describe('voice', () => {
  const voicePlan = async (label: string) => {
    const s = await scenario(label, { agree: true, region: 'UNRESOLVED' }); // no profile: PK does not list voice
    const [p] = await plan(s, ['voice']);
    return { s, id: p.attemptId };
  };
  const voiceCallback = (attemptId: string, params: Record<string, string>) => {
    const path = `/api/v1/webhooks/twilio/voice-status?attempt=${attemptId}`;
    return api().post(path).set('X-Twilio-Signature', twilio.getExpectedTwilioSignature(TWILIO.token, `${TWILIO.url}${path}`, params)).type('form').send(params);
  };

  it('places one call and records SENT — never answered, never acknowledged', async () => {
    const { s, id } = await voicePlan('v_ok');
    fakeVoice.next = { kind: 'accepted', providerMessageId: 'CA1', status: 'queued' };
    await worker.send(id);
    expect(await events(id)).toEqual(['QUEUED:PLANNED', 'SENT:PROVIDER_ACCEPTED']);
    expect(fakeVoice.calls).toEqual([{ to: s.phone, script: expect.stringContaining('automated call from Lumo'), attemptId: id }]);
    await worker.send(id);
    expect(fakeVoice.calls).toHaveLength(1); // at most once
  });

  it('without a caller number the voice provider is "not configured", whatever SMS has', async () => {
    const { id } = await voicePlan('v_conf');
    fakeVoice.isConfigured = false;
    await worker.send(id);
    expect(await events(id)).toEqual(['QUEUED:PLANNED', 'FAILED:PROVIDER_NOT_CONFIGURED']);
  });

  it.each([['busy', 'VOICE_BUSY'], ['no-answer', 'VOICE_NO_ANSWER'], ['failed', 'VOICE_FAILED'], ['canceled', 'VOICE_CANCELED']])('%s → FAILED / %s', async (status, reason) => {
    const { id } = await voicePlan(`v_${status}`);
    await worker.send(id);
    await voiceCallback(id, { CallSid: (await attempt(id)).providerMessageId!, CallStatus: status }).expect(200);
    expect(await events(id)).toEqual(['QUEUED:PLANNED', 'SENT:PROVIDER_ACCEPTED', `FAILED:${reason}`]);
  });

  it('answered is a fact on the attempt, not a state: it stays SENT and settles UNKNOWN', async () => {
    const { id } = await voicePlan('v_answered');
    await worker.send(id);
    const sid = (await attempt(id)).providerMessageId!;
    await voiceCallback(id, { CallSid: sid, CallStatus: 'in-progress' }).expect(200);
    await voiceCallback(id, { CallSid: sid, CallStatus: 'completed' }).expect(200);
    const a = await attempt(id);
    expect(a.state).toBe('SENT');
    expect(a.providerStatus).toBe('completed');
    await worker.expire(id);
    expect(await events(id)).toEqual(['QUEUED:PLANNED', 'SENT:PROVIDER_ACCEPTED', 'UNKNOWN:NO_RECEIPT_BY_TTL']);
  });

  it('a call cannot be acknowledged: no person can answer through it', async () => {
    const { id } = await voicePlan('v_ack');
    await worker.send(id);
    expect(await ledger.apply(id, [{ event: 'ACK', by: 'contact' }])).toMatchObject({ applied: false, why: 'GUARD_FAILED' });
  });

  it('the voice webhook needs a valid signature too', async () => {
    const { id } = await voicePlan('v_sig');
    await worker.send(id);
    const path = `/api/v1/webhooks/twilio/voice-status?attempt=${id}`;
    await api().post(path).type('form').send({ CallSid: 'x', CallStatus: 'busy' }).expect(403);
    expect((await attempt(id)).state).toBe('SENT');
  });
});


// ===================================================================== milestone 1.7b (part 2): push

const expoToken = () => `ExponentPushToken[${randomUUID().replace(/-/g, '').slice(0, 22)}]`;

/** A second Lumo user who will be the contact. Returns their login. */
async function signedUp(label: string) {
  const s = await api().post('/api/v1/auth/signup').send({ name: `Contact ${label}`, email: `${RUN}_${label}@example.com`, password: 'password123' }).expect(201);
  return { token: s.body.token as string, id: s.body.user.id as string };
}
async function registerDevice(token: string, pushToken = expoToken()) {
  const r = await api().post('/api/v1/devices').set(auth(token)).send({ platform: 'android', osVersion: '14', pushToken }).expect(201);
  return { deviceId: r.body.id as string, pushToken };
}
/** An owner with an agreed contact who has claimed their invite from a signed-in account. */
async function claimed(label: string, opts: { devices?: number; region?: string } = {}) {
  const s = await scenario(label, { agree: false, region: opts.region });
  const inv = await api().post(`/api/v1/trusted-contacts/${s.contactId}/invite`).set(auth(s.token)).expect(201);
  const claimer = await signedUp(`${label}_c`);
  await api().post(`${inv.body.path}/claim`).set(auth(claimer.token)).expect(200);
  const tokens: string[] = [];
  for (let i = 0; i < (opts.devices ?? 1); i++) tokens.push((await registerDevice(claimer.token)).pushToken);
  return { ...s, inviteToken: (inv.body.path as string).split('/').pop()!, invitePath: inv.body.path as string, claimer, tokens };
}
const postReceipt = (token: string, attemptId: string, kind: 'delivered' | 'acknowledged') =>
  api().post(`/api/v1/notifications/${attemptId}/receipt`).set(auth(token)).send({ kind });

describe('devices: a push token belongs to one user at a time', () => {
  it('registers a device and never echoes the token', async () => {
    const u = await signedUp('dev1');
    const r = await api().post('/api/v1/devices').set(auth(u.token)).send({ platform: 'ios', osVersion: '17.2', pushToken: expoToken() }).expect(201);
    expect(Object.keys(r.body)).toEqual(['id']);
  });

  it('a second account registering the same token takes it, and the first loses it', async () => {
    const a = await signedUp('dev_a');
    const b = await signedUp('dev_b');
    const token = expoToken();
    const first = await registerDevice(a.token, token);
    await registerDevice(b.token, token);
    expect((await prisma.device.findUniqueOrThrow({ where: { id: first.deviceId } })).revokedAt).not.toBeNull();
    expect(await prisma.device.count({ where: { pushToken: token, revokedAt: null } })).toBe(1);
  });

  it('the database refuses two live owners of one token, whatever the service does', async () => {
    const a = await signedUp('dev_idx_a');
    const b = await signedUp('dev_idx_b');
    const token = expoToken();
    const row = (userId: string) => prisma.device.create({ data: { userId, platform: 'android', osVersion: '14', pushToken: token, capabilities: {} } });
    await row(a.id);
    await expect(row(b.id)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('logout: a user revokes their own device, and not anyone else’s', async () => {
    const a = await signedUp('dev_out_a');
    const b = await signedUp('dev_out_b');
    const d = await registerDevice(a.token);
    await api().delete(`/api/v1/devices/${d.deviceId}`).set(auth(b.token)).expect(404);
    await api().delete(`/api/v1/devices/${d.deviceId}`).set(auth(a.token)).expect(204);
    expect((await prisma.device.findUniqueOrThrow({ where: { id: d.deviceId } })).revokedAt).not.toBeNull();
  });

  it('refuses anything that is not an Expo push token, and needs a login', async () => {
    const u = await signedUp('dev_bad');
    await api().post('/api/v1/devices').set(auth(u.token)).send({ platform: 'ios', osVersion: '17', pushToken: 'fcm:abc' }).expect(400);
    await api().post('/api/v1/devices').send({ platform: 'ios', osVersion: '17', pushToken: expoToken() }).expect(401);
  });
});

describe('claiming a contact while signed in', () => {
  it('links the claimer’s account to the contact, accepting the role if they had not yet', async () => {
    const c = await claimed('cl_ok');
    const row = await prisma.trustedContact.findUniqueOrThrow({ where: { id: c.contactId } });
    expect(row.linkedUserId).toBe(c.claimer.id);
    expect(row.consentId).not.toBeNull(); // claiming agreed to the role, like the page does
  });

  it('works after the contact already agreed in the browser', async () => {
    const s = await scenario('cl_after', { agree: true });
    const inv = await api().post(`/api/v1/trusted-contacts/${s.contactId}/invite`).set(auth(s.token));
    expect([201, 409]).toContain(inv.status); // already agreed: no new link is minted
    const link = await prisma.contactInvite.findFirstOrThrow({ where: { contactId: s.contactId } });
    expect(link.acceptedAt).not.toBeNull();
  });

  it('the first claim wins: another account is refused, the same account is idempotent', async () => {
    const c = await claimed('cl_first');
    const other = await signedUp('cl_first_other');
    await api().post(`${c.invitePath}/claim`).set(auth(other.token)).expect(409);
    await api().post(`${c.invitePath}/claim`).set(auth(c.claimer.token)).expect(200);
    expect((await prisma.trustedContact.findUniqueOrThrow({ where: { id: c.contactId } })).linkedUserId).toBe(c.claimer.id);
  });

  it('the account that added the contact cannot claim it', async () => {
    const s = await scenario('cl_self');
    const inv = await api().post(`/api/v1/trusted-contacts/${s.contactId}/invite`).set(auth(s.token)).expect(201);
    await api().post(`${inv.body.path}/claim`).set(auth(s.token)).expect(409);
    expect((await prisma.trustedContact.findUniqueOrThrow({ where: { id: s.contactId } })).linkedUserId).toBeNull();
  });

  it('needs a login, and an unknown or dead link is the same 404', async () => {
    const c = await claimed('cl_dead');
    await api().post(`${c.invitePath}/claim`).expect(401);
    const other = await signedUp('cl_dead_other');
    await api().post(`/api/v1/contacts/invites/${'x'.repeat(43)}/claim`).set(auth(other.token)).expect(404);
  });

  it.each([
    ['the contact withdraws', async (c: Awaited<ReturnType<typeof claimed>>) => { await api().post(`${c.invitePath}/revoke`).expect(200); }],
    ['their number changes', async (c: Awaited<ReturnType<typeof claimed>>) => { await api().put('/api/v1/settings').set(auth(c.token)).send({ trustedContacts: [{ id: c.contactId, name: 'Ayesha', phone: '+923009990000' }] }).expect(200); }],
    ['they are removed', async (c: Awaited<ReturnType<typeof claimed>>) => { await api().put('/api/v1/settings').set(auth(c.token)).send({ trustedContacts: [] }).expect(200); }],
  ])('the link is cleared when %s', async (_name, act) => {
    const c = await claimed(`cl_clear_${_name.replace(/\W/g, '').slice(0, 8)}`);
    await act(c);
    expect((await prisma.trustedContact.findUniqueOrThrow({ where: { id: c.contactId } })).linkedUserId).toBeNull();
  });

  it('is never shown to the account that added the contact', async () => {
    const c = await claimed('cl_hidden');
    const settings = await api().get('/api/v1/settings').set(auth(c.token)).expect(200);
    expect(JSON.stringify(settings.body)).not.toContain(c.claimer.id);
    expect(JSON.stringify(settings.body)).not.toMatch(/linked/i);
  });
});

describe('sending push', () => {
  it('a contact who has not claimed their invite has no address: NO_ADDRESS, nothing sent', async () => {
    const s = await scenario('pu_none', { agree: true });
    const [p] = await plan(s, ['push']);
    await worker.send(p.attemptId);
    expect(p).toMatchObject({ outcome: 'not_attempted', reason: 'NO_ADDRESS' }); // decided at plan time: no budget spent
    await worker.send(p.attemptId);
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED', 'FAILED:NO_ADDRESS']);
    expect(fakePush.calls).toHaveLength(0);
  });

  it('a device registered under the contact’s own email or phone is NOT an address', async () => {
    const s = await scenario('pu_infer', { agree: true });
    const lookalike = await api().post('/api/v1/auth/signup').send({ name: 'Ayesha', email: `${RUN}_pu_infer_lookalike@example.com`, password: 'password123' }).expect(201);
    await registerDevice(lookalike.body.token);
    const [p] = await plan(s, ['push']);
    expect(p).toMatchObject({ outcome: 'not_attempted', reason: 'NO_ADDRESS' });
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED', 'FAILED:NO_ADDRESS']);
  });

  it('a device revoked between planning and sending is caught at send time', async () => {
    const c = await claimed('pu_late_revoke');
    const [p] = await plan(c, ['push']);
    await prisma.device.updateMany({ where: { pushToken: { in: c.tokens } }, data: { revokedAt: new Date() } });
    await worker.send(p.attemptId);
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED', 'FAILED:NO_ADDRESS']);
    expect(fakePush.calls).toHaveLength(0);
  });

  it('sends to the linked account’s live devices with ids and the sender’s name only; SENT, never DELIVERED', async () => {
    const c = await claimed('pu_ok', { devices: 2 });
    const [p] = await plan(c, ['push']);
    await worker.send(p.attemptId);
    const a = await attempt(p.attemptId);
    expect(a.state).toBe('SENT');
    expect(a.providerMessageId!.split(',')).toHaveLength(2); // both devices' tickets, one attempt
    expect(a.deliveredAt).toBeNull();
    expect(fakePush.calls).toHaveLength(1);
    expect(new Set(fakePush.calls[0].tokens)).toEqual(new Set(c.tokens));
    expect(fakePush.calls[0]).toMatchObject({ attemptId: p.attemptId, title: 'Lumo alert', body: expect.stringContaining('Owner pu_ok') });
    expect(JSON.stringify(fakePush.calls[0])).not.toContain('923001234567'); // no number in the payload
  });

  it('a revoked device is not sent to', async () => {
    const c = await claimed('pu_revoked', { devices: 2 });
    await prisma.device.updateMany({ where: { pushToken: c.tokens[0] }, data: { revokedAt: new Date() } });
    const [p] = await plan(c, ['push']);
    await worker.send(p.attemptId);
    expect(fakePush.calls[0].tokens).toEqual([c.tokens[1]]);
  });

  it('a dead token is revoked, and the attempt still counts as sent if another ticket was accepted', async () => {
    const c = await claimed('pu_dead', { devices: 2 });
    const [p] = await plan(c, ['push']);
    fakePush.next = { kind: 'accepted', tickets: [{ token: c.tokens[1], id: 'T_ok' }], deadTokens: [c.tokens[0]] };
    await worker.send(p.attemptId);
    expect((await attempt(p.attemptId)).state).toBe('SENT');
    expect((await prisma.device.findFirstOrThrow({ where: { pushToken: c.tokens[0] } })).revokedAt).not.toBeNull();
    expect((await prisma.device.findFirstOrThrow({ where: { pushToken: c.tokens[1] } })).revokedAt).toBeNull();
  });

  it('every ticket refused → FAILED with the service’s reason', async () => {
    const c = await claimed('pu_refused');
    const [p] = await plan(c, ['push']);
    fakePush.next = { kind: 'rejected', reason: 'EXPO_DeviceNotRegistered', deadTokens: c.tokens };
    await worker.send(p.attemptId);
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED', 'FAILED:EXPO_DeviceNotRegistered']);
  });

  it('not configured → NOT_ATTEMPTED, never accepted; and at most one send per attempt', async () => {
    const c = await claimed('pu_conf');
    const [p] = await plan(c, ['push']);
    fakePush.isConfigured = false;
    await worker.send(p.attemptId);
    expect(await events(p.attemptId)).toEqual(['QUEUED:PLANNED', 'FAILED:PROVIDER_NOT_CONFIGURED']);
    fakePush.isConfigured = true;
    const c2 = await claimed('pu_once');
    const [p2] = await plan(c2, ['push']);
    await Promise.all([worker.send(p2.attemptId), worker.send(p2.attemptId)]);
    expect(fakePush.calls.filter((x) => x.attemptId === p2.attemptId)).toHaveLength(1);
  });

  it('planning a push reserves budget like any send, and queues a receipt check', async () => {
    const c = await claimed('pu_plan');
    const [p] = await plan(c, ['push']);
    expect((await attempt(p.attemptId)).reservedAt).not.toBeNull();
    const jobs = await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM pgboss_notifications_e2e.job WHERE data->>'attemptId' = $1 ORDER BY name`, p.attemptId);
    expect(jobs.map((j) => j.name)).toEqual(['notify.expire', 'notify.receipts', 'notify.send']);
  });
});

describe('push: what the service and the device each tell us', () => {
  async function sentPush(label: string) {
    const c = await claimed(label);
    const [p] = await plan(c, ['push']);
    await worker.send(p.attemptId);
    return { c, id: p.attemptId, ids: (await attempt(p.attemptId)).providerMessageId!.split(',') };
  }

  it('an ok receipt from the service is a fact, never delivery: the attempt stays SENT', async () => {
    const { id, ids } = await sentPush('pr_ok');
    fakePush.receiptMap = new Map(ids.map((i) => [i, { status: 'ok' as const }]));
    await worker.checkReceipts(id);
    const a = await attempt(id);
    expect(a.state).toBe('SENT');
    expect(a.providerStatus).toBe('push_service_accepted');
    expect(a.deliveredAt).toBeNull();
  });

  it('every receipt an error → FAILED with the service’s reason; a mix is left alone', async () => {
    const { id, ids } = await sentPush('pr_err');
    fakePush.receiptMap = new Map(ids.map((i) => [i, { status: 'error' as const, error: 'MessageRateExceeded' }]));
    await worker.checkReceipts(id);
    expect(await events(id)).toEqual(['QUEUED:PLANNED', 'SENT:PROVIDER_ACCEPTED', 'FAILED:EXPO_MessageRateExceeded']);
  });

  it('no receipt yet changes nothing; an unavailable service throws so the queue retries', async () => {
    const { id } = await sentPush('pr_wait');
    await worker.checkReceipts(id);
    expect((await attempt(id)).state).toBe('SENT');
    fakePush.receiptMap = null;
    await expect(worker.checkReceipts(id)).rejects.toThrow();
  });

  it('a push that nobody confirms settles UNKNOWN — "sent, not confirmed" — not EXPIRED', async () => {
    const { id } = await sentPush('pr_silent');
    await worker.expire(id);
    expect(await events(id)).toEqual(['QUEUED:PLANNED', 'SENT:PROVIDER_ACCEPTED', 'UNKNOWN:NO_RECEIPT_BY_TTL']);
  });

  it('the linked contact’s device reports delivery: DELIVERED, by the device', async () => {
    const { c, id } = await sentPush('pr_dev');
    expect((await postReceipt(c.claimer.token, id, 'delivered').expect(200)).body).toEqual({ recorded: true });
    expect(await events(id)).toEqual(['QUEUED:PLANNED', 'SENT:PROVIDER_ACCEPTED', 'DELIVERED:DEVICE_RECEIPT']);
  });

  it('"I’m responding" acknowledges, and so does a LATE one after the ledger settled UNKNOWN', async () => {
    const { c, id } = await sentPush('pr_ack');
    await worker.expire(id);
    expect((await postReceipt(c.claimer.token, id, 'acknowledged').expect(200)).body).toEqual({ recorded: true });
    expect((await attempt(id)).state).toBe('ACKNOWLEDGED');
  });

  it('a late DELIVERED after UNKNOWN is not recorded (it adds nothing), and a duplicate is harmless', async () => {
    const { c, id } = await sentPush('pr_late');
    await worker.expire(id);
    expect((await postReceipt(c.claimer.token, id, 'delivered').expect(200)).body).toEqual({ recorded: false });
    expect((await attempt(id)).state).toBe('UNKNOWN');
    const d = await sentPush('pr_dup');
    await postReceipt(d.c.claimer.token, d.id, 'delivered').expect(200);
    expect((await postReceipt(d.c.claimer.token, d.id, 'delivered').expect(200)).body).toEqual({ recorded: false });
  });

  it('only the linked account may report; everything else is one 404', async () => {
    const { c, id } = await sentPush('pr_who');
    const stranger = await signedUp('pr_who_stranger');
    const bodies = [
      await postReceipt(stranger.token, id, 'delivered'),          // not the contact
      await postReceipt(c.token, id, 'delivered'),                  // the owner, not the contact
      await postReceipt(c.claimer.token, randomUUID(), 'delivered'), // no such attempt
    ];
    for (const r of bodies) expect(r.status).toBe(404);
    // Same answer for all three (the per-request `reference` id differs, by design).
    expect(new Set(bodies.map((r) => `${r.status} ${r.body.message}`)).size).toBe(1);
    await api().post(`/api/v1/notifications/${id}/receipt`).send({ kind: 'delivered' }).expect(401);
    expect((await attempt(id)).state).toBe('SENT');
  });

  it('a contact who withdrew can no longer report', async () => {
    const { c, id } = await sentPush('pr_withdrawn');
    await api().post(`${c.invitePath}/revoke`).expect(200);
    await postReceipt(c.claimer.token, id, 'acknowledged').expect(404);
  });

  it('only a push attempt can be reported by a device', async () => {
    const c = await claimed('pr_sms');
    const [p] = await plan(c, ['sms']);
    await postReceipt(c.claimer.token, p.attemptId, 'delivered').expect(404);
  });

  it('rejects any other kind of report', async () => {
    const { c, id } = await sentPush('pr_kind');
    await api().post(`/api/v1/notifications/${id}/receipt`).set(auth(c.claimer.token)).send({ kind: 'failed' }).expect(400);
  });
});
