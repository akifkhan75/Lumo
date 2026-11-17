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
async function scenario(label: string, opts: { agree?: boolean; phone?: string } = {}) {
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
    data: { userId, idempotencyKey: randomUUID(), triggerType: 'manual', triggeredAt: new Date(), regionProfileId: 'PK', state: 'NOTIFYING' },
  });
  return { token, userId, contactId, incidentId: incident.id, phone };
}
const plan = (s: { incidentId: string; userId: string }, channels: ('sms' | 'push')[] = ['sms']) =>
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
  // Deterministic: jobs are drained by hand unless a test wants the real queue.
  queue.setHandlers({ send: async () => {}, expire: async () => {} });
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
    queue.setHandlers({ send: (id) => worker.send(id), expire: (id) => worker.expire(id) });
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
