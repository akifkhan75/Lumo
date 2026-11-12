import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PiiCipher, type PiiContext } from '../crypto/pii-cipher';
import { normaliseEmail, normalisePhone } from './normalise';

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
}

export const REVOKED_CONTACT_CHANGED = 'CONTACT_DETAILS_CHANGED';
export const REVOKED_CONTACT_REMOVED = 'CONTACT_REMOVED';

type Row = Prisma.TrustedContactGetPayload<{ include: { consent: true } }>;

@Injectable()
export class TrustedContactsService {
  constructor(private readonly cipher: PiiCipher) {}

  private cell(id: string, column: 'phone' | 'email'): PiiContext {
    return { model: 'TrustedContact', column, rowId: id };
  }

  private view(row: Row): ContactView {
    return {
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
      include: { consent: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Active contacts in alert order. Removed contacts never appear. */
  async list(tx: Tx, userId: string): Promise<ContactView[]> {
    return (await this.active(tx, userId)).map(row => this.view(row));
  }

  async create(tx: Tx, userId: string, input: ContactInput, priority: number): Promise<ContactView> {
    // The id is generated here, not by the database, because the ciphertext is
    // bound to it and must be written in the same statement.
    const id = randomUUID();
    const row = await tx.trustedContact.create({
      data: {
        id,
        userId,
        name: input.name,
        phone: this.cipher.encrypt(input.phone, this.cell(id, 'phone')),
        email: this.cipher.encryptNullable(input.email ?? null, this.cell(id, 'email')),
        priority,
      },
      include: { consent: true },
    });
    return this.view(row);
  }

  async update(tx: Tx, userId: string, id: string, patch: Partial<Omit<ContactInput, 'id'>> & { priority?: number }): Promise<ContactView> {
    const row = await tx.trustedContact.findFirst({ where: { id, userId, removedAt: null }, include: { consent: true } });
    if (!row) throw new NotFoundException('Contact not found');
    return this.applyUpdate(tx, row, patch);
  }

  private async applyUpdate(tx: Tx, row: Row, patch: Partial<Omit<ContactInput, 'id'>> & { priority?: number }): Promise<ContactView> {
    const before = this.view(row);
    const phone = patch.phone ?? before.phone;
    const email = patch.email === undefined ? before.email : patch.email;

    const identityChanged =
      normalisePhone(phone) !== normalisePhone(before.phone) || normaliseEmail(email) !== normaliseEmail(before.email);

    if (identityChanged && row.consentId) {
      await this.revoke(tx, row.consentId, REVOKED_CONTACT_CHANGED);
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
      },
    });
    if (count !== 1) throw new NotFoundException('Contact not found');

    const fresh = await tx.trustedContact.findUniqueOrThrow({ where: { id: row.id }, include: { consent: true } });
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
    await tx.trustedContact.updateMany({
      where: { id: row.id, userId: row.userId, removedAt: null },
      data: { removedAt: new Date(), consentId: null },
    });
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
  async replaceSet(tx: Tx, userId: string, inputs: readonly ContactInput[]): Promise<ContactView[]> {
    const existing = new Map((await this.active(tx, userId)).map(row => [row.id, row]));
    const kept = new Set<string>();

    for (const [priority, input] of inputs.entries()) {
      const match = input.id !== undefined && !kept.has(input.id) ? existing.get(input.id) : undefined;
      if (match) {
        kept.add(match.id);
        await this.applyUpdate(tx, match, { name: input.name, phone: input.phone, email: input.email, priority });
      } else {
        await this.create(tx, userId, input, priority);
      }
    }

    for (const row of existing.values()) {
      if (!kept.has(row.id)) await this.softRemove(tx, row);
    }

    return this.list(tx, userId);
  }
}
