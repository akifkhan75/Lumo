import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Request, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsBoolean, IsUUID, IsIn, IsInt, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EmergencyCredentialService } from './emergency-credential.service';
import { IncidentAuthGuard } from './incident-auth.guard';
import { IncidentService, SOS_TRIGGERS, type Caller } from './incident.service';

class LocationDto {
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  // null/absent = unknown; the service drops the fix rather than guess 0.
  @IsOptional() @IsNumber() accuracyM?: number | null;
  @IsInt() capturedAt!: number;
}

class PlaceDto {
  @IsString() @Length(2, 2) country!: string;
  @IsOptional() @IsString() @Length(1, 8) subdivision?: string | null;
}

export class SosDto {
  @IsIn(SOS_TRIGGERS as unknown as string[]) triggerType!: (typeof SOS_TRIGGERS)[number];
  @IsISO8601() triggeredAt!: string;
  @IsOptional() @IsInt() @Min(0) @Max(60) countdownSeconds?: number;
  @IsOptional() @ValidateNested() @Type(() => LocationDto) location?: LocationDto;
  @IsOptional() @ValidateNested() @Type(() => PlaceDto) place?: PlaceDto;
  // The journey this SOS happens during, if any; ignored unless it is the caller's own live journey.
  @IsOptional() @IsUUID() sessionId?: string;
  // Accepted by the schema only so they can be REFUSED with a clear message (see sos()).
  @IsOptional() @IsIn(['real', 'practice']) mode?: 'real' | 'practice';
  @IsOptional() @IsBoolean() duress?: boolean;
}

const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const caller = (req: any): Caller => ({ id: req.user.id, via: req.user.via ?? 'login' });

/** Raise, cancel, resolve and read an incident: the routes an emergency token may use. */
@Controller('api/v1')
@UseGuards(IncidentAuthGuard)
export class IncidentsController {
  constructor(private readonly incidents: IncidentService) {}

  @Post('sos')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async sos(@Request() req: any, @Headers('idempotency-key') key: string | undefined, @Body() body: SosDto, @Res({ passthrough: true }) res: Response) {
    if (!key || !KEY.test(key)) throw new BadRequestException('An Idempotency-Key header (8–128 letters, digits or . _ : -) is required.');
    // Refused, never accepted-and-ignored: it would show a ledger that must be hidden.
    if (body.duress) throw new BadRequestException('This option is not available yet. Nothing was sent.');

    const { replay, incident } = await this.incidents.raise(caller(req), key, {
      triggerType: body.triggerType,
      triggeredAt: new Date(body.triggeredAt),
      countdownSeconds: body.countdownSeconds,
      location: body.location ? { latitude: body.location.latitude, longitude: body.location.longitude, accuracyM: body.location.accuracyM ?? null, capturedAt: body.location.capturedAt } : null,
      place: body.place ?? null,
      sessionId: body.sessionId ?? null,
      mode: body.mode ?? 'real',
    });
    res.status(replay ? 200 : 201);
    return incident;
  }

  @Post('incidents/:id/cancel')
  @HttpCode(200)
  cancel(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.incidents.cancel(caller(req), id);
  }

  @Post('incidents/:id/resolve')
  @HttpCode(200)
  resolve(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.incidents.resolve(caller(req), id);
  }

  @Get('incidents/:id')
  get(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.incidents.view(caller(req), id);
  }
}

/** A linked contact's account answers an incident. Login only: an emergency token cannot. */
@Controller('api/v1/incidents')
@UseGuards(JwtAuthGuard)
export class IncidentResponseController {
  constructor(private readonly incidents: IncidentService) {}

  @Post(':id/ack')
  @HttpCode(200)
  ack(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.incidents.acknowledge(req.user.id, id);
  }

  @Post(':id/unack')
  @HttpCode(200)
  unack(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.incidents.unacknowledge(req.user.id, id);
  }
}

export class MintDto {
  // A stable per-install value: minting for a device revokes that device's earlier token.
  @IsString() @IsNotEmpty() @Length(8, 128) deviceKey!: string;
}

@Controller('api/v1/emergency-token')
@UseGuards(JwtAuthGuard)
export class EmergencyTokenController {
  constructor(private readonly credentials: EmergencyCredentialService) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  mint(@Request() req: any, @Body() body: MintDto) {
    return this.credentials.mint(req.user.id, body.deviceKey);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.credentials.revoke(req.user.id, id);
  }
}
