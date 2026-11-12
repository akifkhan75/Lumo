import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { DangerZoneSeverity, DangerZoneType } from '@prisma/client';

/**
 * The body of POST /api/v1/danger-zones. Previously an inline object type,
 * which class-validator cannot see — so the global ValidationPipe skipped the
 * endpoint entirely and free text arrived unbounded.
 *
 * NOTE: this model is wrong and is scheduled for replacement. A severity
 * attached to a place, plus free text, is the Citizen/Nextdoor redlining
 * failure mode. It becomes HazardReport — a condition with a source, a
 * confirmation count and an expiry — in its own change after Phase 0. See
 * docs/adr/0010-hazard-reports-replace-danger-zones.md.
 */
export class CreateDangerZoneDto {
  @IsEnum(DangerZoneSeverity)
  severity!: DangerZoneSeverity;

  @IsEnum(DangerZoneType)
  type!: DangerZoneType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;
}
