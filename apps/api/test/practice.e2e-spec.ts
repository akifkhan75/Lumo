/**
 * Practice Mode (docs/specs/PRACTICE_MODE.md, RES-18) against real Postgres and the real HTTP pipeline. The SMS and push providers are
 * fakes that RECORD every call, so "nobody was contacted" is asserted as zero calls, and the boundary is proven where it is enforced:
 * in the database, in the planner and in the worker.
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
import { DispatchService } from '../src/notifications/dispatch.service';
import { PracticeBoundaryError, assertReal } from '../src/notifications/practice-boundary';
import { PUSH_PROVIDER, type PushProvider } from '../src/notifications/push/push-provider';
import { SMS_PROVIDER, type SmsOutcome, type SmsProvider } from '../src/notifications/sms/sms-provider';

process.env.NOTIFICATIONS_QUEUE = 'on';
process.env.NOTIFICATIONS_QUEUE_SCHEMA = 'pgboss_practice_e2e';
const RUN = `pr_${Date.now()}_${randomUUID().slice(0, 6)}`;

class FakeSms implements SmsProvider {
  calls: unknown[] = [];
  configured() { return true; }
  async send(r: unknown): Promise<SmsOutcome> { this.calls.push(r); return { kind: 'accepted', providerMessageId: 'SM', status: 'queued' }; }
}
class FakePush implements PushProvider {
  calls: unknown[] = [];
  configured() { return true; }
  async send(r: { tokens: readonly string[] }) { this.calls.push(r); return { kind: 'accepted' as const, tickets: r.tokens.map((token, i) => ({ token, id: `T${i}` })), deadTokens: [] }; }
  async receipts() { return new Map(); }
}
const sms = new FakeSms();
const push = new FakePush();

let app: INestApplication;
let prisma: PrismaClient;
let dispatch: DispatchService;

const api = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const key = () => `k-${randomUUID()}`;
const expoToken = () => `ExponentPushToken[${randomUUID().replace(/-/g, '').slice(0, 22)}]`;

async function owner(label: string, o: { sms?: boolean; contacts?: number; agree?: boolean } = {}) {
  const s = await api().post('/api/v1/auth/signup').send({ name: `Owner ${label}`, email: `${RUN}_${label}@example.com`, password: 'password123' }).expect(201);
  const token = s.body.token as string;
  const userId = s.body.user.id as string;
  await prisma.user.update({ where: { id: userId }, data: { sendSmsOnSos: o.sms ?? false } });
  const n = o.contacts ?? 2;
  const contactIds: string[] = [];
  if (n > 0) {
    const put = await api().put('/api/v1/settings').set(auth(token)).send({ trustedContacts: Array.from({ length: n }, (_, i) => ({ name: `C${i}`, phone: `+92300123450${i}` })) }).expect(200);
    contactIds.push(...put.body.trustedContacts.map((c: { id: string }) => c.id));
    if (o.agree !== false) {
      for (const id of contactIds) {
        const inv = await api().post(`/api/v1/trusted-contacts/${id}/invite`).set(auth(token)).expect(201);
        await api().post(`${inv.body.path}/accept`).expect(200);
      }
    }
  }
  return { token, userId, contactIds };
}
const body = (over: Record<string, unknown> = {}) => ({ triggerType: 'manual', triggeredAt: new Date().toISOString(), mode: 'practice', ...over });
const sos = (token: string, b: Record<string, unknown> = body(), k = key()) => api().post('/api/v1/sos').set(auth(token)).set('Idempotency-Key', k).send(b);
const get = (token: string, id: string) => api().get(`/api/v1/incidents/${id}`).set(auth(token));
const realAttempts = (userId: string) => prisma.notificationAttempt.count({ where: { incident: { userId } } });
const nobodyContacted = () => { expect(sms.calls).toHaveLength(0); expect(push.calls).toHaveLength(0); };

beforeAll(async () => {
  prisma = new PrismaClient();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getOptionsToken()).useValue([{ name: 'short', ttl: 1000, limit: 1_000_000 }])
    .overrideProvider(SMS_PROVIDER).useValue(sms)
    .overrideProvider(PUSH_PROVIDER).useValue(push)
    .compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  dispatch = app.get(DispatchService);
});

beforeEach(() => {
  sms.calls = [];
  push.calls = [];
  // The REAL send/expire/receipt handlers are left in place on purpose: if a practice run queued anything, it would be sent here.
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

describe('a practice run', () => {
  it('runs the whole path, labelled, and contacts nobody (even with SMS on and every contact agreed)', async () => {
    const o = await owner('full', { sms: true, contacts: 2 });
    const r = await sos(o.token).expect(201);
    expect(r.body.mode).toBe('practice');
    expect(r.body.state).not.toBe('CREATED');
    expect(r.body.attempts.length).toBeGreaterThan(0);
    for (const a of r.body.attempts) expect(a.simulated).toBe(true);
    await new Promise((res) => setTimeout(res, 1500)); // any queued job would have run by now
    nobodyContacted();
    expect(await realAttempts(o.userId)).toBe(0);
    expect(await prisma.practiceAttempt.count({ where: { incidentId: r.body.id } })).toBe(r.body.attempts.length);
  });

  it('includes one simulated failure when there are two or more attempts, and says so in the reason', async () => {
    const o = await owner('fail', { contacts: 2 });
    const r = await sos(o.token).expect(201);
    const failed = r.body.attempts.filter((a: { state: string }) => a.state === 'FAILED');
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBe('SIMULATED_FAILURE');
    expect(r.body.outcome).toBe('PARTIALLY_NOTIFIED');
  });

  it('shows a contact who may not be alerted as not tried, with the real reason, as the real ledger would', async () => {
    const o = await owner('noconsent', { contacts: 1, agree: false });
    const r = await sos(o.token).expect(201);
    expect(r.body.attempts[0]).toMatchObject({ simulated: true, state: 'FAILED' });
    expect(r.body.attempts[0].reason).toMatch(/^CONSENT_/);
    expect(r.body.state).toBe('ALL_CHANNELS_FAILED'); // nobody to try is shown as what it is, not as success
    nobodyContacted();
  });

  it('with no contacts at all shows an empty ledger and no recipients', async () => {
    const o = await owner('none', { contacts: 0 });
    const r = await sos(o.token).expect(201);
    expect(r.body.attempts).toEqual([]);
    expect(r.body.state).toBe('ALL_CHANNELS_FAILED');
  });

  it('keeps no position (it exercises "a position was available" without storing where the person was)', async () => {
    const o = await owner('loc', { contacts: 1 });
    const r = await sos(o.token, body({ location: { latitude: 33.6844, longitude: 73.0479, accuracyM: 15, capturedAt: Date.now() - 2000 } })).expect(201);
    expect(r.body.locationAvailable).toBe(true);
    expect(await prisma.locationSnapshot.count({ where: { incidentId: r.body.id } })).toBe(0);
  });

  it('a replay with the same key returns the same rehearsal and does not run it twice', async () => {
    const o = await owner('replay', { contacts: 2 });
    const k = key();
    const a = await sos(o.token, body(), k).expect(201);
    const b = await sos(o.token, body(), k).expect(200);
    expect(b.body.id).toBe(a.body.id);
    expect(await prisma.practiceAttempt.count({ where: { incidentId: a.body.id } })).toBe(a.body.attempts.length);
  });

  it('can be cancelled during its countdown, and then it does not run', async () => {
    const o = await owner('cancel', { contacts: 2 });
    const r = await sos(o.token, body({ triggerType: 'shake' })).expect(201);
    expect(r.body.state).toBe('CREATED');
    const c = await api().post(`/api/v1/incidents/${r.body.id}/cancel`).set(auth(o.token)).expect(200);
    expect(c.body.state).toBe('CANCELLED');
    expect(await prisma.practiceAttempt.count({ where: { incidentId: r.body.id } })).toBe(0);
    nobodyContacted();
  });

  it('resolving tells nobody it ended (nobody was told it began)', async () => {
    const o = await owner('resolve', { sms: true, contacts: 2 });
    const r = await sos(o.token).expect(201);
    const done = await api().post(`/api/v1/incidents/${r.body.id}/resolve`).set(auth(o.token)).expect(200);
    expect(done.body.mode).toBe('practice');
    await new Promise((res) => setTimeout(res, 1000));
    nobodyContacted();
    expect(await realAttempts(o.userId)).toBe(0);
  });

  it('ignores a journey id: a rehearsal is never tied to a real journey', async () => {
    const o = await owner('session', { contacts: 1 });
    const r = await sos(o.token, body({ sessionId: randomUUID() })).expect(201);
    expect((await prisma.emergencyIncident.findUniqueOrThrow({ where: { id: r.body.id } })).sessionId).toBeNull();
  });

  it('is private to its owner like any incident', async () => {
    const a = await owner('own_a', { contacts: 1 });
    const b = await owner('own_b', { contacts: 1 });
    const r = await sos(a.token).expect(201);
    await get(b.token, r.body.id).expect(404);
  });

  it('does not change what a real SOS does or shows', async () => {
    const o = await owner('real', { contacts: 1 });
    const r = await sos(o.token, body({ mode: 'real' })).expect(201);
    expect(r.body.mode).toBe('real');
    for (const a of r.body.attempts) expect(a.simulated).toBe(false);
    expect(await prisma.practiceAttempt.count({ where: { incidentId: r.body.id } })).toBe(0);
    expect(await realAttempts(o.userId)).toBeGreaterThan(0);
  });

  it('a contact has no part in a rehearsal and cannot even tell one exists', async () => {
    const o = await owner('contact', { contacts: 1 });
    const r = await sos(o.token).expect(201);
    const other = await api().post('/api/v1/auth/signup').send({ name: 'Someone', email: `${RUN}_someone@example.com`, password: 'password123' }).expect(201);
    await api().post(`/api/v1/incidents/${r.body.id}/ack`).set(auth(other.body.token)).expect(404);
  });
});

describe('the boundary: a practice incident cannot acquire a real NotificationAttempt', () => {
  async function practiceIncident(label: string) {
    const o = await owner(label, { contacts: 1 });
    const r = await sos(o.token).expect(201);
    return { ...o, id: r.body.id as string };
  }

  it('the DATABASE refuses it, whatever wrote it', async () => {
    const p = await practiceIncident('db');
    await expect(prisma.notificationAttempt.create({ data: { incidentId: p.id, recipientId: p.contactIds[0], channel: 'sms', escalationStep: 1 } })).rejects.toThrow(/practice incident/);
    expect(await prisma.notificationAttempt.count({ where: { incidentId: p.id } })).toBe(0);
  });

  it('the planner refuses it', async () => {
    const p = await practiceIncident('plan');
    await expect(prisma.$transaction((tx) => dispatch.planRecipientIn(tx, { incidentId: p.id, userId: p.userId, recipientId: p.contactIds[0], channels: ['push'], stepOrder: 1 }))).rejects.toBeInstanceOf(PracticeBoundaryError);
    await expect(prisma.$transaction((tx) => dispatch.planResolutionIn(tx, p.id))).rejects.toBeInstanceOf(PracticeBoundaryError);
    nobodyContacted();
  });

  it('assertReal passes a real incident and throws for anything else', () => {
    expect(() => assertReal('x', 'real')).not.toThrow();
    expect(() => assertReal('x', 'practice')).toThrow(PracticeBoundaryError);
  });

  it('a rehearsal can never become real, nor a real incident a rehearsal', async () => {
    const p = await practiceIncident('immutable');
    await expect(prisma.emergencyIncident.update({ where: { id: p.id }, data: { mode: 'real' } })).rejects.toThrow(/cannot change/);
    const o = await owner('immutable_real', { contacts: 1 });
    const real = await sos(o.token, body({ mode: 'real' })).expect(201);
    await expect(prisma.emergencyIncident.update({ where: { id: real.body.id }, data: { mode: 'practice' } })).rejects.toThrow(/cannot change/);
  });

  it('is not counted against the spend cap: a practice run reserves no budget', async () => {
    const p = await practiceIncident('spend');
    expect(await prisma.notificationAttempt.count({ where: { incidentId: p.id, reservedAt: { not: null } } })).toBe(0);
  });
});
