import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ENCRYPTED_PREFIX, PiiCipher, PiiDecryptionError, type Keyring } from './pii-cipher';

const key = () => randomBytes(32);
const ring = (id = 'k1', extra: Record<string, Buffer> = {}): Keyring => ({
  currentId: id,
  keys: new Map([[id, key()], ...Object.entries(extra)]),
});
const cell = { model: 'TrustedContact', column: 'phone', rowId: 'row-1' };

describe('PiiCipher', () => {
  const cipher = new PiiCipher(ring());

  it('round-trips a value', () => {
    expect(cipher.decrypt(cipher.encrypt('+15551234567', cell), cell)).toBe('+15551234567');
  });

  it('round-trips an empty string and non-ASCII text', () => {
    for (const v of ['', 'O+', 'penicillin, latex — 日本語 🚨']) expect(cipher.decrypt(cipher.encrypt(v, cell), cell)).toBe(v);
  });

  it('stores ciphertext, not the plaintext', () => {
    const stored = cipher.encrypt('+15551234567', cell);
    expect(stored.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    expect(stored).not.toContain('15551234567');
    expect(cipher.isEncrypted(stored)).toBe(true);
    expect(cipher.isEncrypted('+15551234567')).toBe(false);
  });

  it('uses a fresh IV every time, so equal values do not look equal', () => {
    expect(cipher.encrypt('same', cell)).not.toBe(cipher.encrypt('same', cell));
  });

  it('records which key encrypted it', () => {
    expect(new PiiCipher(ring('2026-q4')).encrypt('x', cell).startsWith(`${ENCRYPTED_PREFIX}2026-q4:`)).toBe(true);
  });

  describe('a ciphertext only opens in the exact cell it was written to', () => {
    const stored = cipher.encrypt('+15551234567', cell);

    it('not in another row — Alice’s number cannot be passed off as Bob’s contact', () => {
      expect(() => cipher.decrypt(stored, { ...cell, rowId: 'row-2' })).toThrow(PiiDecryptionError);
    });
    it('not in another column', () => {
      expect(() => cipher.decrypt(stored, { ...cell, column: 'email' })).toThrow(PiiDecryptionError);
    });
    it('not in another table', () => {
      expect(() => cipher.decrypt(stored, { ...cell, model: 'User' })).toThrow(PiiDecryptionError);
    });
  });

  describe('tampering and the wrong key are detected, never read as garbage', () => {
    const stored = cipher.encrypt('+15551234567', cell);
    const flip = (s: string) => s.slice(0, -2) + (s.endsWith('AA') ? 'BB' : 'AA');

    it('a modified ciphertext', () => {
      expect(() => cipher.decrypt(flip(stored), cell)).toThrow(PiiDecryptionError);
    });
    it('a different key under the same id', () => {
      expect(() => new PiiCipher(ring()).decrypt(stored, cell)).toThrow(PiiDecryptionError);
    });
    it('an unknown key id', () => {
      expect(() => new PiiCipher(ring('other')).decrypt(stored, cell)).toThrow(/No key "k1"/);
    });
    it('a malformed value', () => {
      expect(() => cipher.decrypt(`${ENCRYPTED_PREFIX}k1:only-two:parts`, cell)).toThrow('Malformed');
    });
    it('and the error never contains the plaintext or the stored value', () => {
      const secret = 'SECRET-PHONE-+15551234567';
      const sealed = cipher.encrypt(secret, cell);
      try {
        cipher.decrypt(sealed, { ...cell, rowId: 'elsewhere' });
        expect.unreachable();
      } catch (e) {
        expect(String(e)).not.toContain(secret);
        expect(String(e)).not.toContain(sealed);
      }
    });
  });

  describe('key rotation', () => {
    it('values written under a retired key still decrypt, and new values use the new key', () => {
      const oldKey = key();
      const before = new PiiCipher({ currentId: 'old', keys: new Map([['old', oldKey]]) });
      const stored = before.encrypt('+15551234567', cell);

      const after = new PiiCipher({ currentId: 'new', keys: new Map([['new', key()], ['old', oldKey]]) });
      expect(after.decrypt(stored, cell)).toBe('+15551234567');
      expect(after.encrypt('x', cell).startsWith(`${ENCRYPTED_PREFIX}new:`)).toBe(true);
    });
  });

  describe('rows written before encryption existed', () => {
    it('are read as they are rather than failing — refusing to read a contact’s number is worse', () => {
      const c = new PiiCipher(ring());
      expect(c.decrypt('+15551234567', cell)).toBe('+15551234567');
    });
    it('and are counted, so a non-zero count says the conversion script has not been run', () => {
      const c = new PiiCipher(ring());
      c.decrypt('+1', cell);
      c.decrypt('+2', cell);
      c.decrypt(c.encrypt('+3', cell), cell);
      expect(c.legacyPlaintextReads).toBe(2);
    });
  });

  describe('nullable helpers', () => {
    it('undefined means leave it alone, null stays null, a value is encrypted', () => {
      expect(cipher.encryptNullable(undefined, cell)).toBeUndefined();
      expect(cipher.encryptNullable(null, cell)).toBeNull();
      expect(cipher.isEncrypted(cipher.encryptNullable('x', cell) as string)).toBe(true);
    });
    it('decrypting null gives null', () => {
      expect(cipher.decryptNullable(null, cell)).toBeNull();
      expect(cipher.decryptNullable(cipher.encrypt('x', cell), cell)).toBe('x');
    });
  });

  it('refuses to be built without a usable current key', () => {
    expect(() => new PiiCipher({ currentId: 'k1', keys: new Map() })).toThrow(/missing or not 32 bytes/);
    expect(() => new PiiCipher({ currentId: 'k1', keys: new Map([['k1', Buffer.alloc(16)]]) })).toThrow(/missing or not 32 bytes/);
  });
});
