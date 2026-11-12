/**
 * Database-level guarantees of the Phase 1 schema, proven against real Postgres.
 *
 * The CI drift gate compares the schema to the migrations, but it IGNORES triggers
 * and CHECK constraints, and unit tests with a mocked Prisma cannot see either. The
 * append-only history, the erasure carve-out, the grace minimum and the stable
 * contact ids are exactly the things that would break silently, so each is
 * exercised here, against a database the migrations built. CI runs this suite.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { getOptionsToken } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import {
  ACTORS, ATTEMPT_STATES, CHANNELS, CONSENT_KINDS, INCIDENT_MODES, INCIDENT_STATES,
  MIN_GRACE_SECONDS, SESSION_KINDS, SESSION_STATES, TRIGGER_TYPES,
} from '@lumo/safety-domain';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const RUN = `schema_${Date.now()}_${randomUUID().slice(0, 6)}`;
const AUDIT_ACTION = `schema-test-${RUN}`;

let app: INestApplication;
let prisma: PrismaClient;

/** Delete inside the erasure transaction — the one sanctioned way to remove history. */
const erase = <T>(fn: (tx: PrismaClient) => Promise<T>) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lumo.erasure = 'on'`;
    return fn(tx as unknown as PrismaClient);
  });

async function signup(label: string) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/signup')
    .send({ name: label, email: `${RUN}_${label}@example.com`, password: 'password123' })
    .expect(201);
  return { token: res.body.token as string, id: res.body.user.id as string };
}

const putSettings = (token: string, body: object) =>
  request(app.getHttpServer()).put('/api/v1/settings').set('Authorization', `Bearer ${token}`).send(body);
const getSettings = (token: string) =>
  request(app.getHttpServer()).get('/api/v1/settings').set('Authorization', `Bearer ${token}`);

/** A user with a policy, session, incident, one attempt, and one row in every history table. */
async function history(userId: string, recipientId: string = randomUUID()) {
  const policy = await prisma.escalationPolicy.create({ data: { userId, name: 'p', steps: [] } });
  const session = await prisma.safetySession.create({ data: { userId, kind: 'walk_home', escalationPolicyId: policy.id } });
  const incident = await prisma.emergencyIncident.create({
    data: { userId, sessionId: session.id, idempotencyKey: randomUUID(), triggerType: 'manual', triggeredAt: new Date(), regionProfileId: 'PK' },
  });
  const attempt = await prisma.notificationAttempt.create({ data: { incidentId: incident.id, recipientId, channel: 'push', escalationStep: 1 } });
  return {
    policy, session, incident, attempt,
    sessionEvent: await prisma.sessionEvent.create({ data: { sessionId: session.id, toState: 'ACTIVE', event: 'START', actor: 'user', occurredAt: new Date() } }),
    incidentEvent: await prisma.incidentEvent.create({ data: { incidentId: incident.id, toState: 'LOCATING', event: 'COUNTDOWN_ELAPSED', actor: 'system', occurredAt: new Date() } }),
    notificationEvent: await prisma.notificationEvent.create({ data: { attemptId: attempt.id, toState: 'QUEUED' } }),
    audit: await prisma.auditLog.create({ data: { action: AUDIT_ACTION, subjectType: 'test', subjectId: 'x' } }),
  };
}

beforeAll(async () => {
  prisma = new PrismaClient();
  // The global throttler allows 10 requests a second, which this suite exceeds by
  // design: it is exercising the database, not rate limiting.
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getOptionsToken())
    .useValue([
      { name: 'short', ttl: 1000, limit: 1_000_000 },
      { name: 'long', ttl: 60_000, limit: 1_000_000 },
    ])
    .compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
});

afterAll(async () => {
  // Leaves no rows behind, and exercises the erasure path doing it.
  await erase((tx) => tx.auditLog.deleteMany({ where: { action: AUDIT_ACTION } }));
  await erase((tx) => tx.user.deleteMany({ where: { email: { startsWith: RUN } } }));
  await prisma.$disconnect();
  await app.close();
});

describe('trusted contacts keep their identity', () => {
  it('EXIT: an attempt references a contact, the contact is edited twice, and the attempt still resolves to the same contact', async () => {
    const { token, id: userId } = await signup('exit');

    await putSettings(token, { trustedContacts: [{ name: 'Mum', phone: '+15550100100' }] }).expect(200);
    const [original] = (await getSettings(token).expect(200)).body.trustedContacts;
    expect(original.id).toBeTruthy();

    const { attempt } = await history(userId, original.id); // the attempt points at the contact

    // Edit 1: the name. Edit 2: the number. Each sends the id back, as the app does.
    await putSettings(token, { trustedContacts: [{ id: original.id, name: 'Mother', phone: '+15550100100' }] }).expect(200);
    await putSettings(token, { trustedContacts: [{ id: original.id, name: 'Mother', phone: '+15550100200' }] }).expect(200);

    const [after] = (await getSettings(token).expect(200)).body.trustedContacts;
    expect(after.id).toBe(original.id);
    expect(after).toMatchObject({ name: 'Mother', phone: '+15550100200' });

    const reread = await prisma.notificationAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(reread.recipientId).toBe(original.id);
    const resolved = await prisma.trustedContact.findUnique({ where: { id: reread.recipientId } });
    expect(resolved).not.toBeNull();
    expect(resolved!.name).toBe('Mother');
  });

  it('orders contacts by their position in the list', async () => {
    const { token } = await signup('order');
    await putSettings(token, { trustedContacts: [
      { name: 'First', phone: '+15550101001' }, { name: 'Second', phone: '+15550101002' }, { name: 'Third', phone: '+15550101003' },
    ] }).expect(200);
    const names = (await getSettings(token)).body.trustedContacts.map((c: any) => c.name);
    expect(names).toEqual(['First', 'Second', 'Third']);
  });

  it('a duplicated id in one request creates a new contact for the second, not two edits of one', async () => {
    const { token } = await signup('dupid');
    await putSettings(token, { trustedContacts: [{ name: 'A', phone: '+15550102001' }] }).expect(200);
    const [a] = (await getSettings(token)).body.trustedContacts;
    await putSettings(token, { trustedContacts: [
      { id: a.id, name: 'A', phone: '+15550102001' }, { id: a.id, name: 'Clone', phone: '+15550102002' },
    ] }).expect(200);
    const contacts = (await getSettings(token)).body.trustedContacts;
    expect(contacts).toHaveLength(2);
    expect(new Set(contacts.map((c: any) => c.id)).size).toBe(2);
  });
});

describe('personal data is encrypted at rest (KI-26)', () => {
  it('the raw columns hold ciphertext, never the plaintext', async () => {
    const { token, id: userId } = await signup('enc');
    await putSettings(token, {
      personalInfo: { fullName: 'Enc', bloodType: 'AB-', allergies: 'penicillin' },
      trustedContacts: [{ name: 'Dad', phone: '+15550103999' }],
    }).expect(200);

    const [user] = await prisma.$queryRaw<{ bloodType: string; allergies: string }[]>`SELECT "bloodType", "allergies" FROM "User" WHERE id = ${userId}`;
    const [contact] = await prisma.$queryRaw<{ phone: string }[]>`SELECT "phone" FROM "TrustedContact" WHERE "userId" = ${userId}`;

    for (const stored of [user.bloodType, user.allergies, contact.phone]) expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(user.allergies).not.toContain('penicillin');
    expect(contact.phone).not.toContain('5550103999');

    // …and the API still returns the plaintext to the owner.
    const body = (await getSettings(token)).body;
    expect(body.personalInfo).toMatchObject({ bloodType: 'AB-', allergies: 'penicillin' });
    expect(body.trustedContacts[0].phone).toBe('+15550103999');
  });

  it('a ciphertext moved into another row is refused, and the response leaks nothing', async () => {
    const a = await signup('moveA');
    const b = await signup('moveB');
    await putSettings(a.token, { trustedContacts: [{ name: 'A-contact', phone: '+15550104111' }] }).expect(200);
    await putSettings(b.token, { trustedContacts: [{ name: 'B-contact', phone: '+15550104222' }] }).expect(200);

    // Copy A's encrypted phone number into B's contact row.
    await prisma.$executeRaw`UPDATE "TrustedContact" SET "phone" = (SELECT "phone" FROM "TrustedContact" WHERE "userId" = ${a.id}) WHERE "userId" = ${b.id}`;

    const res = await getSettings(b.token);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('5550104111');
  });

  it('plaintext written before encryption existed is still readable, until db:encrypt-pii converts it', async () => {
    const { token, id: userId } = await signup('legacy');
    await putSettings(token, { trustedContacts: [{ name: 'Old', phone: '+15550105000' }] }).expect(200);
    await prisma.$executeRaw`UPDATE "TrustedContact" SET "phone" = '+15550105000' WHERE "userId" = ${userId}`;
    expect((await getSettings(token).expect(200)).body.trustedContacts[0].phone).toBe('+15550105000');
  });
});

describe('consent follows the person, not the id (RES-7)', () => {
  async function contactWithConsent(label: string) {
    const { token, id: userId } = await signup(label);
    await putSettings(token, { trustedContacts: [{ name: 'Sam', phone: '+1 (555) 010-6000' }] }).expect(200);
    const contact = await prisma.trustedContact.findFirstOrThrow({ where: { userId } });
    const consent = await prisma.consentRecord.create({
      data: { grantedById: contact.id, kind: 'contact_role', scope: `contact:${contact.id}`, regionProfileId: 'PK', version: '1' },
    });
    await prisma.trustedContact.update({ where: { id: contact.id }, data: { consentId: consent.id } });
    return { token, contact, consent };
  }
  const state = async (contactId: string, consentId: string) => ({
    contact: await prisma.trustedContact.findUniqueOrThrow({ where: { id: contactId } }),
    consent: await prisma.consentRecord.findUniqueOrThrow({ where: { id: consentId } }),
  });

  it('keeps consent when only the name changes', async () => {
    const { token, contact, consent } = await contactWithConsent('cn');
    await putSettings(token, { trustedContacts: [{ id: contact.id, name: 'Samuel', phone: '+1 (555) 010-6000' }] }).expect(200);
    const s = await state(contact.id, consent.id);
    expect(s.contact.consentId).toBe(consent.id);
    expect(s.consent.revokedAt).toBeNull();
  });

  it('keeps consent when the number is only reformatted', async () => {
    const { token, contact, consent } = await contactWithConsent('cf');
    await putSettings(token, { trustedContacts: [{ id: contact.id, name: 'Sam', phone: '+15550106000' }] }).expect(200);
    const s = await state(contact.id, consent.id);
    expect(s.contact.consentId).toBe(consent.id);
    expect(s.consent.revokedAt).toBeNull();
  });

  it('REVOKES consent when the number is a different number — never deleting the record', async () => {
    const { token, contact, consent } = await contactWithConsent('cp');
    await putSettings(token, { trustedContacts: [{ id: contact.id, name: 'Sam', phone: '+15550107777' }] }).expect(200);
    const s = await state(contact.id, consent.id);
    expect(s.contact.id).toBe(contact.id); // same contact…
    expect(s.contact.consentId).toBeNull(); // …no longer consented
    expect(s.consent.revokedAt).not.toBeNull(); // the record survives, as evidence
    expect(s.consent.revokedReason).toBe('CONTACT_DETAILS_CHANGED');
  });
});

describe('contacts are scoped to their owner', () => {
  it("another user's contact id cannot be used to read or change their contact", async () => {
    const a = await signup('scopeA');
    const b = await signup('scopeB');
    await putSettings(a.token, { trustedContacts: [{ name: 'A-only', phone: '+15550108111' }] }).expect(200);
    const [aContact] = (await getSettings(a.token)).body.trustedContacts;

    // B sends A's contact id with new details.
    await putSettings(b.token, { trustedContacts: [{ id: aContact.id, name: 'Hijack', phone: '+15550108999' }] }).expect(200);

    const aAfter = (await getSettings(a.token)).body.trustedContacts;
    expect(aAfter).toEqual([{ id: aContact.id, name: 'A-only', phone: '+15550108111' }]); // untouched
    const bAfter = (await getSettings(b.token)).body.trustedContacts;
    expect(bAfter).toHaveLength(1);
    expect(bAfter[0].id).not.toBe(aContact.id); // B got a NEW contact of their own
  });
});

describe('removing a contact is a soft delete', () => {
  it('drops the contact from every read, keeps the row so the ledger resolves, and withdraws consent', async () => {
    const { token, id: userId } = await signup('rm');
    await putSettings(token, { trustedContacts: [{ name: 'Gone', phone: '+15550109000' }] }).expect(200);
    const contact = await prisma.trustedContact.findFirstOrThrow({ where: { userId } });
    const consent = await prisma.consentRecord.create({
      data: { grantedById: contact.id, kind: 'contact_role', scope: `contact:${contact.id}`, regionProfileId: 'PK', version: '1' },
    });
    await prisma.trustedContact.update({ where: { id: contact.id }, data: { consentId: consent.id } });
    const { attempt } = await history(userId, contact.id);

    await putSettings(token, { trustedContacts: [] }).expect(200);

    expect((await getSettings(token)).body.trustedContacts).toEqual([]);
    const row = await prisma.trustedContact.findUnique({ where: { id: attempt.recipientId } });
    expect(row).not.toBeNull(); // the attempt still resolves
    expect(row!.removedAt).not.toBeNull();
    expect(row!.consentId).toBeNull();
    const revoked = await prisma.consentRecord.findUniqueOrThrow({ where: { id: consent.id } });
    expect(revoked.revokedAt).not.toBeNull();
    expect(revoked.revokedReason).toBe('CONTACT_REMOVED');
  });

  it('omitting the key leaves contacts alone — which is not the same as sending an empty list', async () => {
    const { token } = await signup('omit');
    await putSettings(token, { trustedContacts: [{ name: 'Stay', phone: '+15550109500' }] }).expect(200);
    await putSettings(token, { personalInfo: { fullName: 'Omit' } }).expect(200);
    expect((await getSettings(token)).body.trustedContacts).toHaveLength(1);
  });
});

describe('append-only history', () => {
  const tables = [
    ['SessionEvent', (h: Awaited<ReturnType<typeof history>>) => h.sessionEvent.id],
    ['IncidentEvent', (h: Awaited<ReturnType<typeof history>>) => h.incidentEvent.id],
    ['NotificationEvent', (h: Awaited<ReturnType<typeof history>>) => h.notificationEvent.id],
    ['AuditLog', (h: Awaited<ReturnType<typeof history>>) => h.audit.id],
  ] as const;

  let h: Awaited<ReturnType<typeof history>>;
  beforeAll(async () => {
    h = await history((await signup('hist')).id);
  });

  it.each(tables)('%s: an UPDATE is refused', async (table, id) => {
    await expect(prisma.$executeRawUnsafe(`UPDATE "${table}" SET "id" = "id" WHERE "id" = $1`, id(h))).rejects.toThrow(/append-only/);
  });

  it.each(tables)('%s: a DELETE is refused outside the erasure procedure', async (table, id) => {
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "id" = $1`, id(h))).rejects.toThrow(/append-only/);
  });

  it.each(tables)('%s: TRUNCATE is refused', async (table) => {
    await expect(prisma.$executeRawUnsafe(`TRUNCATE "${table}"`)).rejects.toThrow(/append-only/);
  });

  it('a refused change left the row exactly as it was', async () => {
    const row = await prisma.incidentEvent.findUniqueOrThrow({ where: { id: h.incidentEvent.id } });
    expect(row.event).toBe('COUNTDOWN_ELAPSED');
  });

  it('a DELETE inside the erasure transaction succeeds', async () => {
    const throwaway = await prisma.auditLog.create({ data: { action: AUDIT_ACTION, subjectType: 'test', subjectId: 'erase-me' } });
    await erase((tx) => tx.auditLog.delete({ where: { id: throwaway.id } }));
    expect(await prisma.auditLog.findUnique({ where: { id: throwaway.id } })).toBeNull();
  });

  it('the flag is scoped to its transaction — it does not leak to the next statement', async () => {
    const throwaway = await prisma.auditLog.create({ data: { action: AUDIT_ACTION, subjectType: 'test', subjectId: 'scoped' } });
    await erase(async (tx) => { await tx.auditLog.count(); });
    await expect(prisma.auditLog.delete({ where: { id: throwaway.id } })).rejects.toThrow(/append-only/);
  });

  it('the mutable parents are NOT append-only: an attempt and an incident update their state', async () => {
    await expect(prisma.notificationAttempt.update({ where: { id: h.attempt.id }, data: { state: 'SENT' } })).resolves.toBeTruthy();
    await expect(prisma.emergencyIncident.update({ where: { id: h.incident.id }, data: { state: 'LOCATING' } })).resolves.toBeTruthy();
    await expect(prisma.safetySession.update({ where: { id: h.session.id }, data: { state: 'ACTIVE' } })).resolves.toBeTruthy();
  });
});

