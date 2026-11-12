import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { RegionRegistry } from '@lumo/region-profiles';
import { INCIDENT_TERMINAL, SESSION_TERMINAL } from '@lumo/safety-domain';
import { PrismaService } from '../prisma/prisma.service';
import { REGION_REGISTRY } from '../regions/regions.module';

/**
 * The single write path for location snapshots (docs/specs/LOCATION.md).
 *
 * It is called by the incident flow (1.8) and the session flow (1.10) and has NO HTTP
 * route of its own yet: a snapshot belongs to a session or an incident, and neither can
 * be created over HTTP until then. A route that could only ever 404 would be noise.
 *
 * Three things here exist because the obvious version gets them wrong:
 *
 * - A SNAPSHOT HAS NO userId. It belongs to someone only through its session or
 *   incident, so the ownership check IS the access control. An id that is not the
 *   caller's is "not found", never "forbidden": the difference would confirm that
 *   someone else's session exists.
 *
 * - VALIDATION COMES BEFORE THE DATABASE, and its errors never contain a value. A
 *   Postgres CHECK violation carries `DETAIL: Failing row contains (…)` — the
 *   coordinates — and a 5xx's stack is logged. The CHECK constraints are a backstop; if
 *   one is ever the FIRST line of defence, a position ends up in a log.
 *
 * - UNKNOWN ACCURACY IS NOT ZERO. An accuracy of `null` is refused, never coerced to
 *   `0`, which would claim a perfect fix.
 */

export const MAX_BATCH = 100;
/** A device clock is allowed to run this far ahead before a timestamp is called invalid. */
export const MAX_CLOCK_SKEW_MS = 60_000;
/** Snapshots older than this are not worth storing; an offline queue should have been flushed. */
export const MAX_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SnapshotInput {
  readonly latitude: number;
  readonly longitude: number;
  /** Required. `null` or absent is refused, not treated as 0. */
  readonly accuracyM: number | null | undefined;
  /** Epoch milliseconds, by the device clock. */
  readonly capturedAt: number;
  readonly batteryPct?: number | null;
  readonly source: string;
}

export type RejectionCode =
  | 'LATITUDE_INVALID'
  | 'LONGITUDE_INVALID'
  | 'ACCURACY_UNKNOWN'
  | 'ACCURACY_INVALID'
  | 'CAPTURED_AT_INVALID'
  | 'CAPTURED_AT_IN_FUTURE'
  | 'CAPTURED_AT_TOO_OLD'
  | 'BATTERY_INVALID'
  | 'SOURCE_INVALID';

/** Where and why — and deliberately nothing about the value that failed. */
export interface Rejection {
  readonly index: number;
  readonly code: RejectionCode;
}

export function validateSnapshots(snapshots: readonly SnapshotInput[], now: number): Rejection[] {
  const rejections: Rejection[] = [];
  snapshots.forEach((s, index) => {
    const reject = (code: RejectionCode) => rejections.push({ index, code });
    if (!Number.isFinite(s.latitude) || s.latitude < -90 || s.latitude > 90) reject('LATITUDE_INVALID');
    if (!Number.isFinite(s.longitude) || s.longitude < -180 || s.longitude > 180) reject('LONGITUDE_INVALID');
    if (s.accuracyM === null || s.accuracyM === undefined) reject('ACCURACY_UNKNOWN');
    else if (!Number.isFinite(s.accuracyM) || s.accuracyM < 0) reject('ACCURACY_INVALID');
    if (!Number.isFinite(s.capturedAt)) reject('CAPTURED_AT_INVALID');
    else if (s.capturedAt > now + MAX_CLOCK_SKEW_MS) reject('CAPTURED_AT_IN_FUTURE');
    else if (s.capturedAt < now - MAX_SNAPSHOT_AGE_MS) reject('CAPTURED_AT_TOO_OLD');
    if (s.batteryPct !== null && s.batteryPct !== undefined && (!Number.isInteger(s.batteryPct) || s.batteryPct < 0 || s.batteryPct > 100)) {
      reject('BATTERY_INVALID');
    }
    if (typeof s.source !== 'string' || s.source.trim() === '' || s.source.length > 32) reject('SOURCE_INVALID');
  });
  return rejections;
}

