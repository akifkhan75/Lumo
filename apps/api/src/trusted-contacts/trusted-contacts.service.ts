import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PiiCipher, type PiiContext } from '../crypto/pii-cipher';
import { normaliseEmail, normalisePhone } from './normalise';
import { toE164 } from './phone';

/**
 * Trusted contacts: who a user would call in an emergency.
 *
 * Three properties here carry real weight, and each exists because the previous
 * implementation lacked it:
 *
 * 1. IDS ARE STABLE. Settings used to replace the whole set with a deleteMany then
 *    createMany, so every save gave every contact a new id. The delivery ledger
 *    refers to a contact by id, so editing a number would have orphaned the
 *    history of every alert that contact ever received. An edit now updates the
 *    row; the id never changes.
 *
 * 2. A CHANGED NUMBER OR ADDRESS REVOKES CONSENT. The person at the old number
 *    agreed to be alerted, not whoever has the new one (RES-7). With ids now
 *    stable, consent would otherwise follow the id to a stranger. The consent
 *    record is revoked — never deleted, it is evidence — and the contact is not
 *    alerted until they agree again.
 *
 * 3. REMOVAL IS SOFT. A removed contact leaves every read and every recipient
 *    list, but the row stays so the id in the ledger always resolves. Purging its
 *    personal data belongs to the retention job (milestone 2.11).
 *
 * Every method takes the transaction client, so a caller composes these inside one
 * transaction (settings does) and a failure part-way can never leave a half-applied
 * contact list.
 *
 * Every write is scoped by userId. An id belonging to another account cannot be
 * used to read or change anything of theirs.
 */

export type Tx = Prisma.TransactionClient;

export interface ContactInput {
  /** A previous id. Honoured only if it is one of THIS user's active contacts. */
  readonly id?: string;
  readonly name: string;
  readonly phone: string;
  readonly email?: string | null;
}

export interface ContactView {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly priority: number;
  /** Has the CONTACT agreed, and not since withdrawn it? Only then are they alerted. */
  readonly consented: boolean;
  /** Why, in the words the app shows. "agreed" is NOT "will be alerted today" (no alert path yet). */
  readonly consentStatus: ConsentStatus;
}

export type ConsentStatus = 'not_invited' | 'waiting' | 'agreed' | 'withdrawn' | 'expired' | 'details_changed';

export const ENDED_CONTACT_WITHDREW = 'CONTACT_WITHDREW';
export const ENDED_DETAILS_CHANGED = 'DETAILS_CHANGED';
export const ENDED_CONTACT_REMOVED = 'CONTACT_REMOVED';
export const ENDED_REPLACED = 'REPLACED';

type Row = Prisma.TrustedContactGetPayload<{ include: { consent: true; invites: true } }>;

/** Display status from the newest invite and the consent record. Pure. */
export function consentStatusOf(row: Row, now: Date): ConsentStatus {
  const latest = row.invites[0];
  if (!latest) return 'not_invited';
  if (latest.endedAt) {
    if (latest.endedReason === ENDED_CONTACT_WITHDREW) return 'withdrawn';
    return latest.endedReason === ENDED_DETAILS_CHANGED ? 'details_changed' : 'expired';
  }
  if (latest.acceptedAt) return row.consent !== null && row.consent.revokedAt === null ? 'agreed' : 'withdrawn';
  return latest.expiresAt > now ? 'waiting' : 'expired';
}

export const REVOKED_CONTACT_CHANGED = 'CONTACT_DETAILS_CHANGED';
export const REVOKED_CONTACT_REMOVED = 'CONTACT_REMOVED';

const WITH = { consent: true, invites: { orderBy: { createdAt: 'desc' as const }, take: 1 } };

@Injectable()
export class TrustedContactsService {
  constructor(private readonly cipher: PiiCipher) {}

  private cell(id: string, column: 'phone' | 'email'): PiiContext {
    return { model: 'TrustedContact', column, rowId: id };
  }

