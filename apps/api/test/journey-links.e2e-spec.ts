/**
 * The journey link (docs/engineering/WEB.md, RES-11, T6) against real Postgres and the real HTTP pipeline. The token IS the credential, so
 * what is proven here is how little it unlocks, and how hard it is to use wrongly.
 */
import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConsoleLogger, INestApplication, Logger } from '@nestjs/common';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { JourneyLinkService, MAX_LIVE_LINKS, MAX_PIN_FAILURES, hashPin, pinMatches, statusFor } from '../src/sessions/journey-link.service';
import { NotificationQueue } from '../src/notifications/queue';
import { SessionService } from '../src/sessions/session.service';
import { PUSH_PROVIDER, type PushProvider } from '../src/notifications/push/push-provider';
import { SMS_PROVIDER, type SmsProvider } from '../src/notifications/sms/sms-provider';

process.env.NOTIFICATIONS_QUEUE = 'on';
process.env.NOTIFICATIONS_QUEUE_SCHEMA = 'pgboss_links_e2e';
const RUN = `jl_${Date.now()}_${randomUUID().slice(0, 6)}`;
const MIN = 60_000;

class FakeSms implements SmsProvider {
  configured() { return true; }
  async send() { return { kind: 'accepted' as const, providerMessageId: `SM_${randomUUID().slice(0, 8)}`, status: 'queued' }; }
}
class FakePush implements PushProvider {
  configured() { return true; }
  async send(r: { tokens: readonly string[] }) { return { kind: 'accepted' as const, tickets: r.tokens.map((token, i) => ({ token, id: `T${i}_${randomUUID().slice(0, 6)}` })), deadTokens: [] }; }
  async receipts() { return new Map(); }
}

let app: INestApplication;
let prisma: PrismaClient;
let sessions: SessionService;
let queue: NotificationQueue;
const lines: string[] = [];
const api = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const expoToken = () => `ExponentPushToken[${randomUUID().replace(/-/g, '').slice(0, 22)}]`;
const row = (id: string) => prisma.safetySession.findUniqueOrThrow({ where: { id } });

async function journey(label: string, over: Record<string, unknown> = {}) {
  const s = await api().post('/api/v1/auth/signup').send({ name: `Joyce ${label}`, email: `${RUN}_${label}@example.com`, password: 'password123' }).expect(201);
  const token = s.body.token as string;
  const userId = s.body.user.id as string;
  await prisma.user.update({ where: { id: userId }, data: { sendSmsOnSos: true } });
  const put = await api().put('/api/v1/settings').set(auth(token)).send({ trustedContacts: [{ name: 'Maya', phone: '+923001234500' }, { name: 'Dad', phone: '+923001234501' }] }).expect(200);
  for (const c of put.body.trustedContacts) {
    const inv = await api().post(`/api/v1/trusted-contacts/${c.id}/invite`).set(auth(token)).expect(201);
    await api().post(`${inv.body.path}/accept`).expect(200);
  }
  await api().post('/api/v1/devices').set(auth(token)).send({ platform: 'android', osVersion: '14', pushToken: expoToken() }).expect(201);
  const r = await api().post('/api/v1/safety-sessions').set(auth(token)).send({ kind: 'walk_home', expectedArrivalAt: new Date(Date.now() + 30 * MIN).toISOString(), ...over }).expect(201);
  return { token, userId, id: r.body.id as string };
}
const mint = (j: { token: string; id: string }, body: Record<string, unknown> = {}) => api().post(`/api/v1/safety-sessions/${j.id}/links`).set(auth(j.token)).send(body);
const tokenOf = (path: string) => path.split('/').pop()!;
const view = (t: string, pin?: string) => { const r = api().get(`/api/v1/j/${t}`); return pin ? r.set('X-Link-Pin', pin) : r; };
const fix = (m = 20, ago = 1000) => ({ latitude: 33.6844 + m / 111_195, longitude: 73.0479, accuracyM: 12, capturedAt: Date.now() - ago, source: 'gps' });

