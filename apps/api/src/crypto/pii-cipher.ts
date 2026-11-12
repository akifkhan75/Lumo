import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Field-level encryption for personal data at rest (KI-26).
 *
 * Contact phone numbers and email, and a user's blood type and allergies, were
 * stored as plaintext. A database dump, a leaked backup or a read-only SQL
 * injection then discloses who a person would call in an emergency and their
 * medical details. These fields are encrypted in the application, so the
 * database only ever holds ciphertext.
 *
 * AES-256-GCM, from node:crypto — deliberately no dependency.
 *
 * FORMAT   enc:v1:<keyId>:<iv>:<tag>:<ciphertext>      (base64url parts)
 * - `v1` versions the scheme; `keyId` selects the key, so keys can be rotated
 *   without re-encrypting everything at once.
 * - The IV is random per value. GCM must never reuse an IV under one key.
 *
 * BINDING   The authenticated data is "<model>.<column>:<rowId>". A ciphertext
 * therefore only decrypts for the exact cell it was written to: copying Alice's
 * encrypted phone number into Bob's row, or into another column, fails
 * authentication instead of silently showing Alice's number as Bob's contact.
 *
 * WHAT THIS DOES NOT DO   It does not hide that a row exists or its length, and
 * the database can no longer search these columns. It protects data at rest from
 * someone who can read the database but not the key; it does nothing against
 * someone who can read the running process.
 */

export interface PiiContext {
  readonly model: string;
  readonly column: string;
  readonly rowId: string;
}

export interface Keyring {
  /** The key new values are encrypted with. */
  readonly currentId: string;
  /** Every key that can still decrypt, including the current one. */
  readonly keys: ReadonlyMap<string, Buffer>;
}

export const ENCRYPTED_PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** A stored value that claims to be encrypted but cannot be authenticated. */
export class PiiDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PiiDecryptionError';
  }
}

const aad = (c: PiiContext) => Buffer.from(`${c.model}.${c.column}:${c.rowId}`, 'utf8');

export class PiiCipher {
  /**
   * Values read that were not encrypted: rows written before encryption existed.
   * They are read as-is rather than failing, because refusing to read a contact's
   * phone number is worse than reading it. Nothing here ever WRITES plaintext, and
   * `pnpm --filter api db:encrypt-pii` converts what is left. A non-zero count in
   * production means that script has not been run.
   */
  legacyPlaintextReads = 0;

  constructor(private readonly keyring: Keyring) {
    const current = keyring.keys.get(keyring.currentId);
    if (!current || current.length !== KEY_BYTES) {
      throw new Error(`The current encryption key "${keyring.currentId}" is missing or not ${KEY_BYTES} bytes`);
    }
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(ENCRYPTED_PREFIX);
  }

  encrypt(plaintext: string, context: PiiContext): string {
    const key = this.keyring.keys.get(this.keyring.currentId)!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(context));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      ENCRYPTED_PREFIX + this.keyring.currentId,
      iv.toString('base64url'),
      tag.toString('base64url'),
      body.toString('base64url'),
    ].join(':');
  }

  decrypt(stored: string, context: PiiContext): string {
    if (!this.isEncrypted(stored)) {
      this.legacyPlaintextReads++;
      return stored;
    }

    const parts = stored.slice(ENCRYPTED_PREFIX.length).split(':');
    if (parts.length !== 4) throw new PiiDecryptionError('Malformed encrypted value');
    const [keyId, ivText, tagText, bodyText] = parts;

    const key = this.keyring.keys.get(keyId);
    if (!key) throw new PiiDecryptionError(`No key "${keyId}" is configured to decrypt this value`);

    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
      decipher.setAAD(aad(context));
      decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(bodyText, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      // Wrong key, tampered ciphertext, or a value moved to a different cell. The
      // reason is deliberately not distinguished, and the value is never echoed.
      throw new PiiDecryptionError(
        `Could not decrypt ${context.model}.${context.column} for row ${context.rowId}: authentication failed`,
      );
    }
  }

  /** `undefined` means "leave it alone"; `null` is stored as null. */
  encryptNullable(value: string | null | undefined, context: PiiContext): string | null | undefined {
    return value === undefined || value === null ? value : this.encrypt(value, context);
  }

  decryptNullable(value: string | null, context: PiiContext): string | null {
    return value === null ? null : this.decrypt(value, context);
  }
}
