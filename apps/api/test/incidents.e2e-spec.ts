/**
 * Incidents (docs/specs/INCIDENTS.md) against real Postgres, the real HTTP pipeline and the real pg-boss.
 * The SMS and push providers are fakes, so NOTHING here reaches a phone: this proves the incident machinery
 * and the ledger it sits on, not delivery.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { IncidentService, clampCountdown } from '../src/incidents/incident.service';
import { EscalationService } from '../src/escalation/escalation.service';
import { NotificationQueue } from '../src/notifications/queue';
import { SendWorker } from '../src/notifications/send-worker';
import { PUSH_PROVIDER, type PushProvider } from '../src/notifications/push/push-provider';
import { SMS_PROVIDER, type SmsOutcome, type SmsProvider } from '../src/notifications/sms/sms-provider';

process.env.NOTIFICATIONS_QUEUE = 'on';
process.env.NOTIFICATIONS_QUEUE_SCHEMA = 'pgboss_incidents_e2e';
const RUN = `in_${Date.now()}_${randomUUID().slice(0, 6)}`;

class FakeSms implements SmsProvider {
  next: SmsOutcome = { kind: 'accepted', providerMessageId: 'SM', status: 'queued' };
  calls: { to: string; body: string; attemptId: string }[] = [];
  configured() { return true; }
  async send(r: { to: string; body: string; attemptId: string }) { this.calls.push(r); return this.next.kind === 'accepted' ? { ...this.next, providerMessageId: `SM_${randomUUID().slice(0, 8)}` } : this.next; }
}
class FakePush implements PushProvider {
  calls: { tokens: readonly string[]; attemptId: string; body: string }[] = [];
  configured() { return true; }
  async send(r: { tokens: readonly string[]; title: string; body: string; attemptId: string }) {
    this.calls.push({ tokens: r.tokens, attemptId: r.attemptId, body: r.body });
    return { kind: 'accepted' as const, tickets: r.tokens.map((token, i) => ({ token, id: `T${i}_${randomUUID().slice(0, 6)}` })), deadTokens: [] };
  }
  async receipts() { return new Map(); }
}
const sms = new FakeSms();
const push = new FakePush();

let app: INestApplication;
let prisma: PrismaClient;
let incidents: IncidentService;
let worker: SendWorker;
let queue: NotificationQueue;
let jwt: JwtService;
let escalation: EscalationService;
/** Let the step in flight time out, as the queue's job would after its deadline. */
const stepOn = (incidentId: string, order: number) => escalation.timeout(incidentId, order, new Date(Date.now() + 10 * 60_000));

const api = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const key = () => `k-${randomUUID()}`;
const expoToken = () => `ExponentPushToken[${randomUUID().replace(/-/g, '').slice(0, 22)}]`;

async function owner(label: string, o: { sms?: boolean; shareLocation?: boolean; contacts?: number; agree?: boolean; region?: string } = {}) {
  const s = await api().post('/api/v1/auth/signup').send({ name: `Owner ${label}`, email: `${RUN}_${label}@example.com`, password: 'password123' }).expect(201);
  const token = s.body.token as string;
  const userId = s.body.user.id as string;
  await prisma.user.update({ where: { id: userId }, data: { sendSmsOnSos: o.sms ?? false, shareLocationOnSos: o.shareLocation ?? true, regionProfileId: o.region } });
  const n = o.contacts ?? 1;
  const phones = Array.from({ length: n }, (_, i) => `+92300123450${i}`);
  const contactIds: string[] = [];
  if (n > 0) {
    const put = await api().put('/api/v1/settings').set(auth(token)).send({ trustedContacts: phones.map((phone, i) => ({ name: `C${i}`, phone })) }).expect(200);
    contactIds.push(...put.body.trustedContacts.map((c: { id: string }) => c.id));
    if (o.agree !== false) {
      for (const id of contactIds) {
        const inv = await api().post(`/api/v1/trusted-contacts/${id}/invite`).set(auth(token)).expect(201);
        await api().post(`${inv.body.path}/accept`).expect(200);
      }
    }
  }
  return { token, userId, contactIds, phones };
}
/** A contact who claimed their invite from their own signed-in account and has a device. */
async function claimedContact(label: string) {
  const o = await owner(label, { contacts: 1, agree: false });
  const inv = await api().post(`/api/v1/trusted-contacts/${o.contactIds[0]}/invite`).set(auth(o.token)).expect(201);
  const c = await api().post('/api/v1/auth/signup').send({ name: `Contact ${label}`, email: `${RUN}_${label}_c@example.com`, password: 'password123' }).expect(201);
  await api().post(`${inv.body.path}/claim`).set(auth(c.body.token)).expect(200);
  await api().post('/api/v1/devices').set(auth(c.body.token)).send({ platform: 'android', osVersion: '14', pushToken: expoToken() }).expect(201);
  return { ...o, contactToken: c.body.token as string, contactUserId: c.body.user.id as string, invitePath: inv.body.path as string };
}
const body = (over: Record<string, unknown> = {}) => ({ triggerType: 'manual', triggeredAt: new Date().toISOString(), ...over });
const sos = (token: string, k: string, b: Record<string, unknown> = body()) => api().post('/api/v1/sos').set(auth(token)).set('Idempotency-Key', k).send(b);
const get = (token: string, id: string) => api().get(`/api/v1/incidents/${id}`).set(auth(token));
const row = (id: string) => prisma.emergencyIncident.findUniqueOrThrow({ where: { id } });
const timeline = async (id: string) => (await prisma.incidentEvent.findMany({ where: { incidentId: id }, orderBy: { seq: 'asc' } })).map((e) => `${e.event}:${e.toState}`);
const attemptsOf = (id: string) => prisma.notificationAttempt.findMany({ where: { incidentId: id }, orderBy: { queuedAt: 'asc' } });
const fix = (over: Record<string, unknown> = {}) => ({ latitude: 33.6844, longitude: 73.0479, accuracyM: 15, capturedAt: Date.now() - 2000, ...over });

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
  incidents = app.get(IncidentService);
  worker = app.get(SendWorker);
  queue = app.get(NotificationQueue);
  jwt = app.get(JwtService);
  escalation = app.get(EscalationService);
});

