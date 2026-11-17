import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * PLAT-4 (docs/specs/INCIDENTS.md): lets an SOS dispatch when the ordinary login has expired.
 *
 * An OPAQUE random token with only its SHA-256 stored, so it is not a JWT: the JWT strategy cannot
 * accept it, and it cannot be taken for a login. 30 days, re-minted every time the app opens while
 * signed in; minting for a device revokes that device's earlier one; at most MAX_LIVE per user; revoked
 * on logout. It is a deliberate privilege-escalation surface (T4), so its scope is tiny and enforced by
 * the one guard that accepts it.
 */

export const EMERGENCY_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_LIVE_CREDENTIALS = 10;
export const hashEmergencyToken = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class EmergencyCredentialService {
  constructor(private readonly prisma: PrismaService) {}

  async mint(userId: string, deviceKey: string, now: Date = new Date()): Promise<{ id: string; token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + EMERGENCY_TOKEN_TTL_MS);
    return this.prisma.$transaction(async tx => {
      // One live credential per device.
      await tx.emergencyCredential.updateMany({ where: { userId, deviceKey, revokedAt: null }, data: { revokedAt: now } });
      // And a ceiling per user: the oldest live ones go first.
      const live = await tx.emergencyCredential.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      const excess = live.length - (MAX_LIVE_CREDENTIALS - 1);
      if (excess > 0) {
        await tx.emergencyCredential.updateMany({ where: { id: { in: live.slice(0, excess).map(c => c.id) } }, data: { revokedAt: now } });
      }
      const row = await tx.emergencyCredential.create({
        data: { userId, deviceKey, tokenHash: hashEmergencyToken(token), expiresAt, createdAt: now },
        select: { id: true },
      });
      return { id: row.id, token, expiresAt };
    });
  }

  async revoke(userId: string, id: string, now: Date = new Date()): Promise<void> {
    const { count } = await this.prisma.emergencyCredential.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: now } });
    if (count !== 1) throw new NotFoundException();
  }

  /** The user a live token belongs to, or null. Expired, revoked and unknown are all the same null. */
  async verify(token: string, now: Date = new Date()): Promise<{ userId: string } | null> {
    const row = await this.prisma.emergencyCredential.findUnique({ where: { tokenHash: hashEmergencyToken(token) } });
    if (!row || row.revokedAt || row.expiresAt <= now) return null;
    return { userId: row.userId };
  }
}
