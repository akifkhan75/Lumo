import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createRegionRegistry, PK, US } from '@lumo/region-profiles';
import { LocationService, MAX_BATCH, MAX_CLOCK_SKEW_MS, MAX_SNAPSHOT_AGE_MS, validateSnapshots, type SnapshotInput } from './location.service';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const good = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
  latitude: 33.6844, longitude: 73.0479, accuracyM: 12, capturedAt: NOW - 1000, batteryPct: 80, source: 'gps', ...over,
});
const codes = (s: SnapshotInput[]) => validateSnapshots(s, NOW).map((r) => r.code);

describe('validateSnapshots', () => {
  it('accepts a sound snapshot', () => expect(validateSnapshots([good()], NOW)).toEqual([]));

  it.each([[91], [-91], [NaN], [Infinity]])('latitude %s', (latitude) => expect(codes([good({ latitude })])).toEqual(['LATITUDE_INVALID']));
  it.each([[181], [-181], [NaN]])('longitude %s', (longitude) => expect(codes([good({ longitude })])).toEqual(['LONGITUDE_INVALID']));
  it('accepts the extremes exactly', () => {
    expect(validateSnapshots([good({ latitude: 90, longitude: 180 }), good({ latitude: -90, longitude: -180, capturedAt: NOW - 2000 })], NOW)).toEqual([]);
  });

  describe('accuracy: unknown is not zero', () => {
    it.each([[null], [undefined]])('%s is refused, never coerced', (accuracyM) => expect(codes([good({ accuracyM })])).toEqual(['ACCURACY_UNKNOWN']));
    it('zero is a real claim and is allowed', () => expect(codes([good({ accuracyM: 0 })])).toEqual([]));
    it.each([[-1], [NaN], [Infinity]])('%s is invalid', (accuracyM) => expect(codes([good({ accuracyM })])).toEqual(['ACCURACY_INVALID']));
  });

  describe('capturedAt', () => {
    it('refuses a timestamp that is not a number', () => expect(codes([good({ capturedAt: NaN })])).toEqual(['CAPTURED_AT_INVALID']));
    it('allows a little clock skew, and no more', () => {
      expect(codes([good({ capturedAt: NOW + MAX_CLOCK_SKEW_MS })])).toEqual([]);
      expect(codes([good({ capturedAt: NOW + MAX_CLOCK_SKEW_MS + 1 })])).toEqual(['CAPTURED_AT_IN_FUTURE']);
    });
    it('refuses a snapshot older than a day', () => {
      expect(codes([good({ capturedAt: NOW - MAX_SNAPSHOT_AGE_MS })])).toEqual([]);
      expect(codes([good({ capturedAt: NOW - MAX_SNAPSHOT_AGE_MS - 1 })])).toEqual(['CAPTURED_AT_TOO_OLD']);
    });
  });

  describe('battery and source', () => {
    it.each([[101], [-1], [50.5], [NaN]])('battery %s', (batteryPct) => expect(codes([good({ batteryPct })])).toEqual(['BATTERY_INVALID']));
    it('battery is optional', () => expect(codes([good({ batteryPct: null }), good({ batteryPct: undefined, capturedAt: NOW - 5 })])).toEqual([]));
    it.each([[''], ['  '], ['x'.repeat(33)]])('source %j', (source) => expect(codes([good({ source })])).toEqual(['SOURCE_INVALID']));
  });

  it('reports every problem with the INDEX of the snapshot — and never the value', () => {
    const r = validateSnapshots([good(), good({ latitude: 999, accuracyM: null })], NOW);
    expect(r).toEqual([{ index: 1, code: 'LATITUDE_INVALID' }, { index: 1, code: 'ACCURACY_UNKNOWN' }]);
    expect(JSON.stringify(r)).not.toContain('999');
  });
});

