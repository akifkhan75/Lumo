import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getCorsOrigins, getJwtSecret, getPort, requireEnv } from './env';

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
