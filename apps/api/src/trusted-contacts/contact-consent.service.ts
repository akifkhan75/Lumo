import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ENDED_CONTACT_WITHDREW, ENDED_REPLACED } from './trusted-contacts.service';

/**
 * The contact's side of consent (docs/specs/TRUSTED_CONTACTS.md, RES-7).
 *
 * The CONTACT agrees, not the user, so the contact needs a way to do it without an
 * account: a link. The link's token is stored only as a hash, shown once to the user,
 * and is also how the contact withdraws — so it is as sensitive as a password.
 *
 * Every public outcome other than "this link is for a live request" is one value,
 * `invalid`: an unknown, expired, replaced or ended link must not be told apart, or
 * the endpoint becomes a way to probe for tokens.
 */

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CONSENT_SCOPE = 'receive_emergency_alerts';
/** Bump when the wording on the consent page changes, so a record says what was shown. */
export const CONSENT_TEXT_VERSION = 'v1';
export const REVOKED_CONTACT_WITHDREW = 'CONTACT_WITHDREW';

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export type PublicInvite =
  | { readonly state: 'invalid' }
  | { readonly state: 'pending' | 'agreed' | 'withdrawn'; readonly inviterName: string; readonly agreedAt?: Date };

type InviteRow = Prisma.ContactInviteGetPayload<{ include: { contact: { include: { user: { select: { fullName: true; regionProfileId: true } } } } } }>;

@Injectable()
export class ContactConsentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mint a link for one of the caller's own active contacts. Ends any earlier open
   * invite. The token is returned ONCE and cannot be recovered.
   */
  async invite(userId: string, contactId: string, now: Date): Promise<{ token: string; expiresAt: Date }> {
    const contact = await this.prisma.trustedContact.findFirst({
      where: { id: contactId, userId, removedAt: null },
      include: { consent: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    if (contact.consent && contact.consent.revokedAt === null) {
      throw new ConflictException('This contact has already agreed.');
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    try {
      await this.prisma.$transaction(async tx => {
        await tx.contactInvite.updateMany({
          where: { contactId, endedAt: null },
          data: { endedAt: now, endedReason: ENDED_REPLACED },
        });
        await tx.contactInvite.create({ data: { contactId, tokenHash: hashToken(token), expiresAt, createdAt: now } });
      });
    } catch (e) {
      // Two invites racing: the partial unique index lets one through.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Another invite was just created. Try again.');
      }
      throw e;
    }
    return { token, expiresAt };
  }

  private find(token: string): Promise<InviteRow | null> {
    return this.prisma.contactInvite.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { contact: { include: { user: { select: { fullName: true, regionProfileId: true } } } } },
    });
  }

  private static live(i: InviteRow, now: Date): 'pending' | 'agreed' | 'withdrawn' | 'invalid' {
    if (i.contact.removedAt) return 'invalid';
    if (i.endedAt) {
      // Only the contact's own withdrawal stays visible to them; every other ending
      // is indistinguishable from a link that never existed.
      return i.acceptedAt && i.endedReason === ENDED_CONTACT_WITHDREW ? 'withdrawn' : 'invalid';
    }
    if (i.acceptedAt) return 'agreed';
    return i.expiresAt > now ? 'pending' : 'invalid';
  }

  async view(token: string, now: Date): Promise<PublicInvite> {
    const i = await this.find(token);
    if (!i) return { state: 'invalid' };
    const state = ContactConsentService.live(i, now);
    if (state === 'invalid') return { state };
    return { state, inviterName: i.contact.user.fullName, agreedAt: i.acceptedAt ?? undefined };
  }

  /** Single use: the conditional update lets exactly one of any number of concurrent accepts through. */
  async accept(token: string, now: Date): Promise<PublicInvite> {
    const i = await this.find(token);
    if (!i || ContactConsentService.live(i, now) !== 'pending') return this.view(token, now);

    class Lost extends Error {}
    try {
      await this.prisma.$transaction(async tx => {
        const consent = await tx.consentRecord.create({
          data: {
            id: randomUUID(),
            // The contact has no account, so they are both the one granting and not a Lumo subject.
            grantedById: i.contactId,
            subjectId: null,
            kind: 'contact_role',
            scope: CONSENT_SCOPE,
            grantedAt: now,
            version: CONSENT_TEXT_VERSION,
            regionProfileId: i.contact.user.regionProfileId ?? 'UNRESOLVED',
          },
        });
        const { count } = await tx.contactInvite.updateMany({
          where: { id: i.id, acceptedAt: null, endedAt: null, expiresAt: { gt: now } },
          data: { acceptedAt: now, consentId: consent.id },
        });
        if (count !== 1) throw new Lost(); // another accept won: roll this one back, record nothing
        await tx.trustedContact.update({ where: { id: i.contactId }, data: { consentId: consent.id } });
      });
    } catch (e) {
      if (!(e instanceof Lost)) throw e;
    }
    return this.view(token, now);
  }

  /**
   * A signed-in Lumo user claims the link (docs/specs/NOTIFICATIONS.md): they agree, if they have
   * not already, and their ACCOUNT is linked to this contact, which is the only way a contact has
   * a push address. First claim wins; the account that added the contact cannot claim it; a link
   * that is not live is refused with the same answer as everywhere else.
   */
  async claim(userId: string, token: string, now: Date): Promise<'claimed'> {
    let i = await this.find(token);
    if (i && ContactConsentService.live(i, now) === 'pending') {
      await this.accept(token, now);
      i = await this.find(token);
    }
    if (!i || ContactConsentService.live(i, now) !== 'agreed') throw new NotFoundException();
    // You cannot be your own emergency contact: it would route your own alerts to your own phone.
    if (i.contact.userId === userId) throw new ConflictException('You cannot be your own emergency contact.');

    const { count } = await this.prisma.trustedContact.updateMany({
      where: { id: i.contactId, removedAt: null, OR: [{ linkedUserId: null }, { linkedUserId: userId }] },
      data: { linkedUserId: userId, linkedAt: now },
    });
    if (count !== 1) throw new ConflictException('This link has already been claimed by another account.');
    return 'claimed';
  }

  /** The contact withdraws with the same link. Immediate. Idempotent. A record is revoked, never deleted. */
  async withdraw(token: string, now: Date): Promise<PublicInvite> {
    const i = await this.find(token);
    if (!i || ContactConsentService.live(i, now) !== 'agreed') return this.view(token, now);

    await this.prisma.$transaction(async tx => {
      const { count } = await tx.contactInvite.updateMany({
        where: { id: i.id, endedAt: null, acceptedAt: { not: null } },
        data: { endedAt: now, endedReason: ENDED_CONTACT_WITHDREW },
      });
      // Withdrawing ends the account link too: no push address survives a withdrawal.
      await tx.trustedContact.updateMany({ where: { id: i.contactId }, data: { linkedUserId: null, linkedAt: null } });
      if (count === 1 && i.consentId) {
        await tx.consentRecord.updateMany({
          where: { id: i.consentId, revokedAt: null },
          data: { revokedAt: now, revokedReason: REVOKED_CONTACT_WITHDREW },
        });
      }
    });
    return this.view(token, now);
  }
}
