import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CONFIRMATION_FLOOR,
  HAZARD_TTL_DAYS,
  HazardReportsService,
  MAX_PAGE_SIZE,
} from './hazard-reports.service';

const DAY_MS = 24 * 60 * 60 * 1000;

const dbReport = (overrides: Record<string, any> = {}) => ({
  id: 'report-1',
  type: 'POOR_LIGHTING',
  source: 'COMMUNITY',
  description: 'Streetlight out on the footbridge',
  latitude: 51.5074,
  longitude: -0.1278,
  accuracyMetres: 12.5,
  reportedAt: new Date('2026-10-20T20:00:00.000Z'),
  expiresAt: new Date('2026-11-19T20:00:00.000Z'),
  userId: 'user-1',
  createdAt: new Date('2026-10-20T20:00:00.000Z'),
  updatedAt: new Date('2026-10-20T20:00:00.000Z'),
  _count: { confirmations: 0 },
  ...overrides,
});

describe('HazardReportsService', () => {
  let service: HazardReportsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      hazardReport: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      hazardConfirmation: { create: vi.fn() },
      $transaction: vi.fn((fn: any) => fn(prisma)),
    };
    service = new HazardReportsService(prisma);
  });

  describe('findAll', () => {
    it('returns only live reports, newest first, with a derived confirmation count', async () => {
      prisma.hazardReport.findMany.mockResolvedValue([
        dbReport({ _count: { confirmations: 4 } }),
      ]);

      const result = await service.findAll();

      expect(result).toEqual([
        {
          id: 'report-1',
          type: 'POOR_LIGHTING',
          source: 'COMMUNITY',
          description: 'Streetlight out on the footbridge',
          coordinates: { latitude: 51.5074, longitude: -0.1278, accuracyMetres: 12.5 },
          reportedAt: '2026-10-20T20:00:00.000Z',
          expiresAt: '2026-11-19T20:00:00.000Z',
          confirmationCount: 4,
          influencesRouting: true,
        },
      ]);

      const args = prisma.hazardReport.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual({ reportedAt: 'desc' });
      expect(args.where.expiresAt.gt).toBeInstanceOf(Date);
    });

    it('never returns an expired report', async () => {
      prisma.hazardReport.findMany.mockResolvedValue([]);
      const before = Date.now();

      await service.findAll();

      const cutoff: Date = prisma.hazardReport.findMany.mock.calls[0][0].where.expiresAt.gt;
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('caps the page size so the endpoint cannot return the whole table', async () => {
      prisma.hazardReport.findMany.mockResolvedValue([]);

      await service.findAll({ take: 10_000 });

      expect(prisma.hazardReport.findMany.mock.calls[0][0].take).toBe(MAX_PAGE_SIZE);
    });

    it('passes a smaller requested page size through', async () => {
      prisma.hazardReport.findMany.mockResolvedValue([]);

      await service.findAll({ take: 5 });

      expect(prisma.hazardReport.findMany.mock.calls[0][0].take).toBe(5);
    });

    it('marks a community report below the confirmation floor as not influencing routing', async () => {
      prisma.hazardReport.findMany.mockResolvedValue([
        dbReport({ _count: { confirmations: CONFIRMATION_FLOOR - 1 } }),
      ]);

      const [report] = await service.findAll();

      expect(report.confirmationCount).toBe(CONFIRMATION_FLOOR - 1);
      expect(report.influencesRouting).toBe(false);
    });

    it('trusts a verified source with no community confirmations', async () => {
      prisma.hazardReport.findMany.mockResolvedValue([
        dbReport({ source: 'VERIFIED_PARTNER', _count: { confirmations: 0 } }),
      ]);

      const [report] = await service.findAll();

      expect(report.influencesRouting).toBe(true);
    });

    it('passes an unknown accuracy through as null rather than inventing one', async () => {
      prisma.hazardReport.findMany.mockResolvedValue([dbReport({ accuracyMetres: null })]);

      const [report] = await service.findAll();

      expect(report.coordinates.accuracyMetres).toBeNull();
    });
  });

  describe('create', () => {
    it('stores the submitted coordinates and sets an expiry from the type TTL', async () => {
      prisma.hazardReport.create.mockResolvedValue(dbReport());

      await service.create(
        {
          type: 'POOR_LIGHTING' as any,
          description: 'Streetlight out on the footbridge',
          latitude: 51.5074,
          longitude: -0.1278,
          accuracyMetres: 12.5,
        },
        'user-9',
      );

      const data = prisma.hazardReport.create.mock.calls[0][0].data;
      expect(data.latitude).toBe(51.5074);
      expect(data.longitude).toBe(-0.1278);
      expect(data.userId).toBe('user-9');
      const ttlMs = data.expiresAt.getTime() - data.reportedAt.getTime();
      expect(ttlMs).toBe(HAZARD_TTL_DAYS.POOR_LIGHTING * DAY_MS);
    });

    it('gives each type its own lifetime', async () => {
      prisma.hazardReport.create.mockResolvedValue(dbReport());

      for (const type of ['OBSTRUCTED_PATH', 'UNSAFE_CROSSING', 'THEFT_REPORTED'] as const) {
        await service.create(
          { type: type as any, description: 'd', latitude: 1, longitude: 2 },
          'user-9',
        );
        const data = prisma.hazardReport.create.mock.calls.at(-1)![0].data;
        expect(data.expiresAt.getTime() - data.reportedAt.getTime()).toBe(
          HAZARD_TTL_DAYS[type] * DAY_MS,
        );
      }
    });

    it('records an omitted accuracy as null, not as a default number', async () => {
      prisma.hazardReport.create.mockResolvedValue(dbReport({ accuracyMetres: null }));

      await service.create(
        { type: 'OTHER' as any, description: 'd', latitude: 1, longitude: 2 },
        'user-9',
      );

      expect(prisma.hazardReport.create.mock.calls[0][0].data.accuracyMetres).toBeNull();
    });
  });

  describe('confirm', () => {
    it('rejects an unknown report', async () => {
      prisma.hazardReport.findUnique.mockResolvedValue(null);

      await expect(service.confirm('missing', 'user-2')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuses to let the reporter confirm their own report', async () => {
      prisma.hazardReport.findUnique.mockResolvedValue({
        id: 'report-1',
        type: 'POOR_LIGHTING',
        userId: 'user-1',
        expiresAt: new Date('2026-11-19T20:00:00.000Z'),
      });

      await expect(service.confirm('report-1', 'user-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.hazardConfirmation.create).not.toHaveBeenCalled();
    });

    it('turns a duplicate confirmation into a conflict instead of a second count', async () => {
      prisma.hazardReport.findUnique.mockResolvedValue({
        id: 'report-1',
        type: 'POOR_LIGHTING',
        userId: 'user-1',
        expiresAt: new Date('2026-11-19T20:00:00.000Z'),
      });
      prisma.hazardConfirmation.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      );

      await expect(service.confirm('report-1', 'user-2')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.hazardReport.update).not.toHaveBeenCalled();
    });

    it('re-arms the expiry from now when a confirmation extends it', async () => {
      const soon = new Date(Date.now() + 1 * DAY_MS);
      prisma.hazardReport.findUnique.mockResolvedValue({
        id: 'report-1',
        type: 'POOR_LIGHTING',
        userId: 'user-1',
        expiresAt: soon,
      });
      prisma.hazardConfirmation.create.mockResolvedValue({ id: 'c1' });
      prisma.hazardReport.update.mockResolvedValue(
        dbReport({ _count: { confirmations: 1 } }),
      );

      await service.confirm('report-1', 'user-2');

      const newExpiry: Date = prisma.hazardReport.update.mock.calls[0][0].data.expiresAt;
      expect(newExpiry.getTime()).toBeGreaterThan(soon.getTime());
    });

    it('never shortens an expiry that is already further out', async () => {
      const farOut = new Date(Date.now() + 500 * DAY_MS);
      prisma.hazardReport.findUnique.mockResolvedValue({
        id: 'report-1',
        type: 'OBSTRUCTED_PATH',
        userId: 'user-1',
        expiresAt: farOut,
      });
      prisma.hazardConfirmation.create.mockResolvedValue({ id: 'c1' });
      prisma.hazardReport.update.mockResolvedValue(
        dbReport({ _count: { confirmations: 1 } }),
      );

      await service.confirm('report-1', 'user-2');

      expect(prisma.hazardReport.update.mock.calls[0][0].data.expiresAt).toEqual(farOut);
    });

    it('writes the confirmation and the expiry in one transaction', async () => {
      prisma.hazardReport.findUnique.mockResolvedValue({
        id: 'report-1',
        type: 'POOR_LIGHTING',
        userId: 'user-1',
        expiresAt: new Date(),
      });
      prisma.hazardConfirmation.create.mockResolvedValue({ id: 'c1' });
      prisma.hazardReport.update.mockResolvedValue(
        dbReport({ _count: { confirmations: 3 } }),
      );

      const result = await service.confirm('report-1', 'user-2');

      expect(prisma.$transaction).toHaveBeenCalledOnce();
      expect(result.confirmationCount).toBe(3);
      expect(result.influencesRouting).toBe(true);
    });
  });
});