export interface RecordResult {
  /** Newly stored. */
  readonly stored: number;
  /** Already present: a retry of a batch that had (at least partly) arrived. */
  readonly duplicates: number;
}

type Owner = { readonly kind: 'session' | 'incident'; readonly id: string };

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REGION_REGISTRY) private readonly regions: RegionRegistry,
  ) {}

  /**
   * Retention comes from the owner's region profile. With no region set, the SHORTEST
   * retention among the known profiles applies: keeping location longer than any market
   * allows is the failure to avoid, so an unknown market gets the least.
   */
  private retentionDays(regionProfileId: string | null | undefined): number {
    const profile = regionProfileId ? this.regions.profileFor(regionProfileId) : null;
    if (profile) return profile.privacy.retention.locationDays;
    const shortest = Math.min(...this.regions.profiles.map((p) => p.privacy.retention.locationDays));
    // Without the user, the profile, or any coordinates in the message.
    this.logger.warn(`No region profile for a location write; using the shortest known retention (${shortest} days)`);
    return shortest;
  }

  private async write(userId: string, owner: Owner, snapshots: readonly SnapshotInput[], now: number): Promise<RecordResult> {
    if (snapshots.length < 1 || snapshots.length > MAX_BATCH) {
      throw new BadRequestException(`A batch must hold between 1 and ${MAX_BATCH} snapshots`);
    }
    const rejections = validateSnapshots(snapshots, now);
    if (rejections.length > 0) {
      // Indices and codes only. The values that failed are exactly what must not be echoed.
      throw new BadRequestException({ message: 'Some snapshots were refused', rejections });
    }

    const regionProfileId =
      owner.kind === 'session'
        ? (await this.prisma.safetySession.findFirst({ where: { id: owner.id, userId }, select: { state: true } })
            .then(async (s) => {
              if (!s) throw new NotFoundException('Not found');
              if ((SESSION_TERMINAL as readonly string[]).includes(s.state)) {
                throw new ConflictException('That session has ended; it can no longer receive location');
              }
              return (await this.prisma.user.findUnique({ where: { id: userId }, select: { regionProfileId: true } }))?.regionProfileId;
            }))
        : (await this.prisma.emergencyIncident.findFirst({ where: { id: owner.id, userId }, select: { state: true, regionProfileId: true } })
            .then((i) => {
              if (!i) throw new NotFoundException('Not found');
              if ((INCIDENT_TERMINAL as readonly string[]).includes(i.state)) {
                throw new ConflictException('That incident has ended; it can no longer receive location');
              }
              return i.regionProfileId;
            }));

    const days = this.retentionDays(regionProfileId);
    const result = await this.prisma.locationSnapshot.createMany({
      data: snapshots.map((s) => ({
        ...(owner.kind === 'session' ? { sessionId: owner.id } : { incidentId: owner.id }),
        latitude: s.latitude,
        longitude: s.longitude,
        accuracyM: s.accuracyM as number, // validated non-null above
        capturedAt: new Date(s.capturedAt),
        batteryPct: s.batteryPct ?? null,
        source: s.source,
        expiresAt: new Date(s.capturedAt + days * DAY_MS),
      })),
      // ON CONFLICT DO NOTHING against the unique indexes: a resent batch is safe even
      // with two copies in flight at once.
      skipDuplicates: true,
    });
    return { stored: result.count, duplicates: snapshots.length - result.count };
  }

  recordForSession(userId: string, sessionId: string, snapshots: readonly SnapshotInput[], now: number) {
    return this.write(userId, { kind: 'session', id: sessionId }, snapshots, now);
  }

  recordForIncident(userId: string, incidentId: string, snapshots: readonly SnapshotInput[], now: number) {
    return this.write(userId, { kind: 'incident', id: incidentId }, snapshots, now);
  }
}