describe('deleting an account', () => {
  it('is refused while history exists, unless done through the erasure procedure', async () => {
    const { id: userId } = await signup('del');
    await history(userId);
    await expect(prisma.user.delete({ where: { id: userId } })).rejects.toThrow(/append-only/);
    expect(await prisma.user.findUnique({ where: { id: userId } })).not.toBeNull(); // nothing was half-deleted
  });

  it('erasure removes the account and everything under it — including sessions and policies in one statement', async () => {
    const { id: userId } = await signup('erase');
    const h = await history(userId);
    await erase((tx) => tx.user.delete({ where: { id: userId } }));

    expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();
    expect(await prisma.escalationPolicy.findUnique({ where: { id: h.policy.id } })).toBeNull();
    expect(await prisma.safetySession.findUnique({ where: { id: h.session.id } })).toBeNull();
    expect(await prisma.emergencyIncident.findUnique({ where: { id: h.incident.id } })).toBeNull();
    expect(await prisma.notificationAttempt.findUnique({ where: { id: h.attempt.id } })).toBeNull();
    expect(await prisma.incidentEvent.findUnique({ where: { id: h.incidentEvent.id } })).toBeNull();
    expect(await prisma.notificationEvent.findUnique({ where: { id: h.notificationEvent.id } })).toBeNull();
  });
});

