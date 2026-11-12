import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { getCorsOrigins, getDataEncryptionKeyring, getJwtSecret, getPort, requireEnv } from './env';

const VALID_SECRET = 'a'.repeat(48);

describe('env', () => {
  let saved: NodeJS.ProcessEnv;

  beforeEach(() => {
    saved = { ...process.env };
  });

  afterEach(() => {
    process.env = saved;
  });

  describe('getJwtSecret', () => {
    // KI-9. These are the cases that used to boot a deployment signing tokens
    // with a value published in this repository.
    it('throws when JWT_SECRET is unset', () => {
      delete process.env.JWT_SECRET;
      expect(() => getJwtSecret()).toThrow(/Missing required environment variable JWT_SECRET/);
    });

    it('throws when JWT_SECRET is blank', () => {
      process.env.JWT_SECRET = '   ';
      expect(() => getJwtSecret()).toThrow(/Missing required environment variable JWT_SECRET/);
    });

    it('throws when JWT_SECRET is too short to be worth having', () => {
      process.env.JWT_SECRET = 'short';
      expect(() => getJwtSecret()).toThrow(/at least 32 characters/);
    });

    it('rejects the value shipped in .env.example', () => {
      process.env.JWT_SECRET = 'lumo-super-secret-jwt-key-change-in-production';
      expect(() => getJwtSecret()).toThrow(/still set to an example value/);
    });

    it('rejects the old hardcoded fallback', () => {
      process.env.JWT_SECRET = 'super-secret-default-key';
      expect(() => getJwtSecret()).toThrow();
    });

    it('returns a real secret', () => {
      process.env.JWT_SECRET = VALID_SECRET;
      expect(getJwtSecret()).toBe(VALID_SECRET);
    });
  });

  describe('getCorsOrigins', () => {
    it('allows no browser origin by default', () => {
      delete process.env.CORS_ORIGINS;
      expect(getCorsOrigins()).toEqual([]);
    });

    it('parses and trims a comma-separated list', () => {
      process.env.CORS_ORIGINS = 'https://a.example, https://b.example ,';
      expect(getCorsOrigins()).toEqual(['https://a.example', 'https://b.example']);
    });
  });

  describe('getPort', () => {
    it('defaults to 3005, matching .env.example and the mobile client', () => {
      delete process.env.API_PORT;
      expect(getPort()).toBe(3005);
    });

    it('rejects a port that is not a number', () => {
      process.env.API_PORT = 'not-a-port';
      expect(() => getPort()).toThrow(/valid port number/);
    });

    it('rejects a port outside the valid range', () => {
      process.env.API_PORT = '70000';
      expect(() => getPort()).toThrow(/valid port number/);
    });
  });

  describe('requireEnv', () => {
    it('names the variable it could not find', () => {
      delete process.env.SOME_MISSING_VAR;
      expect(() => requireEnv('SOME_MISSING_VAR')).toThrow(/SOME_MISSING_VAR/);
    });
  });
});

describe('getDataEncryptionKeyring', () => {
  const b64 = () => randomBytes(32).toString('base64');

  it('refuses to start without a key — personal data must not be quietly stored in the clear', () => {
    expect(() => getDataEncryptionKeyring({})).toThrow(/Missing required environment variable DATA_ENCRYPTION_KEY/);
    expect(() => getDataEncryptionKeyring({ DATA_ENCRYPTION_KEY: '   ' })).toThrow(/Missing required/);
  });

  it('tells you how to make one', () => {
    expect(() => getDataEncryptionKeyring({})).toThrow('openssl rand -base64 32');
  });

  it('accepts base64 of exactly 32 bytes, named k1 by default', () => {
    const k = b64();
    const ring = getDataEncryptionKeyring({ DATA_ENCRYPTION_KEY: k });
    expect(ring.currentId).toBe('k1');
    expect(ring.keys.get('k1')!.equals(Buffer.from(k, 'base64'))).toBe(true);
  });

  it('rejects a key of the wrong length, which would otherwise weaken or break the cipher', () => {
    for (const n of [16, 24, 31, 33, 64]) {
      const bad = randomBytes(n).toString('base64');
      expect(() => getDataEncryptionKeyring({ DATA_ENCRYPTION_KEY: bad }), `${n} bytes`).toThrow(/exactly 32 bytes/);
    }
  });

  it('rejects an all-zero key', () => {
    expect(() => getDataEncryptionKeyring({ DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64') })).toThrow(/all zero/);
  });

  it('honours a custom key id and validates it', () => {
    expect(getDataEncryptionKeyring({ DATA_ENCRYPTION_KEY: b64(), DATA_ENCRYPTION_KEY_ID: '2026-q4' }).currentId).toBe('2026-q4');
    expect(() => getDataEncryptionKeyring({ DATA_ENCRYPTION_KEY: b64(), DATA_ENCRYPTION_KEY_ID: 'has:colon' })).toThrow(/key id may only contain/);
    expect(() => getDataEncryptionKeyring({ DATA_ENCRYPTION_KEY: b64(), DATA_ENCRYPTION_KEY_ID: 'x'.repeat(33) })).toThrow(/key id may only contain/);
  });

  describe('previous keys (decrypt-only, for rotation)', () => {
    it('are loaded alongside the current one', () => {
      const ring = getDataEncryptionKeyring({
        DATA_ENCRYPTION_KEY: b64(),
        DATA_ENCRYPTION_KEY_ID: 'new',
        DATA_ENCRYPTION_KEYS_PREVIOUS: `old1:${b64()}, old2:${b64()}`,
      });
      expect([...ring.keys.keys()].sort()).toEqual(['new', 'old1', 'old2']);
      expect(ring.currentId).toBe('new');
    });
    it('must look like id:key', () => {
      expect(() => getDataEncryptionKeyring({ DATA_ENCRYPTION_KEY: b64(), DATA_ENCRYPTION_KEYS_PREVIOUS: 'nocolon' })).toThrow(/id:base64key/);
      expect(() => getDataEncryptionKeyring({ DATA_ENCRYPTION_KEY: b64(), DATA_ENCRYPTION_KEYS_PREVIOUS: ':abc' })).toThrow(/id:base64key/);
    });
    it('must be valid keys with valid, unique ids', () => {
      expect(() => getDataEncryptionKeyring({ DATA_ENCRYPTION_KEY: b64(), DATA_ENCRYPTION_KEYS_PREVIOUS: 'old:AAAA' })).toThrow(/exactly 32 bytes/);
      expect(() => getDataEncryptionKeyring({ DATA_ENCRYPTION_KEY: b64(), DATA_ENCRYPTION_KEYS_PREVIOUS: `bad id:${b64()}` })).toThrow(/key id may only contain/);
      expect(() => getDataEncryptionKeyring({ DATA_ENCRYPTION_KEY: b64(), DATA_ENCRYPTION_KEYS_PREVIOUS: `k1:${b64()}` })).toThrow(/appears twice/);
    });
    it('are optional', () => {
      expect(getDataEncryptionKeyring({ DATA_ENCRYPTION_KEY: b64() }).keys.size).toBe(1);
    });
  });

  it('reads process.env by default', () => {
    const before = process.env.DATA_ENCRYPTION_KEY;
    process.env.DATA_ENCRYPTION_KEY = b64();
    try {
      expect(getDataEncryptionKeyring().currentId).toBe('k1');
    } finally {
      if (before === undefined) delete process.env.DATA_ENCRYPTION_KEY;
      else process.env.DATA_ENCRYPTION_KEY = before;
    }
  });
});
