/**
 * Incident history and the exportable timeline (docs/specs/INCIDENT_HISTORY.md, PRO-9) against real Postgres and the real HTTP pipeline.
 * Fake providers: nothing here reaches a phone. What is proven is what is shown, to whom, and what is left out.
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
import { NotificationQueue } from '../src/notifications/queue';
import { PUSH_PROVIDER, type PushProvider } from '../src/notifications/push/push-provider';
import { SMS_PROVIDER, type SmsOutcome, type SmsProvider } from '../src/notifications/sms/sms-provider';
import { timelineToCsv } from '../src/incidents/incident-history.service';

process.env.NOTIFICATIONS_QUEUE = 'on';
process.env.NOTIFICATIONS_QUEUE_SCHEMA = 'pgboss_history_e2e';
const RUN = `ih_${Date.now()}_${randomUUID().slice(0, 6)}`;

class FakeSms implements SmsProvider {
  configured() { return true; }
  async send(): Promise<SmsOutcome> { return { kind: 'accepted', providerMessageId: `SM_${randomUUID().slice(0, 8)}`, status: 'queued' }; }
}
class FakePush implements PushProvider {
  configured() { return true; }
  async send(r: { tokens: readonly string[] }) { return { kind: 'accepted' as const, tickets: r.tokens.map((token, i) => ({ token, id: `T${i}` })), deadTokens: [] }; }
  async receipts() { return new Map(); }
}

let app: INestApplication;
let prisma: PrismaClient;
const api = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const key = () => `k-${randomUUID()}`;
const PHONES = ['+923001234500', '+923001234501'];

async function owner(label: string, o: { contacts?: string[] } = {}) {
  const s = await api().post('/api/v1/auth/signup').send({ name: `Owner ${label}`, email: `${RUN}_${label}@example.com`, password: 'password123' }).expect(201);
  const token = s.body.token as string;
  const userId = s.body.user.id as string;
  await prisma.user.update({ where: { id: userId }, data: { sendSmsOnSos: true } });
  const names = o.contacts ?? ['Maya', 'Dad'];
  if (names.length > 0) {
    const put = await api().put('/api/v1/settings').set(auth(token)).send({ trustedContacts: names.map((name, i) => ({ name, phone: PHONES[i] ?? `+92300123460${i}` })) }).expect(200);
    for (const c of put.body.trustedContacts as { id: string }[]) {
      const inv = await api().post(`/api/v1/trusted-contacts/${c.id}/invite`).set(auth(token)).expect(201);
      await api().post(`${inv.body.path}/accept`).expect(200);
    }
  }
  return { token, userId };
}
const body = (over: Record<string, unknown> = {}) => ({ triggerType: 'manual', triggeredAt: new Date().toISOString(), ...over });
const sos = (token: string, b: Record<string, unknown> = body(), k = key()) => api().post('/api/v1/sos').set(auth(token)).set('Idempotency-Key', k).send(b);
const list = (token: string, q = '') => api().get(`/api/v1/incidents${q}`).set(auth(token));
const timeline = (token: string, id: string, q = '') => api().get(`/api/v1/incidents/${id}/timeline${q}`).set(auth(token));

beforeAll(async () => {
  prisma = new PrismaClient();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getOptionsToken()).useValue([{ name: 'short', ttl: 1000, limit: 1_000_000 }])
    .overrideProvider(SMS_PROVIDER).useValue(new FakeSms())
    .overrideProvider(PUSH_PROVIDER).useValue(new FakePush())
    .compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
});
beforeEach(() => { app.get(NotificationQueue).setHandlers({ send: async () => {}, expire: async () => {}, receipts: async () => {} }); });
afterAll(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lumo.erasure = 'on'`;
    await tx.contactInvite.deleteMany({ where: { contact: { user: { email: { startsWith: RUN } } } } });
    await tx.user.deleteMany({ where: { email: { startsWith: RUN } } });
  });
  await prisma.$disconnect();
  await app.close();
});

describe('the list', () => {
  it('is the caller\'s own incidents, newest first, with counts and no names', async () => {
    const o = await owner('own');
    const a = await sos(o.token).expect(201);
    const b = await sos(o.token).expect(201);
    const r = await list(o.token).expect(200);
    expect(r.body.incidents.map((i: { id: string }) => i.id)).toEqual([b.body.id, a.body.id]);
    const first = r.body.incidents[0];
    expect(first).toMatchObject({ mode: 'real', triggerType: 'manual', contactsTried: 2 });
    expect(JSON.stringify(r.body)).not.toMatch(/Maya|Dad|\+9230/); // who and how: the timeline's business, behind a tap
    expect(r.body.nextCursor).toBeNull();
  });

  it('never shows another user\'s incidents', async () => {
    const a = await owner('iso_a'); const b = await owner('iso_b');
    await sos(a.token).expect(201);
    expect((await list(b.token).expect(200)).body.incidents).toEqual([]);
  });

  it('keeps rehearsals OUT of the history, and shows them only when asked, and then ONLY them', async () => {
    const o = await owner('mix');
    const real = await sos(o.token).expect(201);
    const prac = await sos(o.token, body({ mode: 'practice' })).expect(201);
    const history = (await list(o.token).expect(200)).body.incidents;
    expect(history.map((i: { id: string }) => i.id)).toEqual([real.body.id]);
    expect(history.every((i: { mode: string }) => i.mode === 'real')).toBe(true);
    const rehearsals = (await list(o.token, '?mode=practice').expect(200)).body.incidents;
    expect(rehearsals.map((i: { id: string }) => i.id)).toEqual([prac.body.id]);
    expect(rehearsals[0].mode).toBe('practice');
  });

  it('pages without repeating or skipping, and says when there is no more', async () => {
    const o = await owner('page', { contacts: ['Maya'] });
    const made: string[] = [];
    for (let i = 0; i < 5; i += 1) made.push((await sos(o.token).expect(201)).body.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const r: request.Response = await list(o.token, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
      seen.push(...r.body.incidents.map((i: { id: string }) => i.id));
      cursor = r.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual([...made].reverse());
    expect(new Set(seen).size).toBe(5);
  });

  it('refuses a made-up page marker plainly, and an over-large page', async () => {
    const o = await owner('cursor');
    await list(o.token, '?cursor=not-a-marker').expect(400);
    await list(o.token, '?limit=500').expect(400);
    await list(o.token, '?limit=0').expect(400);
    await list(o.token, '?mode=everything').expect(400);
  });

  it('reports a late alert as late, and a cancelled press as cancelled', async () => {
    const o = await owner('states', { contacts: ['Maya'] });
    const late = await sos(o.token, body({ elapsedSeconds: 600 })).expect(201);
    const k = key();
    await sos(o.token, body({ triggerType: 'shake' }), k).expect(201);
    await api().post('/api/v1/sos/cancel').set(auth(o.token)).set('Idempotency-Key', k).expect(200);
    const rows = (await list(o.token).expect(200)).body.incidents;
    expect(rows.find((i: { id: string }) => i.id === late.body.id).lateBySeconds).toBeGreaterThan(500);
    expect(rows.some((i: { state: string }) => i.state === 'CANCELLED')).toBe(true);
  });

  it('is login only: an emergency token cannot read the person\'s past', async () => {
    const o = await owner('token');
    const tok = (await api().post('/api/v1/emergency-token').set(auth(o.token)).send({ deviceKey: 'install-histhisth' }).expect(201)).body.token as string;
    const made = await sos(o.token).expect(201);
    await list(tok).expect(401);
    await timeline(tok, made.body.id).expect(401);
    await api().get('/api/v1/incidents').expect(401);
  });
});

describe('the timeline', () => {
  it('has every state change and every attempt, in the order they happened, with the contacts\' names', async () => {
    const o = await owner('tl');
    const made = await sos(o.token).expect(201);
    const t = (await timeline(o.token, made.body.id).expect(200)).body;
    expect(t.incident.id).toBe(made.body.id);
    const events = t.entries.filter((e: { kind: string }) => e.kind === 'incident');
    expect(events[0]).toMatchObject({ event: 'CREATED', to: 'CREATED', actor: 'user' });
    expect(events.map((e: { event: string }) => e.event)).toContain('RECIPIENTS_RESOLVED');
    const attempts = t.entries.filter((e: { kind: string }) => e.kind === 'attempt');
    expect(attempts.length).toBeGreaterThan(0);
    expect(new Set(attempts.map((a: { recipient: string }) => a.recipient))).toEqual(new Set(['Maya', 'Dad']));
    // in time order
    const times = t.entries.map((e: { at: string }) => e.at);
    expect([...times].sort()).toEqual(times);
    // every attempt starts as QUEUED, and every entry says whether it is simulated
    expect(attempts.some((a: { to: string; reason: string }) => a.to === 'QUEUED')).toBe(true);
    for (const e of t.entries) expect(e.simulated).toBe(false);
  });

  it('carries NO coordinate and NO phone number, however it is asked for', async () => {
    const o = await owner('priv');
    const made = await sos(o.token, body({ location: { latitude: 33.684412, longitude: 73.047912, accuracyM: 12, capturedAt: Date.now() - 1000 } })).expect(201);
    const json = JSON.stringify((await timeline(o.token, made.body.id).expect(200)).body);
    const csv = (await timeline(o.token, made.body.id, '?format=csv').expect(200)).text;
    for (const out of [json, csv]) {
      expect(out).not.toMatch(/33\.6844|73\.0479/);
      expect(out).not.toMatch(/\+92300|92300123450/);
    }
    expect(JSON.parse(json).incident.locationAvailable).toBe(true); // that one was available, not where
  });

  it('is the caller\'s alone: someone else\'s incident is a 404, not a 403', async () => {
    const a = await owner('tl_a'); const b = await owner('tl_b');
    const made = await sos(a.token).expect(201);
    await timeline(b.token, made.body.id).expect(404);
    await timeline(b.token, randomUUID()).expect(404);
    await timeline(b.token, 'nope').expect(400);
  });

  it('marks a rehearsal\'s every entry as simulated, and its export as a rehearsal', async () => {
    const o = await owner('tl_prac');
    const made = await sos(o.token, body({ mode: 'practice' })).expect(201);
    const t = (await timeline(o.token, made.body.id).expect(200)).body;
    expect(t.incident.mode).toBe('practice');
    const attempts = t.entries.filter((e: { kind: string }) => e.kind === 'attempt');
    expect(attempts.length).toBeGreaterThan(0);
    for (const a of attempts) expect(a.simulated).toBe(true);
    const csv = (await timeline(o.token, made.body.id, '?format=csv').expect(200)).text;
    expect(csv.split('\r\n')[1]).toContain(',practice,'); // the mode is on every row, so a filed-away export still says so
    expect(csv).toContain('SIMULATED_FAILURE');
  });
});

describe('the export', () => {
  it('is a download: CSV with a header row, one row per entry, every row carrying the incident and its mode', async () => {
    const o = await owner('csv');
    const made = await sos(o.token).expect(201);
    const t = (await timeline(o.token, made.body.id).expect(200)).body;
    const r = await timeline(o.token, made.body.id, '?format=csv').expect(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toBe(`attachment; filename="lumo-incident-${made.body.id}.csv"`);
    expect(r.headers['cache-control']).toBe('no-store');
    const lines = r.text.trim().split('\r\n');
    expect(lines[0]).toBe('incident,mode,at,kind,event,from,to,actor,reason,recipient,channel,purpose,simulated');
    expect(lines.length).toBe(1 + t.entries.length);
    for (const l of lines.slice(1)) expect(l.startsWith(`${made.body.id},real,`)).toBe(true);
  });

  it('JSON is a download too', async () => {
    const o = await owner('json');
    const made = await sos(o.token).expect(201);
    const r = await timeline(o.token, made.body.id, '?format=json').expect(200);
    expect(r.headers['content-disposition']).toContain('lumo-incident-');
    expect(r.body.entries.length).toBeGreaterThan(0);
  });

  it('a contact named like a spreadsheet formula is text in the CSV, not a formula', async () => {
    const o = await owner('inject', { contacts: ['=HYPERLINK("http://evil.example","x")'] });
    const made = await sos(o.token).expect(201);
    const csv = (await timeline(o.token, made.body.id, '?format=csv').expect(200)).text;
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")"`);
    expect(csv.split('\r\n').some(l => /,=HYPERLINK/.test(l))).toBe(false);
  });

  it('every export is recorded, and merely viewing is not', async () => {
    const o = await owner('audit');
    const made = await sos(o.token).expect(201);
    await timeline(o.token, made.body.id).expect(200);
    expect(await prisma.auditLog.count({ where: { actorId: o.userId, subjectId: made.body.id } })).toBe(0);
    await timeline(o.token, made.body.id, '?format=csv').expect(200);
    await timeline(o.token, made.body.id, '?format=json').expect(200);
    const rows = await prisma.auditLog.findMany({ where: { actorId: o.userId, subjectId: made.body.id }, orderBy: { at: 'asc' } });
    expect(rows.map(r => [r.action, (r.metadata as { format: string }).format])).toEqual([['incident.timeline_exported', 'csv'], ['incident.timeline_exported', 'json']]);
  });

  it('refuses a format it does not know', async () => {
    const o = await owner('fmt');
    const made = await sos(o.token).expect(201);
    await timeline(o.token, made.body.id, '?format=pdf').expect(400);
  });
});

describe('csv cells (unit)', () => {
  const t = (recipient: string) => ({
    incident: { id: 'i', mode: 'real' as const, state: 'CLOSED', outcome: 'CLOSED', triggerType: 'manual', triggeredAt: '', createdAt: '', lateBySeconds: 0, locationAvailable: false, contactsTried: 0, contactsReached: 0, contactsFailed: 0, resolvedAt: null, closedAt: null },
    entries: [{ at: 'a', kind: 'attempt' as const, event: 'e', from: null, to: 'X', actor: null, reason: null, recipient, channel: 'sms', purpose: 'ALERT', simulated: false }],
  });
  it.each([['=1+1'], ['+1'], ['-1'], ['@SUM(A1)'], ['\tx']])('neutralises %j', (name) => {
    const row = timelineToCsv(t(name)).split('\r\n')[1];
    expect(row).not.toMatch(/,[=+\-@\t]/);
  });
  it('quotes commas, quotes and newlines', () => {
    const row = timelineToCsv(t('a, "b"\nc')).split('\r\n').slice(1).join('\n');
    expect(row).toContain('"a, ""b""\nc"');
  });
  it('leaves an ordinary name alone', () => expect(timelineToCsv(t('Maya'))).toContain(',Maya,'));
});
