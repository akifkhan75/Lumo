import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * KI-7: this endpoint took `@Body() body: any` and passed it straight to
 * Prisma with a `// In a real app we'd validate this with DTOs` comment. An
 * unvalidated body on the endpoint that owns the trusted-contact list is the
 * one place in this API where bad input has a direct safety consequence: a
 * malformed phone number is a contact who cannot be reached in an emergency.
 */

// Deliberately permissive: E.164 plus the separators people actually type.
// Normalisation to E.164 against a region profile is Phase 1 work; rejecting
// a legitimate international number here would be worse than accepting a
// loosely formatted one.
const PHONE_PATTERN = /^\+?[0-9][0-9 ()./-]{4,24}$/;

export class PersonalInfoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName!: string;

  @IsString()
  @IsOptional()
  @MaxLength(16)
  bloodType?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  allergies?: string;
}

export class SecuritySettingsDto {
  @IsBoolean()
  @IsOptional()
  locationSharingEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  shareLocationOnSos?: boolean;

  @IsBoolean()
  @IsOptional()
  sendSmsOnSos?: boolean;

  @IsBoolean()
  @IsOptional()
  shakeToSosEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  voiceActivationEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  accidentDetectionEnabled?: boolean;
}

export class TrustedContactInputDto {
  // The client round-trips the id it was given. It is ignored server-side:
  // contacts are replaced as a set, so an id from another user's account
  // cannot be used to reach anything.
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(PHONE_PATTERN, {
    message: 'phone must be a plausible phone number',
  })
  phone!: string;
}

export class UpdateSettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalInfoDto)
  personalInfo?: PersonalInfoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SecuritySettingsDto)
  security?: SecuritySettingsDto;

  @IsOptional()
  @IsArray()
  // Bounded so one request cannot create an unbounded fan-out target list.
  // The escalation ceiling itself is maxRecipientsPerIncident in
  // docs/specs/ESCALATION_POLICY.md; this is the storage bound.
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => TrustedContactInputDto)
  trustedContacts?: TrustedContactInputDto[];
}
