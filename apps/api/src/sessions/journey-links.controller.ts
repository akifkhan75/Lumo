import { Body, Controller, Delete, Get, Header, Headers, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Request, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JourneyLinkService, MAX_LINK_MINUTES, MIN_LINK_MINUTES } from './journey-link.service';

export class CreateLinkDto {
  @IsOptional() @IsInt() @Min(MIN_LINK_MINUTES) @Max(MAX_LINK_MINUTES) expiresInMinutes?: number;
  @IsOptional() @IsString() @Matches(/^\d{4,8}$/, { message: 'A PIN is 4 to 8 digits.' }) pin?: string;
}

/** The person's own side: mint, see, revoke. Login only. */
@Controller('api/v1/safety-sessions/:id/links')
@UseGuards(JwtAuthGuard)
export class JourneyLinksController {
  constructor(private readonly links: JourneyLinkService) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: CreateLinkDto) {
    const { token, ...rest } = await this.links.create(req.user.id, id, body);
    // Only the path: the app knows its own web address. Lumo sends nothing: the person passes the link on themselves.
    return { ...rest, path: `/j/${token}`, sentByLumo: false };
  }

  @Get()
  list(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.links.list(req.user.id, id);
  }

  @Delete(':linkId')
  @HttpCode(204)
  async revoke(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Param('linkId', new ParseUUIDPipe()) linkId: string) {
    await this.links.revoke(req.user.id, id, linkId);
  }
}

const NO_STORE = 'no-store';

/**
 * The link holder's side. UNAUTHENTICATED BY DESIGN: the token is the credential. The web app calls this from its server, not from the
 * browser, so the token never meets a third-party script, and the headers say not to cache or index it. Unknown, expired and revoked
 * are one 404; a missing or wrong PIN is one 401 that says only that a PIN is needed.
 */
@Controller('api/v1/j')
export class PublicJourneyController {
  constructor(private readonly links: JourneyLinkService) {}

  private unwrap(r: Awaited<ReturnType<JourneyLinkService['lookup']>>) {
    if (r.kind === 'invalid') throw new NotFoundException();
    if (r.kind === 'pin_required') throw new UnauthorizedException({ message: 'A PIN is needed.', pinRequired: true });
    return r.journey;
  }

  @Get(':token')
  @Header('Cache-Control', NO_STORE)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async view(@Param('token') token: string, @Headers('x-link-pin') pin?: string) {
    return this.unwrap(await this.links.lookup(token, pin, new Date(), true));
  }

  @Post(':token/respond')
  @HttpCode(200)
  @Header('Cache-Control', NO_STORE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async respond(@Param('token') token: string, @Headers('x-link-pin') pin?: string) {
    return this.unwrap(await this.links.respond(token, pin, 'respond'));
  }

  @Post(':token/unrespond')
  @HttpCode(200)
  @Header('Cache-Control', NO_STORE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async unrespond(@Param('token') token: string, @Headers('x-link-pin') pin?: string) {
    return this.unwrap(await this.links.respond(token, pin, 'unrespond'));
  }
}
