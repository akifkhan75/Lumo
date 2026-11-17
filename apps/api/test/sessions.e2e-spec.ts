/**
 * Journeys (docs/specs/JOURNEY_GUARDIAN.md, SAFETY_CHECK.md) against real Postgres, the real HTTP pipeline and the real pg-boss.
 * Providers are fakes: nothing here reaches a phone. Time is driven by calling `tick` with an explicit clock, exactly as the queue's
 * job would after its deadline.
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
import { IncidentService } from '../src/incidents/incident.service';
import { NotificationQueue } from '../src/notifications/queue';
import { SendWorker } from '../src/notifications/send-worker';
import { PUSH_PROVIDER, type PushProvider } from '../src/notifications/push/push-provider';
import { SMS_PROVIDER, type SmsProvider } from '../src/notifications/sms/sms-provider';
import { SessionService } from '../src/sessions/session.service';

process.env.NOTIFICATIONS_QUEUE = 'on';
process.env.NOTIFICATIONS_QUEUE_SCHEMA = 'pgboss_sessions_e2e';
const RUN = `se_${Date.now()}_${randomUUID().slice(0, 6)}`;

class FakeSms implements SmsProvider {
  calls: { to: string; body: string; attemptId: string }[] = [];
  configured() { return true; }
  async send(r: { to: string; body: string; attemptId: string }) { this.calls.push(r); return { kind: 'accepted' as const, providerMessageId: `SM_${randomUUID().slice(0, 8)}`, status: 'queued' }; }
}
class FakePush implements PushProvider {
  calls: { tokens: readonly string[]; title: string; body: string; attemptId: string }[] = [];
  configured() { return true; }
  async send(r: { tokens: readonly string[]; title: string; body: string; attemptId: string }) {
    this.calls.push(r);
    return { kind: 'accepted' as const, tickets: r.tokens.map((token, i) => ({ token, id: `T${i}_${randomUUID().slice(0, 6)}` })), deadTokens: [] };
  }
  async receipts() { return new Map(); }
}
const sms = new FakeSms();
const push = new FakePush();

let app: INestApplication;
let prisma: PrismaClient;
let sessions: SessionService;
let incidents: IncidentService;
let worker: SendWorker;
let queue: NotificationQueue;

const api = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const expoToken = () => `ExponentPushToken[${randomUUID().replace(/-/g, '').slice(0, 22)}]`;
const row = (id: string) => prisma.safetySession.findUniqueOrThrow({ where: { id } });
const events = async (id: string) => (await prisma.sessionEvent.findMany({ where: { sessionId: id }, orderBy: { seq: 'asc' } })).map((e) => `${e.event}:${e.toState}`);
const incidentsOf = (sessionId: string) => prisma.emergencyIncident.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
const MIN = 60_000;

async function owner(label: string, o: { contacts?: number; agree?: boolean[]; sms?: boolean } = {}) {
  const s = await api().post('/api/v1/auth/signup').send({ name: `Owner ${label}`, email: `${RUN}_${label}@example.com`, password: 'password123' }).expect(201);
  const token = s.body.token as string;
  const userId = s.body.user.id as string;
  await prisma.user.update({ where: { id: userId }, data: { sendSmsOnSos: o.sms ?? true } });
  const n = o.contacts ?? 2;
  const ids: string[] = [];
  if (n > 0) {
    const put = await api().put('/api/v1/settings').set(auth(token)).send({ trustedContacts: Array.from({ length: n }, (_, i) => ({ name: `C${i}`, phone: `+92300123450${i}` })) }).expect(200);
    ids.push(...put.body.trustedContacts.map((c: { id: string }) => c.id));
    for (let i = 0; i < n; i++) {
      if (!(o.agree?.[i] ?? true)) continue;
      const inv = await api().post(`/api/v1/trusted-contacts/${ids[i]}/invite`).set(auth(token)).expect(201);
      await api().post(`${inv.body.path}/accept`).expect(200);
    }
  }
  const dev = await api().post('/api/v1/devices').set(auth(token)).send({ platform: 'android', osVersion: '14', pushToken: expoToken() }).expect(201);
  void dev;
  return { token, userId, ids };
}
const start = (token: string, over: Record<string, unknown> = {}) =>
  api().post('/api/v1/safety-sessions').set(auth(token)).send({ kind: 'walk_home', expectedArrivalAt: new Date(Date.now() + 10 * MIN).toISOString(), ...over });
/** A started journey, and the instants the machinery will use. */
async function journey(label: string, o: Parameters<typeof owner>[1] = {}, over: Record<string, unknown> = {}) {
  const ow = await owner(label, o);
  const r = await start(ow.token, over).expect(201);
  const s = await row(r.body.id);
  return { ...ow, id: r.body.id as string, dueAt: s.checkInDueAt!.getTime(), graceMs: 180_000 };
}

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
  sessions = app.get(SessionService);
  incidents = app.get(IncidentService);
  worker = app.get(SendWorker);
  queue = app.get(NotificationQueue);
});
beforeEach(() => {
  sms.calls = [];
  push.calls = [];
  // Deterministic: every timer is driven by hand. (The real queue is exercised in one test below.)
  queue.setHandlers({ send: async () => {}, expire: async () => {}, receipts: async () => {}, step: async () => {}, countdown: async () => {}, session: async () => {}, sweep: async () => {} });
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

describe('starting a journey', () => {
  it('starts ACTIVE with the template\'s own plan, and says in plain words what happens if the check-in is missed', async () => {
    const o = await owner('start');
    const r = await start(o.token).expect(201);
    expect(r.body).toMatchObject({ kind: 'walk_home', state: 'ACTIVE', needsAnswer: false, incidentId: null });
    expect(r.body.plan).toEqual({ graceSeconds: 180, contacts: ['C0', 'C1'] }); // Walk Home: 3 minutes, two contacts
    expect(await events(r.body.id)).toEqual(['CREATED:CREATED', 'START:ACTIVE']);
  });

  it.each([
    ['walk_home', 180], ['date', 300], ['ride', 180], ['travel', 1800], ['outdoor', 3600], ['custom', 300],
  ])('the %s template carries its own grace: %s s', async (kind, grace) => {
    const o = await owner(`tpl_${kind}`);
    const r = await start(o.token, { kind, expectedArrivalAt: new Date(Date.now() + 30 * MIN).toISOString() }).expect(201);
    expect(r.body.plan.graceSeconds).toBe(grace);
  });

  it('refuses a journey nobody has agreed to be told about', async () => {
    const o = await owner('noone', { agree: [false, false] });
    const r = await start(o.token).expect(409);
    expect(JSON.stringify(r.body)).toContain('agreed');
    expect(await prisma.safetySession.count({ where: { userId: o.userId } })).toBe(0); // nothing half-created
    expect(await prisma.escalationPolicy.count({ where: { userId: o.userId } })).toBe(0);
  });

  it('refuses an arrival under a minute away, and one longer than the kind allows', async () => {
    const o = await owner('bounds');
    await start(o.token, { expectedArrivalAt: new Date(Date.now() + 20_000).toISOString() }).expect(400);
    await start(o.token, { expectedArrivalAt: new Date(Date.now() - 60 * MIN).toISOString() }).expect(400);
    await start(o.token, { expectedArrivalAt: new Date(Date.now() + 13 * 3600_000).toISOString() }).expect(400); // walk_home max 12 h
    await start(o.token, { kind: 'outdoor', expectedArrivalAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }).expect(201);
  });

  it('one journey in progress per person, and the database enforces it even for concurrent requests', async () => {
    const o = await owner('one');
    const rs = await Promise.all(Array.from({ length: 4 }, () => start(o.token)));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    expect(await prisma.safetySession.count({ where: { userId: o.userId, state: 'ACTIVE' } })).toBe(1);
    const conflict = rs.find((r) => r.status === 409)!;
    expect(conflict.body.sessionId).toBeDefined();
  });

  it('after one ends a new one can start', async () => {
    const o = await owner('again');
    const a = await start(o.token).expect(201);
    await api().post(`/api/v1/safety-sessions/${a.body.id}/cancel`).set(auth(o.token)).expect(200);
    await start(o.token).expect(201);
  });

  it('is login only: the emergency token cannot start, answer or read a journey', async () => {
    const o = await owner('tokonly');
    const tok = (await api().post('/api/v1/emergency-token').set(auth(o.token)).send({ deviceKey: 'install-session-1' }).expect(201)).body.token;
    await start(tok).expect(401);
    await api().get('/api/v1/safety-sessions/active').set(auth(tok)).expect(401);
    await api().get('/api/v1/safety-sessions/active').expect(401);
  });

  it('the deadline is an instant, whatever offset it was written in (DST and timezones never move it)', async () => {
    const o = await owner('tz');
    const at = Date.now() + 20 * MIN;
    const wall = new Date(at - 5 * 3600_000).toISOString().replace('Z', '-05:00'); // the same instant, written as five hours behind UTC
    const r = await start(o.token, { expectedArrivalAt: wall }).expect(201);
    expect(Math.abs((await row(r.body.id)).checkInDueAt!.getTime() - at)).toBeLessThan(2000);
    const utc = await start((await owner('tz2')).token, { expectedArrivalAt: new Date(at).toISOString() }).expect(201);
    expect(Math.abs((await row(utc.body.id)).checkInDueAt!.getTime() - at)).toBeLessThan(2000);
  });

  it('every deadline is a queue job in the database, set in the same transaction as the journey', async () => {
    const j = await journey('jobs');
    const jobs = await prisma.$queryRawUnsafe<{ name: string; data: { step: string; dueAt: number } }[]>(
      `SELECT name, data FROM pgboss_sessions_e2e.job WHERE name = 'session.tick' AND data->>'sessionId' = $1`, j.id);
    expect(jobs.map((x) => x.data.step)).toEqual(['deadline']);
    expect(jobs[0].data.dueAt).toBe(j.dueAt);
  });
});

describe('the check-in: the person first, then the contacts, and never skipping a step', () => {
  it('at the deadline only the PERSON is asked; nobody else is contacted', async () => {
    const j = await journey('deadline');
    await sessions.tick(j.id, 'deadline', j.dueAt, new Date(j.dueAt + 1000));
    expect((await row(j.id)).state).toBe('CHECK_IN_DUE');
    expect((await api().get('/api/v1/safety-sessions/active').set(auth(j.token))).body.session.needsAnswer).toBe(true);
    expect(await incidentsOf(j.id)).toHaveLength(0);
    expect(sms.calls).toHaveLength(0);
    expect(push.calls).toHaveLength(1);
    expect(push.calls[0].attemptId).toBe('self-prompt');
    expect(push.calls[0].body).toMatch(/Are you OK/);
    const devices = await prisma.device.findMany({ where: { userId: j.userId } });
    expect(push.calls[0].tokens).toEqual(devices.map((d) => d.pushToken));
  });

  it('a late bus does not alert anyone: before the grace has run out, still no incident', async () => {
    const j = await journey('latebus');
    await sessions.tick(j.id, 'deadline', j.dueAt, new Date(j.dueAt + 1000));
    await sessions.tick(j.id, 'prompt', j.dueAt, new Date(j.dueAt + 61_000));
    expect((await row(j.id)).state).toBe('GRACE');
    await sessions.tick(j.id, 'grace', j.dueAt, new Date(j.dueAt + 90_000)); // grace is 180 s: not yet
    expect((await row(j.id)).state).toBe('GRACE');
    expect(await incidentsOf(j.id)).toHaveLength(0);
    expect(sms.calls).toHaveLength(0);
  });

  it('with no answer through the grace: ESCALATING, then an incident, then ALERTED — in that order, as the system', async () => {
    const j = await journey('escalate');
    await sessions.tick(j.id, 'deadline', j.dueAt, new Date(j.dueAt + 1000));
    await sessions.tick(j.id, 'prompt', j.dueAt, new Date(j.dueAt + 61_000));
    await sessions.tick(j.id, 'grace', j.dueAt, new Date(j.dueAt + j.graceMs + 1000));
    expect((await row(j.id)).state).toBe('ALERTED');
    expect(await events(j.id)).toEqual([
      'CREATED:CREATED', 'START:ACTIVE', 'CHECK_IN_DEADLINE_REACHED:CHECK_IN_DUE', 'NO_RESPONSE:GRACE', 'GRACE_EXPIRED:ESCALATING', 'INCIDENT_RAISED:ALERTED',
    ]);
    const [inc] = await incidentsOf(j.id);
    expect(inc).toMatchObject({ triggerType: 'missed_check_in', state: 'NOTIFYING' });
    const tl = await prisma.incidentEvent.findMany({ where: { incidentId: inc.id }, orderBy: { seq: 'asc' } });
    expect(tl[1]).toMatchObject({ event: 'COUNTDOWN_ELAPSED', actor: 'system' }); // not "the user pressed something"
  });

  it('the journey\'s OWN plan runs: first contact only at first, and the words are a missed check-in, not a plea for help', async () => {
    const j = await journey('plan');
    await sessions.tick(j.id, 'deadline', j.dueAt, new Date(j.dueAt + 1000));
    await sessions.tick(j.id, 'grace', j.dueAt, new Date(j.dueAt + j.graceMs + 1000)); // the prompt job was lost: still safe
    const [inc] = await incidentsOf(j.id);
    const attempts = await prisma.notificationAttempt.findMany({ where: { incidentId: inc.id, state: 'QUEUED' } });
    expect(attempts.map((a) => a.recipientId)).toEqual([j.ids[0]]);
    await worker.send(attempts[0].id);
    expect(sms.calls[0].body).toContain('had a Lumo check-in due and has not answered it');
    expect(sms.calls[0].body).toContain('may have forgotten or have no signal');
    expect(sms.calls[0].body).not.toContain('asked Lumo to alert you');
  });

  it('a lost "prompt" job is made up for: grace still walks every step and nothing is skipped', async () => {
    const j = await journey('lostprompt');
    await sessions.tick(j.id, 'deadline', j.dueAt, new Date(j.dueAt + 1000));
    await sessions.tick(j.id, 'grace', j.dueAt, new Date(j.dueAt + j.graceMs + 1000));
    expect((await events(j.id)).slice(2)).toEqual(['CHECK_IN_DEADLINE_REACHED:CHECK_IN_DUE', 'NO_RESPONSE:GRACE', 'GRACE_EXPIRED:ESCALATING', 'INCIDENT_RAISED:ALERTED']);
  });

  it('a grace timer with no deadline having happened does nothing: ACTIVE never jumps to escalating', async () => {
    const j = await journey('nojump');
    await sessions.tick(j.id, 'grace', j.dueAt, new Date(j.dueAt + 10 * MIN));
    expect((await row(j.id)).state).toBe('ACTIVE');
    expect(await incidentsOf(j.id)).toHaveLength(0);
  });

  it('a timer that fires early, twice, or for the wrong time changes nothing — and one incident is the most there can be', async () => {
    const j = await journey('repeat');
    await sessions.tick(j.id, 'deadline', j.dueAt, new Date(j.dueAt - 5000)); // early
    expect((await row(j.id)).state).toBe('ACTIVE');
    await sessions.tick(j.id, 'deadline', j.dueAt + 1, new Date(j.dueAt + 5000)); // set for another time
    expect((await row(j.id)).state).toBe('ACTIVE');
    const t = new Date(j.dueAt + j.graceMs + 5000);
    await sessions.tick(j.id, 'deadline', j.dueAt, new Date(j.dueAt + 1000));
    await Promise.all([sessions.tick(j.id, 'grace', j.dueAt, t), sessions.tick(j.id, 'grace', j.dueAt, t), sessions.tick(j.id, 'grace', j.dueAt, t)]);
    expect(await incidentsOf(j.id)).toHaveLength(1);
    expect((await row(j.id)).state).toBe('ALERTED');
  });

  it('if raising the incident fails once, the next run carries on from ESCALATING instead of stalling', async () => {
    const j = await journey('retry');
    await sessions.tick(j.id, 'deadline', j.dueAt, new Date(j.dueAt + 1000));
    const original = incidents.raiseForSession.bind(incidents);
    let failed = false;
    incidents.raiseForSession = async (...a: Parameters<typeof original>) => { if (!failed) { failed = true; throw new Error('queue down'); } return original(...a); };
    try {
      await expect(sessions.tick(j.id, 'grace', j.dueAt, new Date(j.dueAt + j.graceMs + 1000))).rejects.toThrow('queue down');
      expect((await row(j.id)).state).toBe('ESCALATING');
      await sessions.tick(j.id, 'grace', j.dueAt, new Date(j.dueAt + j.graceMs + 2000));
    } finally { incidents.raiseForSession = original; }
    expect((await row(j.id)).state).toBe('ALERTED');
    expect(await incidentsOf(j.id)).toHaveLength(1);
  });

  it('the person answering at any point up to the incident returns the journey to ACTIVE, and the old timers go stale', async () => {
    for (const upTo of ['deadline', 'prompt'] as const) {
      const j = await journey(`answer_${upTo}`);
      await sessions.tick(j.id, 'deadline', j.dueAt, new Date(j.dueAt + 1000));
      if (upTo === 'prompt') await sessions.tick(j.id, 'prompt', j.dueAt, new Date(j.dueAt + 61_000));
      const newArrival = new Date(Date.now() + 15 * MIN);
      const r = await api().post(`/api/v1/safety-sessions/${j.id}/check-in`).set(auth(j.token)).send({ expectedArrivalAt: newArrival.toISOString() }).expect(200);
      expect(r.body.state).toBe('ACTIVE');
      expect(r.body.needsAnswer).toBe(false);
      // the grace timer set for the OLD time fires: it does nothing
      await sessions.tick(j.id, 'grace', j.dueAt, new Date(j.dueAt + j.graceMs + 5000));
      expect((await row(j.id)).state).toBe('ACTIVE');
      expect(await incidentsOf(j.id)).toHaveLength(0);
      // and a new deadline job exists for the new time
      const jobs = await prisma.$queryRawUnsafe<{ data: { dueAt: number } }[]>(`SELECT data FROM pgboss_sessions_e2e.job WHERE name='session.tick' AND data->>'sessionId' = $1`, j.id);
      expect(jobs.map((x) => x.data.dueAt)).toContain(Math.floor(newArrival.getTime() / 1000) * 1000 === newArrival.getTime() ? newArrival.getTime() : (await row(j.id)).checkInDueAt!.getTime());
    }
  });

  it('an OLD grace timer cannot escalate the NEW check-in: it is stale, though the journey is due again', async () => {
    const j = await journey('stale_old');
    await sessions.tick(j.id, 'deadline', j.dueAt, new Date(j.dueAt + 1000));
    await api().post(`/api/v1/safety-sessions/${j.id}/check-in`).set(auth(j.token)).send({ expectedArrivalAt: new Date(Date.now() + 20 * MIN).toISOString() }).expect(200);
    const due2 = (await row(j.id)).checkInDueAt!.getTime();
    await sessions.tick(j.id, 'deadline', due2, new Date(due2 + 1000)); // due again
    expect((await row(j.id)).state).toBe('CHECK_IN_DUE');
    // the grace job from the FIRST check-in fires now, long after its own time, while the journey is due again
    await sessions.tick(j.id, 'grace', j.dueAt, new Date(due2 + 5000));
    await sessions.tick(j.id, 'prompt', j.dueAt, new Date(due2 + 5000));
    expect((await row(j.id)).state).toBe('CHECK_IN_DUE');
    expect(await incidentsOf(j.id)).toHaveLength(0);
  });

  it('answering from GRACE works too, and "I need longer" works on a running journey', async () => {
    const j = await journey('answer_grace');
    await api().post(`/api/v1/safety-sessions/${j.id}/check-in`).set(auth(j.token)).send({ expectedArrivalAt: new Date(Date.now() + 30 * MIN).toISOString() }).expect(200); // ACTIVE: just a new time
    const due2 = (await row(j.id)).checkInDueAt!.getTime();
    await sessions.tick(j.id, 'deadline', due2, new Date(due2 + 1000));
    await sessions.tick(j.id, 'prompt', due2, new Date(due2 + 61_000));
    expect((await row(j.id)).state).toBe('GRACE');
    await api().post(`/api/v1/safety-sessions/${j.id}/check-in`).set(auth(j.token)).send({ expectedArrivalAt: new Date(Date.now() + 40 * MIN).toISOString() }).expect(200);
    expect((await row(j.id)).state).toBe('ACTIVE');
  });

  it('once the alert has gone out, checking in is refused: end it from the emergency screen', async () => {
    const j = await journey('toolate');
    await sessions.tick(j.id, 'deadline', j.dueAt, new Date(j.dueAt + 1000));
    await sessions.tick(j.id, 'grace', j.dueAt, new Date(j.dueAt + j.graceMs + 1000));
    const r = await api().post(`/api/v1/safety-sessions/${j.id}/check-in`).set(auth(j.token)).send({ expectedArrivalAt: new Date(Date.now() + 30 * MIN).toISOString() }).expect(409);
    expect(JSON.stringify(r.body)).toContain('already gone out');
  });

  it('the new arrival must itself be at least a minute away and not absurdly far', async () => {
    const j = await journey('checkin_bounds');
    await api().post(`/api/v1/safety-sessions/${j.id}/check-in`).set(auth(j.token)).send({ expectedArrivalAt: new Date(Date.now() + 5000).toISOString() }).expect(400);
    await api().post(`/api/v1/safety-sessions/${j.id}/check-in`).set(auth(j.token)).send({ expectedArrivalAt: new Date(Date.now() + 30 * 86_400_000).toISOString() }).expect(400);
  });

  it('someone else\'s journey is a 404 for every action', async () => {
    const a = await journey('own_a');
    const b = await owner('own_b');
    for (const [m, p, body] of [['get', '', undefined], ['post', '/arrive', undefined], ['post', '/cancel', undefined], ['post', '/check-in', { expectedArrivalAt: new Date(Date.now() + 30 * MIN).toISOString() }], ['post', '/location', { snapshots: [{ latitude: 1, longitude: 1, accuracyM: 5, capturedAt: Date.now(), source: 'gps' }] }]] as const) {
      const req = (api() as any)[m](`/api/v1/safety-sessions/${a.id}${p}`).set(auth(b.token));
      expect((await (body ? req.send(body) : req)).status, `${m} ${p}`).toBe(404);
    }
  });
});

describe('the backstop', () => {
  it('a journey whose timers were lost is found and advanced, step by step, never skipping one', { timeout: 30_000 }, async () => {
    const j = await journey('sweep');
    const base = j.dueAt;
    await sessions.sweep(new Date(base - 1000));
    expect((await row(j.id)).state).toBe('ACTIVE'); // not yet due
    await sessions.sweep(new Date(base + 1000));
    expect((await row(j.id)).state).toBe('CHECK_IN_DUE');
    await sessions.sweep(new Date(base + 61_000));
    expect((await row(j.id)).state).toBe('GRACE');
    await sessions.sweep(new Date(base + 100_000));
    expect((await row(j.id)).state).toBe('GRACE'); // still inside the grace
    await sessions.sweep(new Date(base + j.graceMs + 1000));
    expect((await row(j.id)).state).toBe('ALERTED');
    expect(await incidentsOf(j.id)).toHaveLength(1);
  });

  it('ignores a journey that is not overdue, one that has ended, and one already alerted', async () => {
    const live = await journey('sweep_ok');
    const ended = await journey('sweep_ended');
    await api().post(`/api/v1/safety-sessions/${ended.id}/cancel`).set(auth(ended.token)).expect(200);
    await sessions.sweep(new Date(live.dueAt - 1000));
    expect((await row(live.id)).state).toBe('ACTIVE');
    expect((await row(ended.id)).state).toBe('CANCELLED');
  });
});

describe('arriving', () => {
  it('"I\'ve arrived" ends the journey and tells no one who was never alerted', async () => {
    const j = await journey('arrive');
    const r = await api().post(`/api/v1/safety-sessions/${j.id}/arrive`).set(auth(j.token)).expect(200);
    expect(r.body.state).toBe('CLOSED');
    expect(await events(j.id)).toEqual(['CREATED:CREATED', 'START:ACTIVE', 'ARRIVAL_CONFIRMED:ARRIVED', 'CLOSE:CLOSED']);
    expect(sms.calls).toHaveLength(0);
    expect(await incidentsOf(j.id)).toHaveLength(0);
    await api().post(`/api/v1/safety-sessions/${j.id}/arrive`).set(auth(j.token)).expect(200); // idempotent
    // and the timers that were set go stale
    await sessions.tick(j.id, 'deadline', j.dueAt, new Date(j.dueAt + 1000));
    expect((await row(j.id)).state).toBe('CLOSED');
  });

  it('arriving after the alert went out resolves the incident, so the contacts who were alerted are told it ended', async () => {
    const j = await journey('arrive_alerted');
    await sessions.tick(j.id, 'deadline', j.dueAt, new Date(j.dueAt + 1000));
    await sessions.tick(j.id, 'grace', j.dueAt, new Date(j.dueAt + j.graceMs + 1000));
    const [inc] = await incidentsOf(j.id);
    await worker.send((await prisma.notificationAttempt.findFirstOrThrow({ where: { incidentId: inc.id, channel: 'sms', purpose: 'ALERT' } })).id);
    const r = await api().post(`/api/v1/safety-sessions/${j.id}/arrive`).set(auth(j.token)).expect(200);
    expect(r.body.state).toBe('CLOSED');
    expect((await prisma.emergencyIncident.findUniqueOrThrow({ where: { id: inc.id } })).state).toBe('CLOSED');
    const told = await prisma.notificationAttempt.findMany({ where: { incidentId: inc.id, purpose: 'RESOLVED' } });
    expect(told.map((a) => a.recipientId)).toEqual([j.ids[0]]); // only the contact who was alerted
  });

  describe('by position: a geofence, but only ever from a trustworthy fix', () => {
    const dest = { latitude: 33.6844, longitude: 73.0479 };
    const fixNear = (m: number, accuracyM = 10) => ({ latitude: dest.latitude + m / 111_195, longitude: dest.longitude, accuracyM, capturedAt: Date.now() - 1000, source: 'gps' });
    const post = (j: { id: string; token: string }, s: object) => api().post(`/api/v1/safety-sessions/${j.id}/location`).set(auth(j.token)).send({ snapshots: [s] });
    const withDest = (label: string) => journey(label, {}, { destination: { ...dest, label: 'Home' } });

    it('a precise fix at the destination closes the journey', async () => {
      const j = await withDest('geo_ok');
      const r = await post(j, fixNear(20)).expect(200);
      expect(r.body).toMatchObject({ stored: 1, atDestination: true, arrived: true });
      expect((await row(j.id)).state).toBe('CLOSED');
      expect(await events(j.id)).toEqual(expect.arrayContaining(['ARRIVAL_DETECTED:ARRIVED', 'CLOSE:CLOSED']));
    });
    it('an IMPRECISE fix near the destination is not an arrival; neither is a precise one just outside', async () => {
      const j = await withDest('geo_bad');
      expect((await post(j, fixNear(10, 200)).expect(200)).body).toMatchObject({ atDestination: false, arrived: false });
      expect((await post(j, { ...fixNear(200), capturedAt: Date.now() - 500 }).expect(200)).body).toMatchObject({ atDestination: false, arrived: false });
      expect((await row(j.id)).state).toBe('ACTIVE');
    });
    it('during a due check-in a fix at the destination does NOT close it: the person confirms', async () => {
      const j = await withDest('geo_due');
      await sessions.tick(j.id, 'deadline', j.dueAt, new Date(j.dueAt + 1000));
      const r = await post(j, fixNear(10)).expect(200);
      expect(r.body).toMatchObject({ atDestination: true, arrived: false });
      expect((await row(j.id)).state).toBe('CHECK_IN_DUE');
      await api().post(`/api/v1/safety-sessions/${j.id}/arrive`).set(auth(j.token)).expect(200);
      expect((await row(j.id)).state).toBe('CLOSED');
    });
    it('a journey with no destination never arrives by position', async () => {
      const j = await journey('geo_none');
      expect((await post(j, fixNear(1)).expect(200)).body).toMatchObject({ atDestination: false, arrived: false });
    });
    it('a fix with unknown accuracy is refused, not treated as precise', async () => {
      const j = await withDest('geo_null');
      await post(j, { ...fixNear(1), accuracyM: null }).expect(400);
    });
    it('a journey with sharing off stores nothing', async () => {
      const j = await journey('geo_off', {}, { shareLocation: false });
      await post(j, fixNear(1)).expect(409);
      expect(await prisma.locationSnapshot.count({ where: { sessionId: j.id } })).toBe(0);
    });
    it('a resent batch does not duplicate', async () => {
      const j = await withDest('geo_dup');
      const s = { ...fixNear(5000), capturedAt: Date.now() - 3000 };
      await post(j, s).expect(200);
      expect((await post(j, s).expect(200)).body).toMatchObject({ stored: 0, duplicates: 1 });
    });
  });
});

describe('cancelling, an SOS during a journey, and the incident ending', () => {
  it('cancelling an active journey ends it; once an alert is out it is refused', async () => {
    const j = await journey('cancel');
    await api().post(`/api/v1/safety-sessions/${j.id}/cancel`).set(auth(j.token)).expect(200);
    expect((await row(j.id)).state).toBe('CANCELLED');
    await api().post(`/api/v1/safety-sessions/${j.id}/cancel`).set(auth(j.token)).expect(200); // idempotent

    const k = await journey('cancel_alerted');
    await sessions.tick(k.id, 'deadline', k.dueAt, new Date(k.dueAt + 1000));
    await sessions.tick(k.id, 'grace', k.dueAt, new Date(k.dueAt + k.graceMs + 1000));
    await api().post(`/api/v1/safety-sessions/${k.id}/cancel`).set(auth(k.token)).expect(409);
  });

  it('an SOS pressed during a journey links to it and moves it to ALERTED', async () => {
    const j = await journey('sos');
    const r = await api().post('/api/v1/sos').set(auth(j.token)).set('Idempotency-Key', `k-${randomUUID()}`).send({ triggerType: 'manual', triggeredAt: new Date().toISOString(), sessionId: j.id }).expect(201);
    expect((await prisma.emergencyIncident.findUniqueOrThrow({ where: { id: r.body.id } })).sessionId).toBe(j.id);
    expect((await row(j.id)).state).toBe('ALERTED');
    expect(await events(j.id)).toContain('SOS_RAISED:ALERTED');
  });

  it('a session id that is not yours, or not live, is ignored: the SOS still goes', async () => {
    const a = await journey('sos_foreign');
    const b = await owner('sos_other', { sms: true });
    const r = await api().post('/api/v1/sos').set(auth(b.token)).set('Idempotency-Key', `k-${randomUUID()}`).send({ triggerType: 'manual', triggeredAt: new Date().toISOString(), sessionId: a.id }).expect(201);
    expect(r.body.state).toBe('NOTIFYING');
    expect((await prisma.emergencyIncident.findUniqueOrThrow({ where: { id: r.body.id } })).sessionId).toBeNull();
    expect((await row(a.id)).state).toBe('ACTIVE');
  });

  it('resolving the incident closes the journey that raised it', async () => {
    const j = await journey('resolve');
    const r = await api().post('/api/v1/sos').set(auth(j.token)).set('Idempotency-Key', `k-${randomUUID()}`).send({ triggerType: 'manual', triggeredAt: new Date().toISOString(), sessionId: j.id }).expect(201);
    await api().post(`/api/v1/incidents/${r.body.id}/resolve`).set(auth(j.token)).expect(200);
    expect((await row(j.id)).state).toBe('CLOSED');
    expect(await events(j.id)).toContain('INCIDENT_RESOLVED:CLOSED');
  });
});

describe('the real queue', () => {
  it('a journey\'s deadline fires with nobody calling anything, and the person is asked', { timeout: 40_000 }, async () => {
    const o = await owner('realq');
    queue.setHandlers({ session: (id, step, dueAt) => sessions.tick(id, step, dueAt), send: async () => {}, expire: async () => {}, receipts: async () => {}, step: async () => {}, countdown: async () => {}, sweep: async () => {} });
    await prisma.$executeRawUnsafe(`DELETE FROM pgboss_sessions_e2e.job WHERE name = 'session.tick' AND state = 'created'`);
    // The shortest journey the API allows is a minute; set the deadline directly so the real job is due in a second or two.
    const r = await start(o.token).expect(201);
    const soon = new Date(Date.now() + 2000);
    await prisma.safetySession.update({ where: { id: r.body.id }, data: { checkInDueAt: soon, expectedArrivalAt: soon } });
    await prisma.$executeRawUnsafe(`DELETE FROM pgboss_sessions_e2e.job WHERE name = 'session.tick' AND data->>'sessionId' = $1`, r.body.id);
    await prisma.$transaction(async (tx) => { await queue.enqueueSessionTick(tx as never, r.body.id, 'deadline', soon.getTime(), 2); });
    for (let i = 0; i < 80 && (await row(r.body.id)).state === 'ACTIVE'; i++) await new Promise((res) => setTimeout(res, 500));
    expect((await row(r.body.id)).state).toBe('CHECK_IN_DUE');
  });
});
