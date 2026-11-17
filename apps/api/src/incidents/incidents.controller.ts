import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Request, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsUUID, IsIn, IsInt, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EmergencyCredentialService } from './emergency-credential.service';
import { IncidentAuthGuard } from './incident-auth.guard';
import { IncidentService, SOS_TRIGGERS, type Caller } from './incident.service';
import { IncidentHistoryService, timelineToCsv, HISTORY_PAGE_MAX } from './incident-history.service';

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
  // How long ago the press was, measured on the device (docs/specs/OFFLINE_SOS.md). The service refuses one over the cap, with a plain message.
  @IsOptional() @IsInt() @Min(0) elapsedSeconds?: number;
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
      elapsedSeconds: body.elapsedSeconds,
      location: body.location ? { latitude: body.location.latitude, longitude: body.location.longitude, accuracyM: body.location.accuracyM ?? null, capturedAt: body.location.capturedAt } : null,
      place: body.place ?? null,
      sessionId: body.sessionId ?? null,
      mode: body.mode ?? 'real',
    });
    res.status(replay ? 200 : 201);
    return incident;
  }

  /** Cancel by the key the press was made with: for a device that cancelled while offline and cannot know whether its request arrived. */
  @Post('sos/cancel')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  cancelByKey(@Request() req: any, @Headers('idempotency-key') key: string | undefined) {
    if (!key || !KEY.test(key)) throw new BadRequestException('An Idempotency-Key header (8–128 letters, digits or . _ : -) is required.');
    return this.incidents.cancelByKey(caller(req), key);
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

export class HistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(HISTORY_PAGE_MAX) limit?: number;
  @IsOptional() @IsString() @Length(1, 200) cursor?: string;
  @IsOptional() @IsIn(['real', 'practice']) mode?: 'real' | 'practice';
}

export class ExportQueryDto {
  @IsOptional() @IsIn(['json', 'csv']) format?: 'json' | 'csv';
}

/**
 * The person's own history (docs/specs/INCIDENT_HISTORY.md). LOGIN ONLY: an emergency token can act on the alert it started, but a phone that
 * holds one must not be able to read the person's past incidents. Real incidents by default; a rehearsal is never mixed in.
 */
@Controller('api/v1/incidents')
@UseGuards(JwtAuthGuard)
export class IncidentHistoryController {
  constructor(private readonly history: IncidentHistoryService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  list(@Request() req: any, @Query() q: HistoryQueryDto) {
    return this.history.list(req.user.id, q);
  }

  /** Every state change and attempt event, in order. `?format=csv` downloads it. Each export is recorded in the audit log. */
  @Get(':id/timeline')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async timeline(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Query() q: ExportQueryDto, @Res({ passthrough: true }) res: Response) {
    const t = await this.history.timeline(req.user.id, id);
    if (!q.format) return t;
    await this.history.recordExport(req.user.id, id, q.format);
    res.setHeader('Cache-Control', 'no-store');
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="lumo-incident-${id}.csv"`);
      return timelineToCsv(t);
    }
    res.setHeader('Content-Disposition', `attachment; filename="lumo-incident-${id}.json"`);
    return t;
  }
}
