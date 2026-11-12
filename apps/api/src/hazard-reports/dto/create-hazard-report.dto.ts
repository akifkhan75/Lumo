import { HazardType } from '@prisma/client';
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Free text is where a hazard report turns into an accusation about a person
 * or a business. Full moderation is Phase 4; these are the cheap structural
 * limits that hold until then.
 *
 * Rejecting contact details and links is not cosmetic: a report body is the
 * obvious vector for doxxing someone under cover of a safety feature, and a
 * link is the obvious vector for sending a stranger somewhere.
 */
const CONTAINS_NO_CONTACT_OR_LINK =
  /^(?!.*(https?:\/\/|www\.|[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s().-]{7,})).*$/is;

export class CreateHazardReportDto {
  @IsEnum(HazardType)
  type!: HazardType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(280)
  @Matches(CONTAINS_NO_CONTACT_OR_LINK, {
    message: 'description must not contain a link, email address or phone number',
  })
  description!: string;

  // Real coordinates, required. The predecessor invented a position on the
  // server because the client had none to send; a report whose location is
  // guessed is worse than no report.
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  /**
   * Metres. Optional because a device genuinely may not know, and an unknown
   * accuracy must travel as unknown rather than defaulting to a confident
   * number. Capped to keep a useless 50km-radius "fix" out of the map.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000)
  accuracyMetres?: number;
}