describe('CHECK constraints and uniqueness', () => {
  let userId: string;
  beforeAll(async () => { userId = (await signup('chk')).id; });

  const policy = (data: object) => prisma.escalationPolicy.create({ data: { userId, name: 'c', steps: [], ...data } as any });

  it(`refuses a grace under ${MIN_GRACE_SECONDS} seconds, and accepts exactly ${MIN_GRACE_SECONDS}`, async () => {
    await expect(policy({ graceSeconds: MIN_GRACE_SECONDS - 1 })).rejects.toThrow();
    await expect(policy({ graceSeconds: 0 })).rejects.toThrow();
    await expect(policy({ graceSeconds: MIN_GRACE_SECONDS })).resolves.toBeTruthy();
  });

  it('the SQL minimum is the same number as the domain’s MIN_GRACE_SECONDS', () => {
    const dir = join(__dirname, '..', 'prisma', 'migrations');
    const sql = readdirSync(dir).filter((d) => d !== 'migration_lock.toml')
      .map((d) => readFileSync(join(dir, d, 'migration.sql'), 'utf8')).join('\n');
    const m = sql.match(/"graceSeconds" >= (\d+)/);
    expect(m, 'no graceSeconds CHECK found in the migrations').not.toBeNull();
    expect(Number(m![1])).toBe(MIN_GRACE_SECONDS);
  });

  it('refuses a policy that allows no recipients, or a zero deviation grace', async () => {
    await expect(policy({ maxRecipientsPerIncident: 0 })).rejects.toThrow();
    await expect(policy({ deviationGraceSeconds: 0 })).rejects.toThrow();
  });

  it('allows one default policy per user, not two', async () => {
    const { id: other } = await signup('chkdef');
    const make = () => prisma.escalationPolicy.create({ data: { userId: other, name: 'd', steps: [], isDefault: true } });
    await expect(make()).resolves.toBeTruthy();
    await expect(make()).rejects.toThrow();
  });

  describe('location', () => {
    // A snapshot must have an owner (a session or an incident), so every case here has a
    // valid one. Without it the owner CHECK would reject first and each assertion below
    // would pass for the wrong reason. Each test also names the constraint it expects.
    let sessionId: string;
    let tick = 0;
    beforeAll(async () => { sessionId = (await history(userId)).session.id; });
    const snap = (data: object) =>
      prisma.locationSnapshot.create({
        data: { sessionId, latitude: 1, longitude: 1, accuracyM: 5, capturedAt: new Date(Date.now() - 100_000 + tick++), source: 'gps', expiresAt: new Date(Date.now() + 1e6), ...data } as any,
      });
    const violates = (p: Promise<unknown>, constraint: string) => expect(p).rejects.toThrow(new RegExp(constraint));

    it('refuses coordinates that are not on Earth', async () => {
      await violates(snap({ latitude: 91 }), 'LocationSnapshot_latitude_range');
      await violates(snap({ latitude: -91 }), 'LocationSnapshot_latitude_range');
      await violates(snap({ longitude: 181 }), 'LocationSnapshot_longitude_range');
    });
    it('refuses a negative accuracy and an impossible battery level', async () => {
      await violates(snap({ accuracyM: -1 }), 'LocationSnapshot_accuracy_nonnegative');
      await violates(snap({ batteryPct: 101 }), 'LocationSnapshot_battery_range');
    });
    it('accepts a valid fix', async () => {
      await expect(snap({ latitude: 33.68, longitude: 73.04, batteryPct: 80 })).resolves.toBeTruthy();
    });
    it('cannot be stored without an expiry — decay is mandatory', async () => {
      await expect(
        prisma.$executeRaw`INSERT INTO "LocationSnapshot"(id,"sessionId",latitude,longitude,"accuracyM","capturedAt",source) VALUES (${randomUUID()},${sessionId},1,1,5,now(),'gps')`,
      // 23502 = not_null_violation. (Prisma's raw error carries the SQLSTATE and the failing row —
      // coordinates included — but not the column name; see location.e2e-spec.ts.)
      ).rejects.toThrow(/23502/);
    });
  });

  describe('the ledger', () => {
    it('refuses an attempt number below 1, and a negative cost', async () => {
      const h = await history(userId);
      const row = (data: object) => prisma.notificationAttempt.create({ data: { incidentId: h.incident.id, recipientId: randomUUID(), channel: 'sms', escalationStep: 1, ...data } as any });
      await expect(row({ attemptNumber: 0 })).rejects.toThrow();
      await expect(row({ costMinorUnits: -1 })).rejects.toThrow();
    });
    it('a retry is a new row; the same (incident, recipient, channel, attemptNumber) is refused', async () => {
      const h = await history(userId);
      const base = { incidentId: h.incident.id, recipientId: 'r1', channel: 'sms' as const, escalationStep: 1 };
      await prisma.notificationAttempt.create({ data: { ...base, attemptNumber: 1 } });
      await prisma.notificationAttempt.create({ data: { ...base, attemptNumber: 2 } });
      await expect(prisma.notificationAttempt.create({ data: { ...base, attemptNumber: 1 } })).rejects.toThrow();
    });
    it('an incident idempotency key can be used once', async () => {
      const key = randomUUID();
      const make = () => prisma.emergencyIncident.create({ data: { userId, idempotencyKey: key, triggerType: 'shake', triggeredAt: new Date(), regionProfileId: 'PK' } });
      await expect(make()).resolves.toBeTruthy();
      await expect(make()).rejects.toThrow();
    });
  });
});

describe('the database enums are exactly the domain’s vocabularies', () => {
  const labels = async (type: string) =>
    (await prisma.$queryRaw<{ l: string }[]>`SELECT e.enumlabel AS l FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname = ${type} ORDER BY e.enumsortorder`).map((r) => r.l);

  it.each([
    ['Actor', ACTORS], ['Channel', CHANNELS], ['TriggerType', TRIGGER_TYPES], ['SessionKind', SESSION_KINDS],
    ['SessionState', SESSION_STATES], ['IncidentState', INCIDENT_STATES], ['IncidentMode', INCIDENT_MODES],
    ['AttemptState', ATTEMPT_STATES], ['ConsentKind', CONSENT_KINDS],
  ] as const)('%s', async (type, domain) => {
    expect([...(await labels(type))].sort()).toEqual([...domain].sort());
  });
});
