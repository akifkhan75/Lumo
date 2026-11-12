import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { HazardType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHazardReportDto } from './dto/create-hazard-report.dto';

// Decay times, the confirmation floor and the routing rule are policy shared with
// the device, so they live in @lumo/safety-domain. They used to be declared here
// (and the floor a second time in @lumo/types), where the device could not see
// them and the two copies could drift. hazard-type-parity.ts proves, at compile
// time, that the Prisma enum and that shared policy name the same types.
import { hazardExpiresAt, hazardInfluencesRouting } from '@lumo/safety-domain';

/** findAll is unauthenticated-by-area and must never return the whole table. */
export const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

type ReportWithCount = Prisma.HazardReportGetPayload<{
  include: { _count: { select: { confirmations: true } } };
}>;

@Injectable()
export class HazardReportsService {
  constructor(private prisma: PrismaService) {}

  private expiryFor(type: HazardType, from: Date): Date {
    return new Date(hazardExpiresAt(type, from.getTime()));
  }

  private toApi(report: ReportWithCount) {
    const confirmationCount = report._count.confirmations;
    return {
      id: report.id,
      type: report.type,
      source: report.source,
      description: report.description,
      coordinates: {
        latitude: report.latitude,
        longitude: report.longitude,
        accuracyMetres: report.accuracyMetres,
      },
      reportedAt: report.reportedAt.toISOString(),
      expiresAt: report.expiresAt.toISOString(),
      confirmationCount,
      // A lone community report is displayed but must not steer anything.
      // A verified source is trusted without community confirmation.
      influencesRouting: hazardInfluencesRouting(report.source, confirmationCount),
    };
  }

  /**
   * Live reports only. An expired report is not deleted — it stays for audit
   * and for the reporter's own history — but it is never served as current.
   */
  async findAll(options: { take?: number } = {}) {
    const take = Math.min(options.take ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const reports = await this.prisma.hazardReport.findMany({
      where: { expiresAt: { gt: new Date() } },
      orderBy: { reportedAt: 'desc' },
      take,
      include: { _count: { select: { confirmations: true } } },
    });
    return reports.map(report => this.toApi(report));
  }

  async create(data: CreateHazardReportDto, userId: string) {
    const now = new Date();
    const report = await this.prisma.hazardReport.create({
      data: {
        type: data.type,
        description: data.description,
        latitude: data.latitude,
        longitude: data.longitude,
        accuracyMetres: data.accuracyMetres ?? null,
        reportedAt: now,
        expiresAt: this.expiryFor(data.type, now),
        userId,
      },
      include: { _count: { select: { confirmations: true } } },
    });
    return this.toApi(report);
  }

  /**
   * A second person observing the same condition both raises the confirmation
   * count and re-arms the expiry: a condition confirmed today is current
   * today, regardless of when it was first reported.
   *
   * The reporter cannot confirm their own report, and the unique constraint on
   * (reportId, userId) means one person counts once however many times they
   * press the button.
   */
  async confirm(reportId: string, userId: string) {
    const existing = await this.prisma.hazardReport.findUnique({
      where: { id: reportId },
      select: { id: true, type: true, userId: true, expiresAt: true },
    });
    if (!existing) {
      throw new NotFoundException('Hazard report not found');
    }
    if (existing.userId === userId) {
      throw new ConflictException('You cannot confirm your own report');
    }

    const now = new Date();
    const reArmed = this.expiryFor(existing.type, now);

    return this.prisma.$transaction(async tx => {
      try {
        await tx.hazardConfirmation.create({ data: { reportId, userId } });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException('You have already confirmed this report');
        }
        throw error;
      }

      const report = await tx.hazardReport.update({
        where: { id: reportId },
        // Never shorten an expiry a longer-lived type already earned.
        data: {
          expiresAt: reArmed > existing.expiresAt ? reArmed : existing.expiresAt,
        },
        include: { _count: { select: { confirmations: true } } },
      });
      return this.toApi(report);
    });
  }
}