beforeAll(async () => {
  prisma = new PrismaClient();
  const spy = (m: string) => (msg: unknown, ...rest: unknown[]) => { lines.push(`${m} ${String(msg)} ${rest.map(String).join(' ')}`); };
  Logger.overrideLogger(false);
  class Capturing extends ConsoleLogger { log = spy('log'); error = spy('error'); warn = spy('warn'); debug = spy('debug'); verbose = spy('verbose'); }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getOptionsToken()).useValue([{ name: 'short', ttl: 1000, limit: 1_000_000 }])
    .overrideProvider(SMS_PROVIDER).useValue(new FakeSms())
    .overrideProvider(PUSH_PROVIDER).useValue(new FakePush())
    .compile();
  app = moduleRef.createNestApplication({ logger: new Capturing() });
  configureApp(app);
  await app.init();
  sessions = app.get(SessionService);
  queue = app.get(NotificationQueue);
});
beforeEach(() => { queue.setHandlers({ send: async () => {}, expire: async () => {}, receipts: async () => {}, step: async () => {}, countdown: async () => {}, session: async () => {}, sweep: async () => {} }); });
afterAll(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lumo.erasure = 'on'`;
    await tx.contactInvite.deleteMany({ where: { contact: { user: { email: { startsWith: RUN } } } } });
    await tx.user.deleteMany({ where: { email: { startsWith: RUN } } });
  });
  await prisma.$disconnect();
  await app.close();
});

describe('minting a link', () => {
  it('returns the token ONCE, as a path, says Lumo sent nothing, and stores only its hash', async () => {
    const j = await journey('mint');
    const r = await mint(j).expect(201);
    expect(r.body).toMatchObject({ sentByLumo: false, hasPin: false });
    const token = tokenOf(r.body.path);
    expect(r.body.path).toMatch(/^\/j\//);
    expect(token.length).toBeGreaterThanOrEqual(43); // 256 bits
    const stored = await prisma.journeyLink.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(stored.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(JSON.stringify((await api().get(`/api/v1/safety-sessions/${j.id}/links`).set(auth(j.token)).expect(200)).body)).not.toContain(token);
  });

  it('is short by default: until the journey should be over, plus two hours', async () => {
    const j = await journey('short');
    const r = await mint(j).expect(201);
    const due = (await row(j.id)).checkInDueAt!.getTime();
    expect(Math.abs(new Date(r.body.expiresAt).getTime() - (due + 2 * 3600_000))).toBeLessThan(2000);
  });

  it('honours a chosen length within limits, and refuses one outside them', async () => {
    const j = await journey('len');
    const r = await mint(j, { expiresInMinutes: 60 }).expect(201);
    expect(new Date(r.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(59 * MIN);
    await mint(j, { expiresInMinutes: 5 }).expect(400);
    await mint(j, { expiresInMinutes: 60 * 24 * 30 }).expect(400);
  });

  it('refuses a malformed PIN, and caps the number of live links', async () => {
    const j = await journey('cap');
    await mint(j, { pin: '12' }).expect(400);
    await mint(j, { pin: 'abcd' }).expect(400);
    for (let i = 0; i < MAX_LIVE_LINKS; i++) await mint(j).expect(201);
    await mint(j).expect(409);
  });

  it('is login only, and only for your own journey', async () => {
    const a = await journey('own_a');
    const b = await journey('own_b');
    await api().post(`/api/v1/safety-sessions/${a.id}/links`).send({}).expect(401);
    await mint({ token: b.token, id: a.id }).expect(404);
    await api().get(`/api/v1/safety-sessions/${a.id}/links`).set(auth(b.token)).expect(404);
    const tok = (await api().post('/api/v1/emergency-token').set(auth(a.token)).send({ deviceKey: 'install-links-01' }).expect(201)).body.token;
    await mint({ token: tok, id: a.id }).expect(401);
  });

  it('an ended journey cannot be shared', async () => {
    const j = await journey('ended');
    await api().post(`/api/v1/safety-sessions/${j.id}/cancel`).set(auth(j.token)).expect(200);
    await mint(j).expect(409);
  });
});

describe('what the link holder sees: the EXACT keys, and nothing else', () => {
  it('who, status, expected arrival, the latest position with its age and accuracy, the server time, and two flags', async () => {
    const j = await journey('keys');
    await api().post(`/api/v1/safety-sessions/${j.id}/location`).set(auth(j.token)).send({ snapshots: [fix(500, 9000), fix(400, 1000)] }).expect(200);
    const t = tokenOf((await mint(j).expect(201)).body.path);
    const r = await view(t).expect(200);
    expect(Object.keys(r.body).sort()).toEqual(['asOf', 'canRespond', 'expectedArrivalAt', 'location', 'responding', 'status', 'who']);
    expect(Object.keys(r.body.location).sort()).toEqual(['accuracyM', 'capturedAt', 'latitude', 'longitude']);
    expect(Object.keys(r.body.status).sort()).toEqual(['code', 'text']);
    expect(r.body.who).toContain('Joyce');
    expect(r.body.status.code).toBe('on_the_way');
    expect(r.body.location.accuracyM).toBe(12);
  });

  it('shows only the LATEST position, never a history', async () => {
    const j = await journey('latest');
    await api().post(`/api/v1/safety-sessions/${j.id}/location`).set(auth(j.token)).send({ snapshots: [fix(900, 20_000), fix(100, 1000), fix(500, 10_000)] }).expect(200);
    const r = await view(tokenOf((await mint(j).expect(201)).body.path)).expect(200);
    expect(r.body.location.latitude).toBeCloseTo(33.6844 + 100 / 111_195, 6);
    expect(JSON.stringify(r.body)).not.toMatch(/\[\{/); // no list of positions anywhere
  });

  it('carries no medical data, no contact list, no phone number, no email, no ids', async () => {
    const j = await journey('private');
    await prisma.user.update({ where: { id: j.userId }, data: { bloodType: 'enc:v1:k1:aa:bb:cc', allergies: 'enc:v1:k1:aa:bb:cc' } });
    const r = await view(tokenOf((await mint(j).expect(201)).body.path)).expect(200);
    const all = JSON.stringify(r.body);
    expect(all).not.toMatch(/Maya|Dad|\+92300|@example\.com|enc:v1|bloodType|allergies|blood|allerg|sessionId|userId|incident/i);
    expect(all).not.toContain(j.id);
    expect(all).not.toContain(j.userId);
  });

  it('shows no position when the person chose not to save one', async () => {
    const j = await journey('nopos', { shareLocation: false });
    const r = await view(tokenOf((await mint(j).expect(201)).body.path)).expect(200);
    expect(r.body.location).toBeNull();
  });

  it('says what the journey is doing in plain words, and never "safe" or "help is coming"', async () => {
    const j = await journey('words');
    const t = tokenOf((await mint(j).expect(201)).body.path);
    const dueAt = (await row(j.id)).checkInDueAt!.getTime();
    const texts: string[] = [(await view(t).expect(200)).body.status.text];
    await sessions.tick(j.id, 'deadline', dueAt, new Date(dueAt + 1000));
    const due = (await view(t).expect(200)).body;
    expect(due.status.code).toBe('check_in_due');
    texts.push(due.status.text);
    await sessions.tick(j.id, 'grace', dueAt, new Date(dueAt + 181_000));
    const alert = (await view(t).expect(200)).body;
    expect(alert.status.code).toBe('alert_raised');
    expect(alert.canRespond).toBe(true);
    texts.push(alert.status.text);
    for (const text of texts) expect(text.toLowerCase()).not.toMatch(/\bsafe\b|help is|on the way to help|danger|emergency services (have|are)/);
  });

  it('every state produces words of its own', () => {
    for (const s of ['ACTIVE', 'CHECK_IN_DUE', 'GRACE', 'ESCALATING', 'ALERTED', 'CANCELLED', 'ARRIVED', 'CLOSED', 'EXPIRED', 'SUSPENDED', 'CREATED'] as const) {
      expect(statusFor(s, 'Joyce', null).text.length).toBeGreaterThan(10);
    }
  });

  it('once the journey ends the link shows no position and no arrival time', async () => {
    const j = await journey('after');
    await api().post(`/api/v1/safety-sessions/${j.id}/location`).set(auth(j.token)).send({ snapshots: [fix()] }).expect(200);
    const t = tokenOf((await mint(j).expect(201)).body.path);
    expect((await view(t).expect(200)).body.location).not.toBeNull();
    await api().post(`/api/v1/safety-sessions/${j.id}/arrive`).set(auth(j.token)).expect(200);
    const r = (await view(t).expect(200)).body;
    expect(r).toMatchObject({ location: null, expectedArrivalAt: null, canRespond: false });
    expect(r.status.code).toBe('ended');
  });

  it('ending a journey caps its links at 30 minutes after it ends: they still say "ended", then stop; a link already shorter is left alone', async () => {
    const j = await journey('capped');
    const long = (await mint(j, { expiresInMinutes: 6 * 60 }).expect(201)).body;
    const short = (await mint(j, { expiresInMinutes: 20 }).expect(201)).body;
    const t = tokenOf(long.path);
    await api().post(`/api/v1/safety-sessions/${j.id}/arrive`).set(auth(j.token)).expect(200);
    const rows = await prisma.journeyLink.findMany({ where: { sessionId: j.id } });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    const left = (id: string) => byId[id].expiresAt.getTime() - Date.now();
    expect(left(long.id)).toBeLessThanOrEqual(30 * MIN + 5_000);
    expect(left(long.id)).toBeGreaterThan(29 * MIN);
    expect(left(short.id)).toBeLessThanOrEqual(20 * MIN); // untouched: it was already shorter
    expect((await view(t).expect(200)).body.status.code).toBe('ended');
  });

  it('a cancelled journey says so', async () => {
    const j = await journey('cancelled');
    const t = tokenOf((await mint(j).expect(201)).body.path);
    await api().post(`/api/v1/safety-sessions/${j.id}/cancel`).set(auth(j.token)).expect(200);
    expect((await view(t).expect(200)).body.status.code).toBe('cancelled');
  });
});

describe('a token cannot be used wrongly, or probed', () => {
  it('unknown, expired and revoked are ONE answer', async () => {
    const j = await journey('invalid');
    const live = await mint(j).expect(201);
    const expired = await mint(j).expect(201);
    await prisma.journeyLink.update({ where: { id: expired.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const revoked = await mint(j).expect(201);
    await api().delete(`/api/v1/safety-sessions/${j.id}/links/${revoked.body.id}`).set(auth(j.token)).expect(204);
    const results = await Promise.all([`x`.repeat(43), tokenOf(expired.body.path), tokenOf(revoked.body.path), 'short', '../../etc/passwd'].map((t) => api().get(`/api/v1/j/${encodeURIComponent(t)}`)));
    for (const r of results) expect(r.status).toBe(404);
    expect(new Set(results.map((r) => r.text.replace(/"reference":"[^"]+"/, ''))).size).toBe(1);
    await view(tokenOf(live.body.path)).expect(200);
  });

  it('revoking stops it AT ONCE, and revoking twice is harmless', async () => {
    const j = await journey('revoke');
    const r = await mint(j).expect(201);
    const t = tokenOf(r.body.path);
    await view(t).expect(200);
    await api().delete(`/api/v1/safety-sessions/${j.id}/links/${r.body.id}`).set(auth(j.token)).expect(204);
    await view(t).expect(404);
    await api().post(`/api/v1/j/${t}/respond`).expect(404);
    await api().delete(`/api/v1/safety-sessions/${j.id}/links/${r.body.id}`).set(auth(j.token)).expect(204);
    await api().delete(`/api/v1/safety-sessions/${j.id}/links/${randomUUID()}`).set(auth(j.token)).expect(404);
  });

  it('another journey\'s link id cannot be revoked through yours', async () => {
    const a = await journey('rev_a');
    const b = await journey('rev_b');
    const linkB = await mint(b).expect(201);
    await api().delete(`/api/v1/safety-sessions/${a.id}/links/${linkB.body.id}`).set(auth(a.token)).expect(404);
    await view(tokenOf(linkB.body.path)).expect(200);
  });

  it('a link for one journey shows nothing of another, even the same person\'s earlier one', async () => {
    const j = await journey('twice');
    const old = tokenOf((await mint(j).expect(201)).body.path);
    await api().post(`/api/v1/safety-sessions/${j.id}/cancel`).set(auth(j.token)).expect(200);
    const r = await api().post('/api/v1/safety-sessions').set(auth(j.token)).send({ kind: 'ride', expectedArrivalAt: new Date(Date.now() + 20 * MIN).toISOString() }).expect(201);
    const body = (await view(old).expect(200)).body;
    expect(body.status.code).toBe('cancelled'); // the OLD journey, not the new one
    expect(JSON.stringify(body)).not.toContain(r.body.id);
  });

  it('counts how often it is opened, and the person can see that; the response never carries the token', async () => {
    const j = await journey('views');
    const r = await mint(j).expect(201);
    const t = tokenOf(r.body.path);
    await view(t).expect(200); await view(t).expect(200);
    const list = (await api().get(`/api/v1/safety-sessions/${j.id}/links`).set(auth(j.token)).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ viewCount: 2, live: true, hasPin: false });
    expect(list[0].lastViewedAt).not.toBeNull();
    expect(JSON.stringify(list)).not.toContain(t);
  });

  it('the response is not cacheable', async () => {
    const j = await journey('cache');
    const r = await view(tokenOf((await mint(j).expect(201)).body.path)).expect(200);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('no token appears in any log line, even for a server error on its path', async () => {
    const j = await journey('logs');
    const t = tokenOf((await mint(j).expect(201)).body.path);
    await view(t);
    await api().post(`/api/v1/j/${t}/respond`);
    await view('z'.repeat(43));
    const svc = (app.get(JourneyLinkService) as any);
    const original = svc.lookup.bind(svc);
    svc.lookup = async () => { throw new Error('boom'); };
    const failed = await view(t);
    svc.lookup = original;
    expect(failed.status).toBe(500);
    expect(lines.filter((l) => l.includes(t))).toEqual([]);
  });
});

describe('the optional PIN', () => {
  it('hashes with a salt, and matches only the right PIN', () => {
    const h = hashPin('4821');
    expect(h).not.toContain('4821');
    expect(hashPin('4821')).not.toBe(h); // salted
    expect(pinMatches('4821', h)).toBe(true);
    expect(pinMatches('4822', h)).toBe(false);
    expect(pinMatches('4821', 'garbage')).toBe(false);
  });

  it('with a PIN set, nothing is shown without it or with a wrong one, and everything with the right one', async () => {
    const j = await journey('pin');
    const r = await mint(j, { pin: '4821' }).expect(201);
    expect(r.body.hasPin).toBe(true);
    const t = tokenOf(r.body.path);
    const none = await view(t).expect(401);
    expect(none.body.pinRequired).toBe(true);
    expect(JSON.stringify(none.body)).not.toContain('Joyce');
    await view(t, '0000').expect(401);
    expect((await view(t, '4821').expect(200)).body.who).toContain('Joyce');
    await api().post(`/api/v1/j/${t}/respond`).expect(401);
  });

  it(`the link locks for good after ${MAX_PIN_FAILURES} wrong guesses, even if the next one is right`, async () => {
    const j = await journey('pinlock');
    const r = await mint(j, { pin: '4821' }).expect(201);
    const t = tokenOf(r.body.path);
    for (let i = 0; i < MAX_PIN_FAILURES; i++) await view(t, '1111').expect(401);
    await view(t, '4821').expect(404);
    expect((await prisma.journeyLink.findUniqueOrThrow({ where: { id: r.body.id } })).revokedAt).not.toBeNull();
  });
});

describe('"I\'m responding" through the link', () => {
  async function alerted(label: string) {
    const j = await journey(label);
    const t = tokenOf((await mint(j).expect(201)).body.path);
    const dueAt = (await row(j.id)).checkInDueAt!.getTime();
    await sessions.tick(j.id, 'deadline', dueAt, new Date(dueAt + 1000));
    await sessions.tick(j.id, 'grace', dueAt, new Date(dueAt + 181_000));
    const incident = (await prisma.emergencyIncident.findFirstOrThrow({ where: { sessionId: j.id } }));
    return { ...j, t, incidentId: incident.id };
  }

  it('is not offered, and does nothing, when there is no alert', async () => {
    const j = await journey('noalert');
    const t = tokenOf((await mint(j).expect(201)).body.path);
    expect((await view(t).expect(200)).body.canRespond).toBe(false);
    const r = await api().post(`/api/v1/j/${t}/respond`).expect(200);
    expect(r.body).toMatchObject({ canRespond: false, responding: false });
    expect(await prisma.incidentEvent.count({ where: { incident: { sessionId: j.id }, event: 'ACK_RECEIVED' } })).toBe(0);
  });

  it('acknowledges the incident, halts the escalation, and is recorded as someone holding the link', async () => {
    const a = await alerted('ack');
    expect((await view(a.t).expect(200)).body.canRespond).toBe(true);
    const r = await api().post(`/api/v1/j/${a.t}/respond`).expect(200);
    expect(r.body).toMatchObject({ responding: true });
    const inc = await prisma.emergencyIncident.findUniqueOrThrow({ where: { id: a.incidentId } });
    expect(inc.state).toBe('ACKNOWLEDGED');
    expect((inc.ladder as { phase: string }).phase).toBe('HALTED');
    const ev = await prisma.incidentEvent.findFirstOrThrow({ where: { incidentId: a.incidentId, event: 'ACK_RECEIVED' } });
    expect(ev).toMatchObject({ actor: 'contact', reason: 'ACK_VIA_LINK' });
  });

  it('a second tap is harmless; "I can\'t help after all" resumes the escalation', async () => {
    const a = await alerted('unack');
    await api().post(`/api/v1/j/${a.t}/respond`).expect(200);
    await api().post(`/api/v1/j/${a.t}/respond`).expect(200);
    expect(await prisma.incidentEvent.count({ where: { incidentId: a.incidentId, event: 'ACK_RECEIVED' } })).toBe(1);
    const r = await api().post(`/api/v1/j/${a.t}/unrespond`).expect(200);
    expect(r.body.responding).toBe(false);
    const inc = await prisma.emergencyIncident.findUniqueOrThrow({ where: { id: a.incidentId } });
    expect(inc.state).not.toBe('ACKNOWLEDGED');
    expect((inc.ladder as { phase: string }).phase).toBe('RUNNING');
  });

  it('the person is told on their own screen (the incident view shows it acknowledged)', async () => {
    const a = await alerted('told');
    await api().post(`/api/v1/j/${a.t}/respond`).expect(200);
    const v = await api().get(`/api/v1/incidents/${a.incidentId}`).set(auth(a.token)).expect(200);
    expect(v.body.state).toBe('ACKNOWLEDGED');
  });

  it('a link that is expired or revoked cannot respond', async () => {
    const a = await alerted('deadlink');
    const links = (await api().get(`/api/v1/safety-sessions/${a.id}/links`).set(auth(a.token)).expect(200)).body;
    await api().delete(`/api/v1/safety-sessions/${a.id}/links/${links[0].id}`).set(auth(a.token)).expect(204);
    await api().post(`/api/v1/j/${a.t}/respond`).expect(404);
    expect((await prisma.emergencyIncident.findUniqueOrThrow({ where: { id: a.incidentId } })).state).not.toBe('ACKNOWLEDGED');
  });
});