describe('LocationService', () => {
  let prisma: any;
  let service: LocationService;
  const regions = createRegionRegistry({ enabled: [], environment: 'test' });

  beforeEach(() => {
    prisma = {
      safetySession: { findFirst: vi.fn().mockResolvedValue({ state: 'ACTIVE' }) },
      emergencyIncident: { findFirst: vi.fn().mockResolvedValue({ state: 'NOTIFYING', regionProfileId: 'PK' }) },
      user: { findUnique: vi.fn().mockResolvedValue({ regionProfileId: 'US' }) },
      locationSnapshot: { createMany: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ count: data.length })) },
    };
    service = new LocationService(prisma, regions);
  });

  it('stores a validated batch against the session, with the region’s retention', async () => {
    const r = await service.recordForSession('u1', 's1', [good()], NOW);
    expect(r).toEqual({ stored: 1, duplicates: 0 });
    const row = prisma.locationSnapshot.createMany.mock.calls[0][0].data[0];
    expect(row).toMatchObject({ sessionId: 's1', accuracyM: 12, batteryPct: 80, source: 'gps' });
    expect(row.incidentId).toBeUndefined();
    expect(row.expiresAt.getTime()).toBe(NOW - 1000 + 30 * DAY); // US locationDays
  });

  it('stores against an incident, using the INCIDENT’s region', async () => {
    await service.recordForIncident('u1', 'i1', [good()], NOW);
    const row = prisma.locationSnapshot.createMany.mock.calls[0][0].data[0];
    expect(row).toMatchObject({ incidentId: 'i1' });
    expect(row.sessionId).toBeUndefined();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('asks the database to skip duplicates, and reports a retry as duplicates', async () => {
    prisma.locationSnapshot.createMany.mockResolvedValue({ count: 1 });
    const r = await service.recordForSession('u1', 's1', [good(), good({ capturedAt: NOW - 2000 }), good({ capturedAt: NOW - 3000 })], NOW);
    expect(prisma.locationSnapshot.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
    expect(r).toEqual({ stored: 1, duplicates: 2 });
  });

  describe('ownership is the access control', () => {
    it("someone else's (or a missing) session is 'not found', never 'forbidden'", async () => {
      prisma.safetySession.findFirst.mockResolvedValue(null);
      await expect(service.recordForSession('u1', 'theirs', [good()], NOW)).rejects.toThrow(NotFoundException);
      // The lookup itself is scoped to the caller.
      expect(prisma.safetySession.findFirst.mock.calls[0][0].where).toEqual({ id: 'theirs', userId: 'u1' });
      expect(prisma.locationSnapshot.createMany).not.toHaveBeenCalled();
    });
    it("someone else's incident is 'not found'", async () => {
      prisma.emergencyIncident.findFirst.mockResolvedValue(null);
      await expect(service.recordForIncident('u1', 'theirs', [good()], NOW)).rejects.toThrow(NotFoundException);
      expect(prisma.emergencyIncident.findFirst.mock.calls[0][0].where).toEqual({ id: 'theirs', userId: 'u1' });
    });
    it.each(['CLOSED', 'CANCELLED', 'EXPIRED'])('a %s session no longer accepts location', async (state) => {
      prisma.safetySession.findFirst.mockResolvedValue({ state });
      await expect(service.recordForSession('u1', 's1', [good()], NOW)).rejects.toThrow(ConflictException);
    });
    it.each(['CLOSED', 'CANCELLED'])('a %s incident no longer accepts location', async (state) => {
      prisma.emergencyIncident.findFirst.mockResolvedValue({ state, regionProfileId: 'PK' });
      await expect(service.recordForIncident('u1', 'i1', [good()], NOW)).rejects.toThrow(ConflictException);
    });
    it.each(['ACTIVE', 'GRACE', 'SUSPENDED', 'ESCALATING', 'ALERTED'])('a %s session does', async (state) => {
      prisma.safetySession.findFirst.mockResolvedValue({ state });
      await expect(service.recordForSession('u1', 's1', [good()], NOW)).resolves.toBeTruthy();
    });
  });

  describe('validation happens before the database, and errors carry no values', () => {
    it('an invalid batch is refused whole, with indices and codes only', async () => {
      const err = await service.recordForSession('u1', 's1', [good(), good({ latitude: 123.456789, longitude: 98.7654321, accuracyM: null })], NOW).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = JSON.stringify(err.getResponse());
      expect(body).toContain('LATITUDE_INVALID');
      expect(body).not.toContain('123.456');
      expect(body).not.toContain('98.765');
      expect(prisma.locationSnapshot.createMany).not.toHaveBeenCalled();
      // It did not even look up the owner: nothing about the caller was touched.
      expect(prisma.safetySession.findFirst).not.toHaveBeenCalled();
    });
    it('an empty batch and an oversized one are refused', async () => {
      await expect(service.recordForSession('u1', 's1', [], NOW)).rejects.toThrow(BadRequestException);
      const many = Array.from({ length: MAX_BATCH + 1 }, (_, i) => good({ capturedAt: NOW - i }));
      await expect(service.recordForSession('u1', 's1', many, NOW)).rejects.toThrow(BadRequestException);
      await expect(service.recordForSession('u1', 's1', many.slice(0, MAX_BATCH), NOW)).resolves.toBeTruthy();
    });
  });

  describe('retention follows the owner’s region', () => {
    const expiry = async (regionProfileId: string | null) => {
      prisma.user.findUnique.mockResolvedValue(regionProfileId === null ? null : { regionProfileId });
      await service.recordForSession('u1', 's1', [good({ capturedAt: NOW })], NOW);
      const calls = prisma.locationSnapshot.createMany.mock.calls;
      return (calls[calls.length - 1][0].data[0].expiresAt.getTime() - NOW) / DAY;
    };
    it("uses the region's locationDays", async () => {
      expect(await expiry('PK')).toBe(30);
      expect(await expiry('US')).toBe(30);
    });
    it('with no region set, uses the SHORTEST known retention, and says so without any data', async () => {
      const warn = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
      expect(await expiry(null)).toBe(30);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toMatch(/shortest known retention \(30 days\)/);
      expect(String(warn.mock.calls[0][0])).not.toMatch(/u1|33\.68|73\.04/);
    });
    it('a region id that no profile knows is treated as no region', async () => {
      expect(await expiry('ZZ')).toBe(30);
    });

    describe('with markets whose retention actually differs (the shipped ones are both 30 days)', () => {
      const withDays = (id: string, locationDays: number) => ({ ...PK, id, privacy: { ...PK.privacy, retention: { ...PK.privacy.retention, locationDays } } });
      const mixed = createRegionRegistry({ profiles: [withDays('AA', 7), withDays('BB', 90), US], enabled: [], environment: 'test' });
      const expiryWith = async (regionProfileId: string | null) => {
        const svc = new LocationService(prisma, mixed);
        vi.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
        prisma.user.findUnique.mockResolvedValue(regionProfileId === null ? null : { regionProfileId });
        await svc.recordForSession('u1', 's1', [good({ capturedAt: NOW })], NOW);
        const calls = prisma.locationSnapshot.createMany.mock.calls;
        return (calls[calls.length - 1][0].data[0].expiresAt.getTime() - NOW) / DAY;
      };
      it("each user gets THEIR market's window", async () => {
        expect(await expiryWith('AA')).toBe(7);
        expect(await expiryWith('BB')).toBe(90);
      });
      it('a user with no market gets the SHORTEST of them, never the longest', async () => {
        expect(await expiryWith(null)).toBe(7);
        expect(await expiryWith('ZZ')).toBe(7);
      });
    });
  });
});
