/**
 * Location snapshot integrity, proven against real Postgres (docs/specs/LOCATION.md).
 *
 * The unique indexes and the owner CHECK are hand-written in the migration, so the
 * drift gate cannot see them. CI runs this suite.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { getOptionsToken } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { LocationService, type SnapshotInput } from '../src/location/location.service';

const RUN = `loc_${Date.now()}_${randomUUID().slice(0, 6)}`;
const DAY = 24 * 60 * 60 * 1000;

let app: INestApplication;
let prisma: PrismaClient;
let service: LocationService;

const snap = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
  latitude: 33.6844, longitude: 73.0479, accuracyM: 15, capturedAt: Date.now() - 2000, batteryPct: 70, source: 'gps', ...over,
});

async function owner(label: string, regionProfileId?: string) {
  const user = await prisma.user.create({ data: { email: `${RUN}_${label}@example.com`, passwordHash: 'x', fullName: label, regionProfileId } });
  const policy = await prisma.escalationPolicy.create({ data: { userId: user.id, name: 'p', steps: [] } });
  const session = await prisma.safetySession.create({ data: { userId: user.id, kind: 'walk_home', state: 'ACTIVE', escalationPolicyId: policy.id } });
  const incident = await prisma.emergencyIncident.create({
    data: { userId: user.id, idempotencyKey: randomUUID(), triggerType: 'manual', triggeredAt: new Date(), regionProfileId: 'PK', state: 'NOTIFYING' },
  });
  return { user, session, incident };
}
const count = (where: object) => prisma.locationSnapshot.count({ where });

beforeAll(async () => {
  prisma = new PrismaClient();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getOptionsToken()).useValue([{ name: 'short', ttl: 1000, limit: 1_000_000 }])
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  service = app.get(LocationService);
});

afterAll(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lumo.erasure = 'on'`;
    await tx.user.deleteMany({ where: { email: { startsWith: RUN } } });
  });
  await prisma.$disconnect();
  await app.close();
});

describe('storing snapshots', () => {
  it('stores a session’s batch with the region retention counted from the capture time', async () => {
    const o = await owner('store', 'PK');
    const at = Date.now() - 5000;
    expect(await service.recordForSession(o.user.id, o.session.id, [snap({ capturedAt: at }), snap({ capturedAt: at - 1000 })], Date.now())).toEqual({ stored: 2, duplicates: 0 });
    const rows = await prisma.locationSnapshot.findMany({ where: { sessionId: o.session.id }, orderBy: { capturedAt: 'desc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ accuracyM: 15, source: 'gps', incidentId: null });
    expect(rows[0].expiresAt.getTime() - rows[0].capturedAt.getTime()).toBe(30 * DAY); // PK locationDays
  });

  it('stores an incident’s batch against the incident', async () => {
    const o = await owner('inc');
    await service.recordForIncident(o.user.id, o.incident.id, [snap()], Date.now());
    expect(await count({ incidentId: o.incident.id, sessionId: null })).toBe(1);
  });
});

describe('a resent batch does not duplicate — enforced by the database', () => {
  it('a sequential retry stores nothing new and says so', async () => {
    const o = await owner('retry');
    const batch = [snap({ capturedAt: Date.now() - 9000 }), snap({ capturedAt: Date.now() - 8000 })];
    await service.recordForSession(o.user.id, o.session.id, batch, Date.now());
    expect(await service.recordForSession(o.user.id, o.session.id, batch, Date.now())).toEqual({ stored: 0, duplicates: 2 });
    expect(await count({ sessionId: o.session.id })).toBe(2);
  });

  it('two retries IN FLIGHT AT ONCE still leave one copy — a check-then-insert would race', async () => {
    const o = await owner('race');
    const batch = Array.from({ length: 20 }, (_, i) => snap({ capturedAt: Date.now() - 20_000 + i * 100 }));
    const results = await Promise.all(Array.from({ length: 4 }, () => service.recordForSession(o.user.id, o.session.id, batch, Date.now())));
    expect(await count({ sessionId: o.session.id })).toBe(20);
    expect(results.reduce((n, r) => n + r.stored, 0)).toBe(20);
  });

  it('a partly-arrived batch stores only the missing part', async () => {
    const o = await owner('partial');
    const t = Date.now() - 30_000;
    await service.recordForSession(o.user.id, o.session.id, [snap({ capturedAt: t })], Date.now());
    expect(await service.recordForSession(o.user.id, o.session.id, [snap({ capturedAt: t }), snap({ capturedAt: t + 500 })], Date.now())).toEqual({ stored: 1, duplicates: 1 });
  });

  it('the same instant in TWO DIFFERENT sessions is not a duplicate (NULLs must not make owners collide)', async () => {
    const a = await owner('twoA');
    const b = await owner('twoB');
    const t = Date.now() - 4000;
    await service.recordForSession(a.user.id, a.session.id, [snap({ capturedAt: t })], Date.now());
    await service.recordForSession(b.user.id, b.session.id, [snap({ capturedAt: t })], Date.now());
    expect(await count({ sessionId: { in: [a.session.id, b.session.id] } })).toBe(2);
  });

  it('the unique indexes are really there', async () => {
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename = 'LocationSnapshot' AND indexname LIKE '%capturedAt_key'`;
    expect(idx.map((i) => i.indexname).sort()).toEqual(['LocationSnapshot_incident_capturedAt_key', 'LocationSnapshot_session_capturedAt_key']);
  });
});

describe('ownership', () => {
  it("another user's session is not found, and nothing is written", async () => {
    const a = await owner('ownA');
    const b = await owner('ownB');
    await expect(service.recordForSession(b.user.id, a.session.id, [snap()], Date.now())).rejects.toThrow(NotFoundException);
    expect(await count({ sessionId: a.session.id })).toBe(0);
  });
  it("another user's incident is not found", async () => {
    const a = await owner('ownIncA');
    const b = await owner('ownIncB');
    await expect(service.recordForIncident(b.user.id, a.incident.id, [snap()], Date.now())).rejects.toThrow(NotFoundException);
  });
  it('an ended session accepts nothing', async () => {
    const o = await owner('ended');
    await prisma.safetySession.update({ where: { id: o.session.id }, data: { state: 'CLOSED' } });
    await expect(service.recordForSession(o.user.id, o.session.id, [snap()], Date.now())).rejects.toThrow(ConflictException);
    expect(await count({ sessionId: o.session.id })).toBe(0);
  });
});

describe('a snapshot must have an owner', () => {
  it('the database refuses one with neither a session nor an incident', async () => {
    await expect(
      prisma.locationSnapshot.create({ data: { latitude: 1, longitude: 1, accuracyM: 5, capturedAt: new Date(), source: 'gps', expiresAt: new Date(Date.now() + DAY) } }),
    ).rejects.toThrow();
  });
});

describe('coordinates stay out of errors and logs', () => {
  const SECRET_LAT = 91.123456; // out of range, and recognisable if it leaks

  it('THE TRAP: a database CHECK violation DOES put the coordinates in its error — which is why validation must come first', async () => {
    const o = await owner('trap');
    const err = await prisma.locationSnapshot
      .create({ data: { sessionId: o.session.id, latitude: SECRET_LAT, longitude: 73.5, accuracyM: 5, capturedAt: new Date(), source: 'gps', expiresAt: new Date(Date.now() + DAY) } })
      .catch((e) => e);
    expect(String(err.message)).toMatch(/91\.123456/); // the raw database error leaks the value
  });

  it('…and the service never lets it get that far: it refuses with codes only, and reaches the database not at all', async () => {
    const o = await owner('guard');
    const err = await service.recordForSession(o.user.id, o.session.id, [snap({ latitude: SECRET_LAT, longitude: 73.123456 })], Date.now()).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    const text = JSON.stringify(err.getResponse());
    expect(text).toContain('LATITUDE_INVALID');
    expect(text).not.toContain('91.123456');
    expect(text).not.toContain('73.123456');
    expect(await count({ sessionId: o.session.id })).toBe(0);
  });

  it('a successful write, and a refused one, log no coordinate at all', async () => {
    const o = await owner('logs');
    const lines: string[] = [];
    const capture = (...args: unknown[]) => lines.push(args.map(String).join(' '));
    const spies = ['log', 'warn', 'error', 'debug', 'verbose'].map((m) => vi.spyOn((service as any).logger, m).mockImplementation(capture));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => { lines.push(String(chunk)); return true; });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => { lines.push(String(chunk)); return true; });
    try {
      await service.recordForSession(o.user.id, o.session.id, [snap({ latitude: 12.345678, longitude: 56.789012 })], Date.now());
      await service.recordForSession(o.user.id, o.session.id, [snap({ latitude: 95.111111 })], Date.now()).catch(() => undefined);
    } finally {
      spies.forEach((s) => s.mockRestore());
      stdout.mockRestore();
      stderr.mockRestore();
    }
    const all = lines.join('\n');
    for (const leaked of ['12.345678', '56.789012', '95.111111']) expect(all).not.toContain(leaked);
  });
});