beforeEach(() => {
  sms.next = { kind: 'accepted', providerMessageId: 'SM', status: 'queued' };
  sms.calls = [];
  push.calls = [];
  // Sending is driven by hand, so a test sees exactly one thing happen at a time. The countdown job stays real.
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

describe('the countdown the server allows', () => {
  it.each([
    ['manual', undefined, 0], ['manual', 2, 2], ['manual', 99, 3], ['manual', -5, 0],
    ['safeword', undefined, 0], ['safeword', 7, 7], ['safeword', 999, 10],
    ['shake', 0, 10], ['shake', 2, 10], ['crash', undefined, 10], ['fall', 1, 10], ['voice', 0, 10],
  ] as const)('%s asking for %s gets %s s', (trigger, asked, got) => {
    expect(clampCountdown(trigger, asked)).toBe(got);
  });
  it('a non-number is ignored', () => expect(clampCountdown('manual', NaN)).toBe(0));
});

describe('raising an incident', () => {
  it('a manual SOS dispatches at once and the timeline is ordered', async () => {
    const o = await owner('raise', { sms: true });
    const r = await sos(o.token, key()).expect(201);
    expect(r.body).toMatchObject({ state: 'NOTIFYING', locationAvailable: false, countdownEndsAt: null });
    expect(await timeline(r.body.id)).toEqual([
      'CREATED:CREATED', 'COUNTDOWN_SKIPPED:LOCATING', 'LOCATION_TIMEOUT:DISPATCHING', 'RECIPIENTS_RESOLVED:NOTIFYING',
    ]);
    expect((await row(r.body.id)).dispatchedAt).not.toBeNull();
  });

  it('the same key twice is one incident, answered 200 the second time', async () => {
    const o = await owner('idem', { sms: true });
    const k = key();
    const a = await sos(o.token, k).expect(201);
    const b = await sos(o.token, k).expect(200);
    expect(b.body.id).toBe(a.body.id);
    expect((await attemptsOf(a.body.id)).length).toBe((await attemptsOf(b.body.id)).length);
  });

  it('five at once: one incident, planned once', async () => {
    const o = await owner('idem_race', { sms: true });
    const k = key();
    const rs = await Promise.all(Array.from({ length: 5 }, () => sos(o.token, k)));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    expect(await prisma.emergencyIncident.count({ where: { idempotencyKey: k } })).toBe(1);
    const planned = await attemptsOf(rs[0].body.id);
    expect(planned.filter((a) => a.channel === 'sms')).toHaveLength(1); // one contact, planned once
  });

  it('another user’s key is 409 and returns nothing of theirs', async () => {
    const a = await owner('key_a');
    const b = await owner('key_b');
    const k = key();
    const first = await sos(a.token, k).expect(201);
    const r = await sos(b.token, k).expect(409);
    expect(JSON.stringify(r.body)).not.toContain(first.body.id);
  });

  it('requires a well-formed Idempotency-Key and a login', async () => {
    const o = await owner('keyfmt');
    await api().post('/api/v1/sos').set(auth(o.token)).send(body()).expect(400);
    await sos(o.token, 'short').expect(400);
    await api().post('/api/v1/sos').set('Idempotency-Key', key()).send(body()).expect(401);
  });

  it('refuses practice, duress and triggers that do not exist yet — and sends nothing', async () => {
    const o = await owner('refuse', { sms: true });
    const before = await prisma.emergencyIncident.count({ where: { userId: o.userId } });
    await sos(o.token, key(), body({ mode: 'practice' })).expect(400);
    await sos(o.token, key(), body({ duress: true })).expect(400);
    await sos(o.token, key(), body({ triggerType: 'duress' })).expect(400);
    await sos(o.token, key(), body({ triggerType: 'missed_check_in' })).expect(400);
    expect(await prisma.emergencyIncident.count({ where: { userId: o.userId } })).toBe(before);
    expect(sms.calls).toHaveLength(0);
  });

  it('a client cannot name the region, nor invent fields', async () => {
    const o = await owner('region_inject');
    await sos(o.token, key(), body({ regionProfileId: 'PK' })).expect(400);
  });

  it('builds the region from what the device reports; an unknown country is UNRESOLVED', async () => {
    const o = await owner('region');
    const pk = await sos(o.token, key(), body({ location: fix(), place: { country: 'PK', subdivision: 'PB' } })).expect(201);
    expect((await row(pk.body.id)).regionProfileId).toBe('PK');
    const gb = await sos(o.token, key(), body({ location: fix(), place: { country: 'GB' } })).expect(201);
    expect((await row(gb.body.id)).regionProfileId).toBe('UNRESOLVED');
    const none = await sos(o.token, key()).expect(201);
    expect((await row(none.body.id)).regionProfileId).toBe('UNRESOLVED'); // account has none, device reported none
  });

  it('with no fix the alert still goes, and says the location was not available', async () => {
    const o = await owner('nofix', { sms: true });
    const r = await sos(o.token, key()).expect(201);
    const sent = (await attemptsOf(r.body.id)).find((a) => a.channel === 'sms')!;
    await worker.send(sent.id);
    expect(sms.calls[0].body).toContain('Their location was not available');
    expect(sms.calls[0].body).not.toMatch(/maps\.google/);
  });

  it('a fresh fix is worded with its time and precision; a stale one is "last known"', async () => {
    const o = await owner('fixed', { sms: true });
    const fresh = await sos(o.token, key(), body({ location: fix() })).expect(201);
    await worker.send((await attemptsOf(fresh.body.id)).find((a) => a.channel === 'sms')!.id);
    expect(sms.calls[0].body).toMatch(/^Owner fixed asked Lumo to alert you\. Location \(\d\d:\d\d UTC, about 0 min before this was sent, within 15 m\): https:\/\/maps\.google\.com\/\?q=33\.6844,73\.0479\./);
    expect(sms.calls[0].body).not.toContain('Last known');

    sms.calls = [];
    const stale = await sos(o.token, key(), body({ location: fix({ capturedAt: Date.now() - 20 * 60_000 }) })).expect(201);
    await worker.send((await attemptsOf(stale.body.id)).find((a) => a.channel === 'sms')!.id);
    expect(sms.calls[0].body).toContain('Last known location');
    expect(sms.calls[0].body).toContain('they may have moved');
  });

  it('shareLocationOnSos off: no position in any message', async () => {
    const o = await owner('noshare', { sms: true, shareLocation: false });
    const r = await sos(o.token, key(), body({ location: fix() })).expect(201);
    await worker.send((await attemptsOf(r.body.id)).find((a) => a.channel === 'sms')!.id);
    expect(sms.calls[0].body).not.toMatch(/maps\.google|33\.68/);
    expect(sms.calls[0].body).toContain('Their location was not available');
  });

  it('a bad fix never blocks the SOS: it is dropped and the alert goes', async () => {
    const o = await owner('badfix', { sms: true });
    const r = await sos(o.token, key(), body({ location: fix({ accuracyM: null }) })).expect(201);
    expect(r.body.state).toBe('NOTIFYING');
    expect(r.body.locationAvailable).toBe(false);
  });

  it('honours sendSmsOnSos: off means no SMS attempt at all; on means one', async () => {
    const off = await owner('sms_off', { sms: false });
    const a = await sos(off.token, key()).expect(201);
    expect((await attemptsOf(a.body.id)).map((x) => x.channel)).toEqual(['push']);
    const on = await owner('sms_on', { sms: true });
    const b = await sos(on.token, key()).expect(201);
    expect((await attemptsOf(b.body.id)).map((x) => x.channel).sort()).toEqual(['push', 'sms']);
  });

  it('with defaults nobody is texted and the incident says so: ALL_CHANNELS_FAILED', async () => {
    const o = await owner('defaults');
    const r = await sos(o.token, key()).expect(201);
    expect(r.body.state).toBe('ALL_CHANNELS_FAILED');
    expect(r.body.failed).toEqual(o.contactIds);
  });

  it('no consenting contact at all → ALL_CHANNELS_FAILED, nothing planned as a send', async () => {
    const o = await owner('noconsent', { sms: true, agree: false });
    const r = await sos(o.token, key()).expect(201);
    expect(r.body.state).toBe('ALL_CHANNELS_FAILED');
    expect(await timeline(r.body.id)).toContain('NO_RECIPIENTS:ALL_CHANNELS_FAILED');
    expect(sms.calls).toHaveLength(0);
  });

  it('the daily cap is returned as capped, so the app can say so', async () => {
    const o = await owner('cap', { sms: true, contacts: 2 });
    const spent = await prisma.emergencyIncident.create({ data: { userId: o.userId, idempotencyKey: key(), triggerType: 'manual', triggeredAt: new Date(), regionProfileId: 'UNRESOLVED', state: 'CLOSED' } });
    for (let i = 0; i < 29; i++) await prisma.notificationAttempt.create({ data: { incidentId: spent.id, recipientId: randomUUID(), channel: 'sms', escalationStep: 0, state: 'SENT', reservedAt: new Date() } });
    const r = await sos(o.token, key()).expect(201);
    await worker.send((await attemptsOf(r.body.id)).find((a) => a.channel === 'sms')!.id);
    await stepOn(r.body.id, 1); // the first contact's step gives way to the second
    const after = await get(o.token, r.body.id).expect(200);
    expect(after.body.capped).toEqual([o.contactIds[1]]); // the second contact missed the last of the budget
  });
});

describe('the emergency token', () => {
  const expiredLogin = (userId: string) => jwt.sign({ sub: userId, email: 'x@example.com' }, { expiresIn: '-10s' });

  it('dispatches with an EXPIRED login, where the login alone would be refused', async () => {
    const o = await owner('exp', { sms: true });
    const minted = await api().post('/api/v1/emergency-token').set(auth(o.token)).send({ deviceKey: 'install-aaaaaaaa' }).expect(201);
    await sos(expiredLogin(o.userId), key()).expect(401);
    const r = await sos(minted.body.token, key()).expect(201);
    expect(r.body.state).toBe('NOTIFYING');
  });

  it('is opaque: not a JWT, so the login guard cannot accept it', async () => {
    const o = await owner('opaque');
    const minted = await api().post('/api/v1/emergency-token').set(auth(o.token)).send({ deviceKey: 'install-bbbbbbbb' }).expect(201);
    expect(minted.body.token.split('.')).toHaveLength(1);
    await api().get('/api/v1/settings').set(auth(minted.body.token)).expect(401);
  });

  it('stores only a hash', async () => {
    const o = await owner('hashed');
    const minted = await api().post('/api/v1/emergency-token').set(auth(o.token)).send({ deviceKey: 'install-cccccccc' }).expect(201);
    const stored = await prisma.emergencyCredential.findMany({ where: { userId: o.userId } });
    expect(JSON.stringify(stored)).not.toContain(minted.body.token);
  });

  it('minting for a device revokes its previous token; revoking (logout) kills it', async () => {
    const o = await owner('rotate');
    const one = await api().post('/api/v1/emergency-token').set(auth(o.token)).send({ deviceKey: 'install-dddddddd' }).expect(201);
    const two = await api().post('/api/v1/emergency-token').set(auth(o.token)).send({ deviceKey: 'install-dddddddd' }).expect(201);
    await sos(one.body.token, key()).expect(401);
    await sos(two.body.token, key()).expect(201);
    await api().delete(`/api/v1/emergency-token/${two.body.id}`).set(auth(o.token)).expect(204);
    await sos(two.body.token, key()).expect(401);
  });

  it('at most ten live per user: the oldest go first', async () => {
    const o = await owner('ten');
    const tokens: string[] = [];
    for (let i = 0; i < 12; i++) tokens.push((await api().post('/api/v1/emergency-token').set(auth(o.token)).send({ deviceKey: `install-device-${i}` }).expect(201)).body.token);
    expect(await prisma.emergencyCredential.count({ where: { userId: o.userId, revokedAt: null } })).toBe(10);
    await sos(tokens[0], key()).expect(401);
    await sos(tokens[11], key()).expect(201);
  });

  it('an expired or unknown token is refused', async () => {
    const o = await owner('expired_tok');
    const minted = await api().post('/api/v1/emergency-token').set(auth(o.token)).send({ deviceKey: 'install-eeeeeeee' }).expect(201);
    await prisma.emergencyCredential.update({ where: { id: minted.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await sos(minted.body.token, key()).expect(401);
    await sos('not-a-real-token-at-all-0123456789', key()).expect(401);
  });

  it('reads an incident as ids and states only — no contact names — where a login sees the names', async () => {
    const o = await owner('names', { sms: true });
    const minted = await api().post('/api/v1/emergency-token').set(auth(o.token)).send({ deviceKey: 'install-ffffffff' }).expect(201);
    const r = await sos(minted.body.token, key()).expect(201);
    expect(JSON.stringify(r.body)).not.toMatch(/C0|\+92300/);
    const withLogin = await get(o.token, r.body.id).expect(200);
    expect(JSON.stringify(withLogin.body)).toContain('C0');
    expect(JSON.stringify(withLogin.body)).not.toMatch(/\+92300/); // never a number
  });

  it('cannot reach another user’s incident', async () => {
    const a = await owner('tok_a', { sms: true });
    const b = await owner('tok_b');
    const incident = await sos(a.token, key()).expect(201);
    const minted = await api().post('/api/v1/emergency-token').set(auth(b.token)).send({ deviceKey: 'install-gggggggg' }).expect(201);
    await get(minted.body.token, incident.body.id).expect(404);
    await api().post(`/api/v1/incidents/${incident.body.id}/resolve`).set(auth(minted.body.token)).expect(404);
  });

  it('ROUTE TABLE: only the incident routes accept it; every other route refuses it', async () => {
    const o = await owner('routes');
    const tok = (await api().post('/api/v1/emergency-token').set(auth(o.token)).send({ deviceKey: 'install-hhhhhhhh' }).expect(201)).body.token as string;
    const inst: any = app.getHttpAdapter().getInstance();
    const stack: any[] = (inst.router ?? inst._router).stack;
    const routes: { method: string; path: string }[] = [];
    for (const layer of stack) {
      if (!layer.route) continue;
      for (const m of Object.keys(layer.route.methods)) routes.push({ method: m, path: layer.route.path });
    }
    const have = new Set(routes.map((r) => `${r.method} ${r.path}`));
    // The walk really found the table: the routes that matter are in it.
    for (const must of ['post /api/v1/sos', 'get /api/v1/settings', 'post /api/v1/incidents/:id/ack', 'post /api/v1/devices', 'put /api/v1/settings']) expect(have, must).toContain(must);
    expect(routes.length).toBeGreaterThan(25);

    const ACCEPT = new Set(['post /api/v1/sos', 'post /api/v1/incidents/:id/cancel', 'post /api/v1/incidents/:id/resolve', 'get /api/v1/incidents/:id']);
    // Public BY DESIGN: their own credential (a link token, a signature) or none. They never read the Authorization header.
    const PUBLIC = (p: string) => p === '/' || p.startsWith('/api/v1/auth/') || p.startsWith('/api/v1/contacts/invites/') && !p.endsWith('/claim') || p.startsWith('/api/v1/webhooks/');
    const concrete = (p: string) => p.replace(/:token/g, 'x'.repeat(43)).replace(/:[A-Za-z]+/g, randomUUID());

    const wronglyAccepted: string[] = [];
    const wronglyRefused: string[] = [];
    for (const r of routes) {
      const id = `${r.method} ${r.path}`;
      if (PUBLIC(r.path)) continue;
      const res = await (api() as any)[r.method](concrete(r.path)).set(auth(tok)).send({});
      if (ACCEPT.has(id)) { if (res.status === 401) wronglyRefused.push(id); }
      else if (res.status !== 401) wronglyAccepted.push(`${id} -> ${res.status}`);
    }
    expect(wronglyAccepted).toEqual([]);
    expect(wronglyRefused).toEqual([]);
  });
});

describe('cancelling', () => {
  it('within the countdown: CANCELLED, nobody contacted, and the deadline job then does nothing', async () => {
    const o = await owner('cancel', { sms: true });
    const r = await sos(o.token, key(), body({ countdownSeconds: 3 })).expect(201);
    expect(r.body.state).toBe('CREATED');
    expect(r.body.countdownEndsAt).not.toBeNull();
    const c = await api().post(`/api/v1/incidents/${r.body.id}/cancel`).set(auth(o.token)).expect(200);
    expect(c.body.state).toBe('CANCELLED');
    await incidents.dispatch(r.body.id); // the job firing late
    expect((await row(r.body.id)).state).toBe('CANCELLED');
    expect(await attemptsOf(r.body.id)).toHaveLength(0);
    await api().post(`/api/v1/incidents/${r.body.id}/cancel`).set(auth(o.token)).expect(200); // idempotent
  });

  it('after the deadline, or after dispatch, it is 409: resolve instead', async () => {
    const o = await owner('cancel_late', { sms: true });
    const r = await sos(o.token, key()).expect(201); // dispatched
    await api().post(`/api/v1/incidents/${r.body.id}/cancel`).set(auth(o.token)).expect(409);
    const timed = await sos(o.token, key(), body({ countdownSeconds: 3 })).expect(201);
    await prisma.emergencyIncident.update({ where: { id: timed.body.id }, data: { countdownEndsAt: new Date(Date.now() - 1000) } });
    await api().post(`/api/v1/incidents/${timed.body.id}/cancel`).set(auth(o.token)).expect(409);
  });

  it('someone else’s incident is a 404', async () => {
    const a = await owner('cancel_a');
    const b = await owner('cancel_b');
    const r = await sos(a.token, key(), body({ countdownSeconds: 3 })).expect(201);
    await api().post(`/api/v1/incidents/${r.body.id}/cancel`).set(auth(b.token)).expect(404);
  });

  it('a cancel racing the deadline has exactly one winner, and the incident is never half of each', async () => {
    for (let i = 0; i < 4; i++) {
      const o = await owner(`cancel_race_${i}`, { sms: true });
      const r = await sos(o.token, key(), body({ countdownSeconds: 3 })).expect(201);
      await prisma.emergencyIncident.update({ where: { id: r.body.id }, data: { countdownEndsAt: new Date(Date.now() + 400) } });
      await new Promise((res) => setTimeout(res, 380));
      await Promise.all([api().post(`/api/v1/incidents/${r.body.id}/cancel`).set(auth(o.token)), incidents.dispatch(r.body.id)]);
      const state = (await row(r.body.id)).state;
      const planned = (await attemptsOf(r.body.id)).length;
      if (state === 'CANCELLED') expect(planned).toBe(0);
      else expect(planned).toBeGreaterThan(0);
      const events = await timeline(r.body.id);
      expect(events.some((e) => e.startsWith('CANCEL:')) && events.some((e) => e.startsWith('RECIPIENTS_RESOLVED') || e.startsWith('NO_RECIPIENTS'))).toBe(false);
    }
  });

  it('the REAL queue dispatches an incident whose app never comes back', { timeout: 30_000 }, async () => {
    const o = await owner('killed', { sms: true });
    const r = await sos(o.token, key(), body({ countdownSeconds: 1 })).expect(201);
    expect(r.body.state).toBe('CREATED');
    for (let i = 0; i < 40 && (await row(r.body.id)).state === 'CREATED'; i++) await new Promise((res) => setTimeout(res, 250));
    expect((await row(r.body.id)).state).toBe('NOTIFYING');
    expect((await attemptsOf(r.body.id)).length).toBeGreaterThan(0);
  });
});

describe('the rollup from the ledger', () => {
  const smsAttempt = async (id: string) => (await attemptsOf(id)).find((a) => a.channel === 'sms')!;

  it('stays NOTIFYING while an attempt is in flight, and NOTIFIED when the receipt arrives', async () => {
    const o = await owner('roll_ok', { sms: true });
    const r = await sos(o.token, key()).expect(201);
    const a = await smsAttempt(r.body.id);
    await worker.send(a.id);
    expect((await row(r.body.id)).state).toBe('NOTIFYING'); // SENT: an SMS can still be delivered
    const led = app.get(SendWorker)['ledger'];
    await led.apply(a.id, [{ event: 'RECEIPT_DELIVERED', by: 'system', evidence: 'provider' }]);
    expect((await row(r.body.id)).state).toBe('NOTIFIED');
  });

  it('PARTIALLY_NOTIFIED when one contact was reached and one was not', async () => {
    const o = await owner('roll_part', { sms: true, contacts: 2 });
    const r = await sos(o.token, key()).expect(201);
    const led = app.get(SendWorker)['ledger'];
    const a = (await attemptsOf(r.body.id)).find((x) => x.channel === 'sms')!;
    await worker.send(a.id);
    await led.apply(a.id, [{ event: 'RECEIPT_DELIVERED', by: 'system', evidence: 'provider' }]);
    await stepOn(r.body.id, 1);
    const b = (await attemptsOf(r.body.id)).filter((x) => x.channel === 'sms')[1];
    sms.next = { kind: 'rejected', reason: 'TWILIO_21211' };
    await worker.send(b.id);
    expect((await row(r.body.id)).state).toBe('PARTIALLY_NOTIFIED');
  });

  it('ALL_CHANNELS_FAILED when every send is refused', async () => {
    const o = await owner('roll_fail', { sms: true });
    const r = await sos(o.token, key()).expect(201);
    sms.next = { kind: 'rejected', reason: 'TWILIO_21211' };
    await worker.send((await smsAttempt(r.body.id)).id);
    expect((await row(r.body.id)).state).toBe('ALL_CHANNELS_FAILED');
  });

  it('an SMS with no receipt settles UNKNOWN at its deadline, which counts as sent: NOTIFIED', async () => {
    const o = await owner('roll_unknown', { sms: true });
    const r = await sos(o.token, key()).expect(201);
    const a = await smsAttempt(r.body.id);
    await worker.send(a.id);
    await worker.expire(a.id);
    expect((await row(r.body.id)).state).toBe('NOTIFIED');
  });

  it('recomputing again changes nothing', async () => {
    const o = await owner('roll_idem', { sms: true });
    const r = await sos(o.token, key()).expect(201);
    sms.next = { kind: 'rejected', reason: 'X' };
    await worker.send((await smsAttempt(r.body.id)).id);
    const before = await timeline(r.body.id);
    for (let i = 0; i < 3; i++) await incidents.recompute(r.body.id);
    expect(await timeline(r.body.id)).toEqual(before);
  });
});

describe('acknowledging', () => {
  it('a linked contact’s "I’m responding" acknowledges the incident, and an unack restores it — which a recompute does not undo', async () => {
    const c = await claimedContact('ack');
    await prisma.user.update({ where: { id: c.userId }, data: { sendSmsOnSos: false } });
    const r = await sos(c.token, key()).expect(201);
    expect(r.body.state).toBe('NOTIFYING');
    await api().post(`/api/v1/incidents/${r.body.id}/ack`).set(auth(c.contactToken)).expect(200).expect({ recorded: true });
    expect((await row(r.body.id)).state).toBe('ACKNOWLEDGED');
    await api().post(`/api/v1/incidents/${r.body.id}/ack`).set(auth(c.contactToken)).expect(200).expect({ recorded: false }); // again: harmless

    const un = await api().post(`/api/v1/incidents/${r.body.id}/unack`).set(auth(c.contactToken)).expect(200);
    expect(un.body).toEqual({ recorded: true });
    expect((await row(r.body.id)).state).toBe('NOTIFYING'); // back to where it was
    for (let i = 0; i < 3; i++) await incidents.recompute(r.body.id);
    expect((await row(r.body.id)).state).not.toBe('ACKNOWLEDGED');
    expect(await timeline(r.body.id)).toContain('UNACK_RECEIVED:NOTIFYING');
  });

  it('acknowledging through the push attempt reaches the incident too', async () => {
    const c = await claimedContact('ack_push');
    const r = await sos(c.token, key()).expect(201);
    const a = (await attemptsOf(r.body.id)).find((x) => x.channel === 'push')!;
    await worker.send(a.id);
    await api().post(`/api/v1/notifications/${a.id}/receipt`).set(auth(c.contactToken)).send({ kind: 'acknowledged' }).expect(200);
    for (let i = 0; i < 20 && (await row(r.body.id)).state !== 'ACKNOWLEDGED'; i++) await new Promise((res) => setTimeout(res, 100));
    expect((await row(r.body.id)).state).toBe('ACKNOWLEDGED');
  });

  it('only a linked, consenting contact of THIS user may answer; everything else is one 404', async () => {
    const c = await claimedContact('ack_who');
    const stranger = await owner('ack_stranger');
    const r = await sos(c.token, key()).expect(201);
    const results = [
      await api().post(`/api/v1/incidents/${r.body.id}/ack`).set(auth(stranger.token)),
      await api().post(`/api/v1/incidents/${r.body.id}/ack`).set(auth(c.token)), // the owner
      await api().post(`/api/v1/incidents/${randomUUID()}/ack`).set(auth(c.contactToken)),
    ];
    for (const x of results) expect(x.status).toBe(404);
    await api().post(`${c.invitePath}/revoke`).expect(200); // the contact withdraws
    await api().post(`/api/v1/incidents/${r.body.id}/ack`).set(auth(c.contactToken)).expect(404);
    expect((await row(r.body.id)).state).not.toBe('ACKNOWLEDGED');
  });

  it('an emergency token cannot acknowledge', async () => {
    const o = await owner('ack_tok', { sms: true });
    const tok = (await api().post('/api/v1/emergency-token').set(auth(o.token)).send({ deviceKey: 'install-iiiiiiii' }).expect(201)).body.token;
    const r = await sos(tok, key()).expect(201);
    await api().post(`/api/v1/incidents/${r.body.id}/ack`).set(auth(tok)).expect(401);
  });
});

describe('resolving', () => {
  it('tells only the contacts whose alert went, closes the incident, and bypasses the cap', async () => {
    const o = await owner('resolve', { sms: true, contacts: 2 });
    const r = await sos(o.token, key()).expect(201);
    const a = (await attemptsOf(r.body.id)).find((x) => x.channel === 'sms')!;
    await worker.send(a.id); // contact 0: alerted
    await stepOn(r.body.id, 1);
    const b = (await attemptsOf(r.body.id)).filter((x) => x.channel === 'sms')[1];
    sms.next = { kind: 'rejected', reason: 'TWILIO_21211' };
    await worker.send(b.id); // contact 1: refused, never alerted

    // The budget is gone by now — a resolution is still told.
    const spent = await prisma.emergencyIncident.create({ data: { userId: o.userId, idempotencyKey: key(), triggerType: 'manual', triggeredAt: new Date(), regionProfileId: 'UNRESOLVED', state: 'CLOSED' } });
    for (let i = 0; i < 40; i++) await prisma.notificationAttempt.create({ data: { incidentId: spent.id, recipientId: randomUUID(), channel: 'sms', escalationStep: 0, state: 'SENT', reservedAt: new Date() } });

    const res = await api().post(`/api/v1/incidents/${r.body.id}/resolve`).set(auth(o.token)).expect(200);
    expect(res.body.state).toBe('CLOSED');
    const resolved = (await attemptsOf(r.body.id)).filter((x) => x.purpose === 'RESOLVED');
    expect(resolved.map((x) => x.recipientId)).toEqual([a.recipientId]); // only the contact who was alerted
    expect(await timeline(r.body.id)).toEqual(expect.arrayContaining(['RESOLVE:RESOLVING', 'CLOSE:CLOSED']));

    sms.calls = [];
    sms.next = { kind: 'accepted', providerMessageId: 'SM', status: 'queued' };
    await worker.send(resolved[0].id);
    expect(sms.calls[0].body).toContain('ended the alert');
    expect(sms.calls[0].body).not.toMatch(/maps\.google/); // no position in "it ended"
  });

  it('RESOLVED attempts never enter the rollup, and resolving twice is harmless', async () => {
    const o = await owner('resolve_twice', { sms: true });
    const r = await sos(o.token, key()).expect(201);
    await worker.send((await attemptsOf(r.body.id)).find((x) => x.channel === 'sms')!.id);
    await api().post(`/api/v1/incidents/${r.body.id}/resolve`).set(auth(o.token)).expect(200);
    const again = await api().post(`/api/v1/incidents/${r.body.id}/resolve`).set(auth(o.token)).expect(200);
    expect(again.body.state).toBe('CLOSED');
    expect((await attemptsOf(r.body.id)).filter((x) => x.purpose === 'RESOLVED')).toHaveLength(1);
    expect(again.body.reached.length + again.body.pending.length).toBe(1); // the one contact, counted once
  });

  it('cannot be resolved while still counting down, and a cancelled incident cannot be resolved', async () => {
    const o = await owner('resolve_early', { sms: true });
    const r = await sos(o.token, key(), body({ countdownSeconds: 3 })).expect(201);
    await api().post(`/api/v1/incidents/${r.body.id}/resolve`).set(auth(o.token)).expect(409);
    await api().post(`/api/v1/incidents/${r.body.id}/cancel`).set(auth(o.token)).expect(200);
    await api().post(`/api/v1/incidents/${r.body.id}/resolve`).set(auth(o.token)).expect(409);
  });

  it('a withdrawn contact is not told', async () => {
    const c = await claimedContact('resolve_withdrawn');
    const r = await sos(c.token, key()).expect(201);
    await worker.send((await attemptsOf(r.body.id)).find((x) => x.channel === 'push')!.id);
    await api().post(`${c.invitePath}/revoke`).expect(200);
    const res = await api().post(`/api/v1/incidents/${r.body.id}/resolve`).set(auth(c.token)).expect(200);
    const resolved = (await attemptsOf(r.body.id)).find((x) => x.purpose === 'RESOLVED');
    if (resolved) { await worker.send(resolved.id); expect((await prisma.notificationAttempt.findUniqueOrThrow({ where: { id: resolved.id } })).state).toBe('FAILED'); }
    expect(push.calls.filter((x) => x.body.includes('ended'))).toHaveLength(0);
    expect(res.body.state).toBe('CLOSED');
  });
});

describe('the timeline', () => {
  it('has a total order even when several events share one timestamp', async () => {
    const o = await owner('order', { sms: true });
    const r = await sos(o.token, key()).expect(201);
    const events = await prisma.incidentEvent.findMany({ where: { incidentId: r.body.id }, orderBy: { seq: 'asc' } });
    const seqs = events.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    // The first states chain: each event starts where the last one ended.
    for (let i = 1; i < events.length; i++) expect(events[i].fromState).toBe(events[i - 1].toState);
  });
});
