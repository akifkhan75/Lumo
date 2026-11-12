/**
 * Encrypt personal data that was written before field-level encryption existed
 * (KI-26): contact phone numbers and emails, and users' blood type and allergies.
 *
 *   pnpm --filter api db:encrypt-pii            convert whatever is still plaintext
 *   pnpm --filter api db:encrypt-pii --check    only report; exit 1 if any is left
 *
 * Idempotent: values that are already encrypted are skipped, so it is safe to run
 * twice, after a partial failure, or after rotating the key. Reading is tolerant of
 * plaintext (refusing to read a contact's number is worse), so this can run before
 * or after a deploy — but until it has, personal data is still in the clear at rest.
 *
 * `--check` is what a deploy gate or a periodic job should run: a non-zero exit
 * means plaintext remains.
 *
 * Needs DATABASE_URL and DATA_ENCRYPTION_KEY. Never prints a value.
 */
import { PrismaClient } from '@prisma/client';
import { getDataEncryptionKeyring } from '../src/config/env';
import { PiiCipher } from '../src/crypto/pii-cipher';

const BATCH = 500;
const checkOnly = process.argv.includes('--check');

async function main() {
  const prisma = new PrismaClient();
  const cipher = new PiiCipher(getDataEncryptionKeyring());
  const found = { users: 0, contacts: 0 };
  const converted = { users: 0, contacts: 0 };

  try {
    // Users: blood type and allergies.
    for (let cursor: string | undefined; ; ) {
      const rows = await prisma.user.findMany({
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        select: { id: true, bloodType: true, allergies: true },
      });
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].id;

      for (const u of rows) {
        const data: { bloodType?: string; allergies?: string } = {};
        for (const column of ['bloodType', 'allergies'] as const) {
          const value = u[column];
          if (value !== null && !cipher.isEncrypted(value)) {
            data[column] = cipher.encrypt(value, { model: 'User', column, rowId: u.id });
          }
        }
        if (Object.keys(data).length === 0) continue;
        found.users++;
        if (!checkOnly) {
          await prisma.user.update({ where: { id: u.id }, data });
          converted.users++;
        }
      }
    }

    // Contacts, INCLUDING removed ones: a soft-deleted contact still holds a number.
    for (let cursor: string | undefined; ; ) {
      const rows = await prisma.trustedContact.findMany({
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        select: { id: true, phone: true, email: true },
      });
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].id;

      for (const c of rows) {
        const data: { phone?: string; email?: string } = {};
        for (const column of ['phone', 'email'] as const) {
          const value = c[column];
          if (value !== null && !cipher.isEncrypted(value)) {
            data[column] = cipher.encrypt(value, { model: 'TrustedContact', column, rowId: c.id });
          }
        }
        if (Object.keys(data).length === 0) continue;
        found.contacts++;
        if (!checkOnly) {
          await prisma.trustedContact.update({ where: { id: c.id }, data });
          converted.contacts++;
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  if (checkOnly) {
    const total = found.users + found.contacts;
    console.log(`Plaintext remaining: ${found.users} user row(s), ${found.contacts} contact row(s).`);
    if (total > 0) {
      console.error('Personal data is still stored unencrypted. Run: pnpm --filter api db:encrypt-pii');
      process.exit(1);
    }
    return;
  }
  console.log(`Encrypted ${converted.users} user row(s) and ${converted.contacts} contact row(s).`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
