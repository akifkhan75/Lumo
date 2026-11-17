/**
 * A late SOS (docs/specs/OFFLINE_SOS.md): a press made with no signal and sent when there was one. Real Postgres, real HTTP, the real
 * worker driven by hand, fake providers that record what a contact would actually have been sent.
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
import { MAX_LATE_SOS_SECONDS } from '../src/incidents/incident.service';
import { NotificationQueue } from '../src/notifications/queue';
import { SendWorker } from '../src/notifications/send-worker';
import { PUSH_PROVIDER, type PushProvider } from '../src/notifications/push/push-provider';
import { SMS_PROVIDER, type SmsOutcome, type SmsProvider } from '../src/notifications/sms/sms-provider';

process.env.NOTIFICATIONS_QUEUE = 'on';
process.env.NOTIFICATIONS_QUEUE_SCHEMA = 'pgboss_offline_e2e';
const RUN = `of_${Date.now()}_${randomUUID().slice(0, 6)}`;

class FakeSms implements SmsProvider {
  calls: { to: string; body: string; attemptId: string }[] = [];
  configured() { return true; }
  async send(r: { to: string; body: string; attemptId: string }): Promise<SmsOutcome> { this.calls.push(r); return { kind: 'accepted', providerMessageId: `SM_${randomUUID().slice(0, 8)}`, status: 'queued' }; }
}
class FakePush implements PushProvider {
  configured() { return true; }
  async send(r: { tokens: readonly string[] }) { return { kind: 'accepted' as const, tickets: r.tokens.map((token, i) => ({ token, id: `T${i}` })), deadTokens: [] }; }
  async receipts() { return new Map(); }
}
const sms = new FakeSms();

let app: INestApplication;
let prisma: PrismaClient;
let worker: SendWorker;
let queue: NotificationQueue;

const api = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const key = () => `k-${randomUUID()}`;

async function owner(label: string) {
  const s = await api().post('/api/v1/auth/signup').send({ name: `Owner ${label}`, email: `${RUN}_${label}@example.com`, password: 'password123' }).expect(201);
  const token = s.body.token as string;
  const userId = s.body.user.id as string;
  await prisma.user.update({ where: { id: userId }, data: { sendSmsOnSos: true, shareLocationOnSos: true } });
  const put = await api().put('/api/v1/settings').set(auth(token)).send({ trustedContacts: [{ name: 'Maya', phone: '+923001234500' }] }).expect(200);
  for (const c of put.body.trustedContacts as { id: string }[]) {
    const inv = await api().post(`/api/v1/trusted-contacts/${c.id}/invite`).set(auth(token)).expect(201);
    await api().post(`${inv.body.path}/accept`).expect(200);
  }
  return { token, userId };
}
const body = (over: Record<string, unknown> = {}) => ({ triggerType: 'manual', triggeredAt: new Date().toISOString(), ...over });
const sos = (token: string, b: Record<string, unknown> = body(), k = key()) => api().post('/api/v1/sos').set(auth(token)).set('Idempotency-Key', k).send(b);
const row = (id: string) => prisma.emergencyIncident.findUniqueOrThrow({ where: { id } });
const timeline = async (id: string) => (await prisma.incidentEvent.findMany({ where: { incidentId: id }, orderBy: { seq: 'asc' } })).map((e) => `${e.event}:${e.reason ?? ''}`);
async function textSent(incidentId: string): Promise<string> {
  const a = (await prisma.notificationAttempt.findMany({ where: { incidentId, channel: 'sms' } }))[0];
  await worker.send(a.id);
  return sms.calls.at(-1)?.body ?? '';
}

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
  worker = app.get(SendWorker);
  queue = app.get(NotificationQueue);
});
beforeEach(() => {
  sms.calls = [];
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

describe('an ordinary SOS is unchanged', () => {
  it('has no delay and says nothing about one', async () => {
    const o = await owner('ordinary');
    const r = await sos(o.token).expect(201);
    expect(r.body.lateBySeconds).toBe(0);
    expect(await textSent(r.body.id)).not.toContain('before it could be sent');
  });

  it('an SOS with no elapsed time keeps counting down from now', async () => {
    const o = await owner('counting');
    const r = await sos(o.token, body({ triggerType: 'shake' })).expect(201);
    expect(r.body.state).toBe('CREATED');
    expect(new Date(r.body.countdownEndsAt).getTime() - Date.now()).toBeGreaterThan(8000);
  });
});

describe('a late SOS', () => {
  it('dispatches at once when its countdown passed while the phone was offline, and says how late it is', async () => {
    const o = await owner('late');
    const r = await sos(o.token, body({ elapsedSeconds: 600, countdownSeconds: 3 })).expect(201);
    expect(r.body.state).not.toBe('CREATED');
    expect(r.body.lateBySeconds).toBe(597);
    const text = await textSent(r.body.id);
    expect(text).toContain('triggered about 10 minutes before it could be sent');
    expect(text).toContain('no signal until now');
    expect(text.toLowerCase()).not.toMatch(/help is|on its way/);
  });

  it('an automatic trigger whose 10 s passed offline also dispatches at once, recorded as its deadline passing, not as a skipped countdown', async () => {
    const o = await owner('auto');
    const r = await sos(o.token, body({ triggerType: 'shake', elapsedSeconds: 40 })).expect(201);
    expect(r.body.state).not.toBe('CREATED');
    expect(r.body.lateBySeconds).toBe(30);
    const t = await timeline(r.body.id);
    expect(t).toContain('COUNTDOWN_ELAPSED:DEADLINE_PASSED');
    expect(t.join()).not.toContain('COUNTDOWN_SKIPPED');
  });

  it('keeps counting for what remains when the delay was shorter than the countdown', async () => {
    const o = await owner('partial');
    const r = await sos(o.token, body({ triggerType: 'shake', elapsedSeconds: 4 })).expect(201);
    expect(r.body.state).toBe('CREATED');
    expect(r.body.lateBySeconds).toBe(0);
    const left = new Date(r.body.countdownEndsAt).getTime() - Date.now();
    expect(left).toBeGreaterThan(4000);
    expect(left).toBeLessThan(7000);
  });

  it('says nothing about a delay under two minutes (it is noise)', async () => {
    const o = await owner('short');
    const r = await sos(o.token, body({ elapsedSeconds: 60 })).expect(201);
    expect(r.body.lateBySeconds).toBe(60); // a manual press with no countdown requested is late by the whole delay
    expect(await textSent(r.body.id)).not.toContain('before it could be sent');
  });

  it('a retry of the same late press is one incident, dispatched once', async () => {
    const o = await owner('retry');
    const k = key();
    const a = await sos(o.token, body({ elapsedSeconds: 300 }), k).expect(201);
    const b = await sos(o.token, body({ elapsedSeconds: 330 }), k).expect(200);
    expect(b.body.id).toBe(a.body.id);
    expect(await prisma.notificationAttempt.count({ where: { incidentId: a.body.id, channel: 'sms' } })).toBe(1);
  });

  it('accepts a position captured while offline, and the contact is told its age', async () => {
    const o = await owner('fix');
    const r = await sos(o.token, body({ elapsedSeconds: 600, location: { latitude: 33.6844, longitude: 73.0479, accuracyM: 20, capturedAt: Date.now() - 12 * 60_000 } })).expect(201);
    expect(r.body.locationAvailable).toBe(true);
    const text = await textSent(r.body.id);
    expect(text).toContain('Last known location');
    expect(text).toContain('min before this was sent');
  });
});

describe('the time is the server\'s, the elapsed time is the device\'s', () => {
  it('a wildly wrong phone clock changes nothing the server states about when it happened', async () => {
    const o = await owner('skew');
    const wrong = new Date(Date.now() - 24 * 3600_000).toISOString(); // the phone thinks it is yesterday
    const r = await sos(o.token, body({ triggeredAt: wrong, elapsedSeconds: 5 })).expect(201);
    const at = (await row(r.body.id)).triggeredAt.getTime();
    expect(Math.abs(at - (Date.now() - 5000))).toBeLessThan(3000);
    expect(r.body.lateBySeconds).toBe(5); // by the DEVICE's elapsed time, not by its clock
  });

  it('a phone clock in the future cannot make an on-time alert late either', async () => {
    const o = await owner('future');
    const r = await sos(o.token, body({ triggeredAt: new Date(Date.now() + 3600_000).toISOString(), elapsedSeconds: 0 })).expect(201);
    expect(r.body.lateBySeconds).toBe(0);
  });
});

describe('too long ago', () => {
  it('is refused with a plain message, sends nothing, and creates nothing', async () => {
    const o = await owner('toolate');
    const before = await prisma.emergencyIncident.count({ where: { userId: o.userId } });
    const r = await sos(o.token, body({ elapsedSeconds: MAX_LATE_SOS_SECONDS + 1 })).expect(400);
    expect(r.body.tooLate).toBe(true);
    expect(r.body.message).toContain('Nothing was sent');
    expect(r.body.message).toContain('Call your local emergency number');
    expect(await prisma.emergencyIncident.count({ where: { userId: o.userId } })).toBe(before);
    expect(sms.calls).toHaveLength(0);
  });

  it('exactly at the cap still goes', async () => {
    const o = await owner('atcap');
    const r = await sos(o.token, body({ elapsedSeconds: MAX_LATE_SOS_SECONDS })).expect(201);
    expect(r.body.state).not.toBe('CREATED');
  });

  it('refuses a negative or fractional elapsed time as malformed, not as late', async () => {
    const o = await owner('malformed');
    await sos(o.token, body({ elapsedSeconds: -1 })).expect(400);
    await sos(o.token, body({ elapsedSeconds: 1.5 })).expect(400);
    await sos(o.token, body({ elapsedSeconds: 'soon' })).expect(400);
  });
});