  private view(row: Row): ContactView {
    return {
      consentStatus: consentStatusOf(row, new Date()),
      id: row.id,
      name: row.name,
      phone: this.cipher.decrypt(row.phone, this.cell(row.id, 'phone')),
      email: this.cipher.decryptNullable(row.email, this.cell(row.id, 'email')),
      priority: row.priority,
      consented: row.consent !== null && row.consent.revokedAt === null,
    };
  }

  private active(tx: Tx, userId: string): Promise<Row[]> {
    return tx.trustedContact.findMany({
      where: { userId, removedAt: null },
      include: WITH,
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Active contacts in alert order. Removed contacts never appear. */
  async list(tx: Tx, userId: string): Promise<ContactView[]> {
    return (await this.active(tx, userId)).map(row => this.view(row));
  }

  /** A NEW or CHANGED number must be a real one, in E.164. See docs/specs/TRUSTED_CONTACTS.md. */
  private checked(phone: string, country: string | null): string {
    const r = toE164(phone, country);
    if (r.ok) return r.e164;
    throw new BadRequestException(
      r.reason === 'NEEDS_COUNTRY'
        ? 'Start the phone number with + and the country code (for example +92…). Lumo does not know which country you are in.'
        : 'That does not look like a real phone number.',
    );
  }

  /** The same person, however the number is written. Falls back to digits for old, unparseable data. */
  private canon(phone: string, country: string | null): string {
    const r = toE164(phone, country);
    return r.ok ? r.e164 : normalisePhone(phone);
  }

  /**
   * One contact by id, as the worker needs it at SEND time: consent is checked again
   * then, because it can be withdrawn between planning an alert and sending it. Null
   * for a contact that is removed or unknown.
   */
  async findActive(tx: Tx, id: string): Promise<(ContactView & { userId: string; linkedUserId: string | null }) | null> {
    const row = await tx.trustedContact.findFirst({ where: { id, removedAt: null }, include: WITH });
    // linkedUserId is for the worker only. It is never part of ContactView, so it can never reach a response.
    return row ? { ...this.view(row), userId: row.userId, linkedUserId: row.linkedUserId } : null;
  }

  async create(tx: Tx, userId: string, input: ContactInput, priority: number, country: string | null = null): Promise<ContactView> {
    const phone = this.checked(input.phone, country);
    // The id is generated here, not by the database, because the ciphertext is
    // bound to it and must be written in the same statement.
    const id = randomUUID();
    const row = await tx.trustedContact.create({
      data: {
        id,
        userId,
        name: input.name,
        phone: this.cipher.encrypt(phone, this.cell(id, 'phone')),
        email: this.cipher.encryptNullable(input.email ?? null, this.cell(id, 'email')),
        priority,
      },
      include: WITH,
    });
    return this.view(row);
  }

  async update(tx: Tx, userId: string, id: string, patch: Partial<Omit<ContactInput, 'id'>> & { priority?: number }, country: string | null = null): Promise<ContactView> {
    const row = await tx.trustedContact.findFirst({ where: { id, userId, removedAt: null }, include: WITH });
    if (!row) throw new NotFoundException('Contact not found');
    return this.applyUpdate(tx, row, patch, country);
  }

  private async applyUpdate(tx: Tx, row: Row, patch: Partial<Omit<ContactInput, 'id'>> & { priority?: number }, country: string | null): Promise<ContactView> {
    const before = this.view(row);
    const email = patch.email === undefined ? before.email : patch.email;

    // A number is validated only when it is CHANGING. One that is merely sent back
    // as it was stays as stored, even if it is old data we could not normalise now:
    // otherwise a single legacy contact would make every settings save fail.
    const sameNumber = patch.phone === undefined || this.canon(patch.phone, country) === this.canon(before.phone, country);
    const phone = sameNumber ? before.phone : this.checked(patch.phone as string, country);

    const identityChanged = !sameNumber || normaliseEmail(email) !== normaliseEmail(before.email);

    if (identityChanged) {
      if (row.consentId) await this.revoke(tx, row.consentId, REVOKED_CONTACT_CHANGED);
      // A link sent to the OLD number or address must not grant consent for the new one.
      await this.endInvites(tx, row.id, ENDED_DETAILS_CHANGED);
    }

    // updateMany so the userId stays in the WHERE: scoping is part of the write.
    const { count } = await tx.trustedContact.updateMany({
      where: { id: row.id, userId: row.userId, removedAt: null },
      data: {
        name: patch.name,
        phone: this.cipher.encrypt(phone, this.cell(row.id, 'phone')),
        email: this.cipher.encryptNullable(email, this.cell(row.id, 'email')),
        priority: patch.priority,
        consentId: identityChanged ? null : undefined,
        // The account that claimed this contact was the person at the OLD number or address.
        ...(identityChanged ? { linkedUserId: null, linkedAt: null } : {}),
      },
    });
    if (count !== 1) throw new NotFoundException('Contact not found');

    const fresh = await tx.trustedContact.findUniqueOrThrow({ where: { id: row.id }, include: WITH });
    return this.view(fresh);
  }

  /** Soft delete, and withdraw the consent. The row and its id remain. */
  async remove(tx: Tx, userId: string, id: string): Promise<void> {
    const row = await tx.trustedContact.findFirst({ where: { id, userId, removedAt: null } });
    if (!row) throw new NotFoundException('Contact not found');
    await this.softRemove(tx, row);
  }

  private async softRemove(tx: Tx, row: { id: string; userId: string; consentId: string | null }): Promise<void> {
    if (row.consentId) await this.revoke(tx, row.consentId, REVOKED_CONTACT_REMOVED);
    await this.endInvites(tx, row.id, ENDED_CONTACT_REMOVED);
    await tx.trustedContact.updateMany({
      where: { id: row.id, userId: row.userId, removedAt: null },
      data: { removedAt: new Date(), consentId: null, linkedUserId: null, linkedAt: null },
    });
  }

  /** End every open invite for a contact. Ended invites are kept as history. */
  async endInvites(tx: Tx, contactId: string, reason: string): Promise<void> {
    await tx.contactInvite.updateMany({ where: { contactId, endedAt: null }, data: { endedAt: new Date(), endedReason: reason } });
  }

  private async revoke(tx: Tx, consentId: string, reason: string): Promise<void> {
    // Revoke, never delete: a consent record is evidence of what was agreed.
    // Already-revoked records keep their original reason.
    await tx.consentRecord.updateMany({
      where: { id: consentId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /**
   * Make the user's active contacts match `inputs`, in that order.
   *
   * - An input carrying the id of one of THIS user's active contacts updates it,
   *   keeping its id and (unless the number or address changed) its consent.
   * - An input with no id, an unknown id, another user's id, a removed contact's
   *   id, or an id already used earlier in the list is a NEW contact. An id from
   *   another account is never honoured, so it cannot be used to touch their data.
   * - An active contact not mentioned is removed (softly).
   *
   * Position in the list becomes priority: the first is alerted first.
   */
  async replaceSet(tx: Tx, userId: string, inputs: readonly ContactInput[], country: string | null = null): Promise<ContactView[]> {
    const existing = new Map((await this.active(tx, userId)).map(row => [row.id, row]));
    const kept = new Set<string>();

    for (const [priority, input] of inputs.entries()) {
      const match = input.id !== undefined && !kept.has(input.id) ? existing.get(input.id) : undefined;
      if (match) {
        kept.add(match.id);
        await this.applyUpdate(tx, match, { name: input.name, phone: input.phone, email: input.email, priority }, country);
      } else {
        await this.create(tx, userId, input, priority, country);
      }
    }

    for (const row of existing.values()) {
      if (!kept.has(row.id)) await this.softRemove(tx, row);
    }

    return this.list(tx, userId);
  }
}
