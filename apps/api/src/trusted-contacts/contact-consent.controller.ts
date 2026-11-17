import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Request, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContactConsentService } from './contact-consent.service';
import { consentPage } from './consent-page';

/**
 * Two surfaces:
 *  - authenticated: the account holder asks for a link for one of their contacts;
 *  - public: the contact opens that link. Unauthenticated BY DESIGN — the contact has no
 *    account. The token is the credential, so it must never reach a log, a referrer or a
 *    cache, and every failure looks the same.
 */

/** Headers for any page whose URL carries a secret. */
const SECRET_URL_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

@Controller('api/v1/trusted-contacts')
@UseGuards(JwtAuthGuard)
export class ContactInviteController {
  constructor(private readonly consent: ContactConsentService) {}

  /**
   * Mint a link. Lumo SENDS NOTHING: the user passes the link on themselves, and the
   * response says so. Only the path is returned; the app already knows its own base URL.
   */
  @Post(':id/invite')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async invite(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    const { token, expiresAt } = await this.consent.invite(req.user.id, id, new Date());
    return { path: `/api/v1/contacts/invites/${token}`, expiresAt, sentByLumo: false };
  }
}

@Controller('api/v1/contacts/invites')
export class PublicConsentController {
  constructor(private readonly consent: ContactConsentService) {}

  private send(res: Response, status: number, html: string) {
    for (const [k, v] of Object.entries(SECRET_URL_HEADERS)) res.setHeader(k, v);
    res.status(status).type('html').send(html);
  }

  private action(token: string) {
    return `/api/v1/contacts/invites/${token}`;
  }

  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async page(@Param('token') token: string, @Res() res: Response) {
    const invite = await this.consent.view(token, new Date());
    this.send(res, invite.state === 'invalid' ? 404 : 200, consentPage(invite, this.action(token)));
  }

  @Post(':token/accept')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async accept(@Param('token') token: string, @Res() res: Response) {
    const invite = await this.consent.accept(token, new Date());
    this.send(res, invite.state === 'invalid' ? 404 : 200, consentPage(invite, this.action(token)));
  }

  @Post(':token/revoke')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async revoke(@Param('token') token: string, @Res() res: Response) {
    const invite = await this.consent.withdraw(token, new Date());
    this.send(res, invite.state === 'invalid' ? 404 : 200, consentPage(invite, this.action(token)));
  }
}

/** A signed-in Lumo user claims a consent link. Authenticated, so it is separate from the public page. */
@Controller('api/v1/contacts/invites')
@UseGuards(JwtAuthGuard)
export class ContactClaimController {
  constructor(private readonly consent: ContactConsentService) {}

  @Post(':token/claim')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async claim(@Request() req: any, @Param('token') token: string) {
    await this.consent.claim(req.user.id, token, new Date());
    return { claimed: true };
  }
}
