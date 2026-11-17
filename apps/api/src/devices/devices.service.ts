import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Push addresses (docs/specs/NOTIFICATIONS.md).
 *
 * A push token belongs to ONE user at a time. Registering a token that another account holds
 * first revokes that account's row: a phone that changes hands, or an account signed in on
 * someone else's phone, must not keep delivering the previous owner's alerts. The database
 * backs this with a partial unique index, so even a race cannot leave two live owners.
 *
 * A token is never logged and never returned.
 */

export interface RegisterDevice {
  readonly platform: 'ios' | 'android';
  readonly osVersion: string;
  readonly pushToken: string;
}

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, input: RegisterDevice, now: Date = new Date()): Promise<{ id: string }> {
    return this.prisma.$transaction(async tx => {
      // Anyone else holding this token loses it, and so does this user's own older row for it.
      await tx.device.updateMany({
        where: { pushToken: input.pushToken, revokedAt: null },
        data: { revokedAt: now },
      });
      const device = await tx.device.create({
        data: { userId, platform: input.platform, osVersion: input.osVersion, pushToken: input.pushToken, capabilities: {}, lastSeenAt: now },
        select: { id: true },
      });
      return device;
    });
  }

  /** Revoke one of the caller's own devices (logout). Not found for anyone else's. */
  async revoke(userId: string, deviceId: string, now: Date = new Date()): Promise<void> {
    const { count } = await this.prisma.device.updateMany({
      where: { id: deviceId, userId, revokedAt: null },
      data: { revokedAt: now },
    });
    if (count !== 1) throw new NotFoundException();
  }

  /** The live push tokens of an account. */
  async tokensFor(userId: string): Promise<{ id: string; pushToken: string }[]> {
    const rows = await this.prisma.device.findMany({
      where: { userId, revokedAt: null, pushToken: { not: null } },
      select: { id: true, pushToken: true },
    });
    return rows.flatMap(r => (r.pushToken ? [{ id: r.id, pushToken: r.pushToken }] : []));
  }

  /** Expo said this token is dead: stop sending to it. */
  async revokeToken(pushToken: string, now: Date = new Date()): Promise<void> {
    await this.prisma.device.updateMany({ where: { pushToken, revokedAt: null }, data: { revokedAt: now } });
  }
}
