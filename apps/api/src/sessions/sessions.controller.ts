import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
import { SESSION_KINDS } from '@lumo/safety-domain';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionService } from './session.service';

class DestinationDto {
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptional() @IsString() @Length(1, 120) label?: string | null;
}
export class CreateSessionDto {
  @IsIn(SESSION_KINDS as unknown as string[]) kind!: (typeof SESSION_KINDS)[number];
  @IsISO8601() expectedArrivalAt!: string;
  @IsOptional() @ValidateNested() @Type(() => DestinationDto) destination?: DestinationDto;
  @IsOptional() @IsBoolean() shareLocation?: boolean;
}
export class CheckInDto {
  @IsISO8601() expectedArrivalAt!: string;
}
class SnapshotDto {
  @IsNumber() latitude!: number;
  @IsNumber() longitude!: number;
  @IsOptional() @IsNumber() accuracyM?: number | null;
  @IsInt() capturedAt!: number;
  @IsOptional() @IsInt() batteryPct?: number | null;
  @IsString() @Length(1, 20) source!: string;
}
export class LocationBatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SnapshotDto) snapshots!: SnapshotDto[];
}

/**
 * Journeys. LOGIN ONLY: the emergency token acts on incidents, not on journeys, and a journey's check-in must not be answerable
 * by a credential that can do nothing else.
 */
@Controller('api/v1/safety-sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionService) {}

  @Post()
  @HttpCode(201)
  create(@Request() req: any, @Body() body: CreateSessionDto) {
    return this.sessions.create(req.user.id, {
      kind: body.kind, expectedArrivalAt: new Date(body.expectedArrivalAt), destination: body.destination ?? null, shareLocation: body.shareLocation,
    });
  }

  // Declared before ':id' so "active" is not read as an id.
  @Get('active')
  async active(@Request() req: any) {
    return { session: await this.sessions.active(req.user.id) };
  }

  @Get(':id')
  get(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.sessions.view(req.user.id, id);
  }

  @Post(':id/check-in')
  @HttpCode(200)
  checkIn(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: CheckInDto) {
    return this.sessions.checkIn(req.user.id, id, new Date(body.expectedArrivalAt));
  }

  @Post(':id/arrive')
  @HttpCode(200)
  arrive(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.sessions.arrive(req.user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.sessions.cancel(req.user.id, id);
  }

  @Post(':id/location')
  @HttpCode(200)
  location(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: LocationBatchDto) {
    return this.sessions.recordLocation(req.user.id, id, body.snapshots.map(s => ({ ...s, accuracyM: s.accuracyM ?? null })));
  }
}
