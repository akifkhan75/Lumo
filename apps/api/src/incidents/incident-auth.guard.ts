import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { EmergencyCredentialService } from './emergency-credential.service';

/**
 * The ONLY guard that accepts an emergency token (docs/specs/INCIDENTS.md): login OR token.
 *
 * It is attached to exactly the routes an emergency token may use — raise an incident, cancel it,
 * resolve it, read its status. Every other route uses JwtAuthGuard, which cannot validate an opaque
 * token. A route-table test enforces both directions.
 *
 * `req.user` is `{ id, via }`. `via: 'token'` marks a caller who must not be shown names or numbers.
 */
const looksLikeJwt = (t: string) => t.split('.').length === 3;

@Injectable()
export class IncidentAuthGuard implements CanActivate {
  private readonly jwt = new (AuthGuard('jwt'))();

  constructor(private readonly credentials: EmergencyCredentialService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!bearer) throw new UnauthorizedException();

    if (looksLikeJwt(bearer)) {
      const ok = await this.jwt.canActivate(context);
      if (ok && req.user) req.user = { ...req.user, via: 'login' };
      return Boolean(ok);
    }
    const found = await this.credentials.verify(bearer);
    if (!found) throw new UnauthorizedException();
    req.user = { id: found.userId, via: 'token' };
    return true;
  }
}
