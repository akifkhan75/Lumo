import { describe, expect, it } from 'vitest';
import { IDEMPOTENCY_BUCKET_MS, KEY_FIELD_SEPARATOR, idempotencyBucket, idempotencyKey, type IdempotencyInput } from './idempotency';
import { sha256Hex } from './sha256';

const base: IdempotencyInput = { userId: 'user-1', triggerType: 'shake', triggerAtMs: 1_700_000_030_000 };

describe('idempotencyKey', () => {
  it('has the shape the spec gives: sha256 over the fields, bucketed to the minute', () => {
    const expected = sha256Hex(['user-1', 'shake', String(Math.floor(1_700_000_030_000 / 60_000)), ''].join(KEY_FIELD_SEPARATOR));
    expect(idempotencyKey(base)).toBe(expected);
  });

  describe('it collapses RETRIES of one activation', () => {
    it('the same activation retried five times, offline then online, is one key', () => {
      const keys = new Set(Array.from({ length: 5 }, () => idempotencyKey({ ...base })));
      expect(keys.size).toBe(1);
    });

    it('is the same wherever the retry is sent from — it depends on nothing but its inputs', () => {
      expect(idempotencyKey({ ...base })).toBe(idempotencyKey({ ...base }));
    });

    it('is unaffected by a device clock that is wrong by an hour, because retries share the same triggerAtMs', () => {
      // Skew changes WHICH bucket the activation lands in, not whether its retries agree.
      const skewed = { ...base, triggerAtMs: base.triggerAtMs + 3_600_000 };
      expect(idempotencyKey(skewed)).toBe(idempotencyKey({ ...skewed }));
      expect(idempotencyKey(skewed)).not.toBe(idempotencyKey(base));
    });

    it('two triggers within the same minute bucket share a key', () => {
      const a = { ...base, triggerAtMs: 1_700_000_040_000 };
      const b = { ...base, triggerAtMs: 1_700_000_059_999 };
      expect(idempotencyBucket(a.triggerAtMs)).toBe(idempotencyBucket(b.triggerAtMs));
      expect(idempotencyKey(a)).toBe(idempotencyKey(b));
    });
  });

  describe('it does NOT merge separate activations that straddle a bucket boundary', () => {
    // This is a statement of what the key does, not a defect we are hiding. The spec
    // (§7) wants "two triggers within 60s → one incident". A bucketed key cannot give
    // that: 2s apart across a minute boundary lands in different buckets. Merging
    // separate activations needs a server-side rule — an open incident absorbing a
    // new trigger. See KNOWN_ISSUES.
    it('two triggers 2 seconds apart, either side of a minute boundary, get different keys', () => {
      const boundary = 1_700_000_040_000; // 1_700_000_040_000 / 60_000 is a whole number
      expect(boundary % IDEMPOTENCY_BUCKET_MS).toBe(0);
      const before = { ...base, triggerAtMs: boundary - 1_000 };
      const after = { ...base, triggerAtMs: boundary + 1_000 };
      expect(after.triggerAtMs - before.triggerAtMs).toBe(2_000);
      expect(idempotencyKey(before)).not.toBe(idempotencyKey(after));
    });

    it('the bucket is floor(ms / 60000)', () => {
      expect(idempotencyBucket(59_999)).toBe(0);
      expect(idempotencyBucket(60_000)).toBe(1);
      expect(idempotencyBucket(119_999)).toBe(1);
    });
  });

  describe('different activations get different keys', () => {
    it('for a different user, trigger type or session', () => {
      const k = idempotencyKey(base);
      expect(idempotencyKey({ ...base, userId: 'user-2' })).not.toBe(k);
      expect(idempotencyKey({ ...base, triggerType: 'manual' })).not.toBe(k);
      expect(idempotencyKey({ ...base, sessionId: 'session-9' })).not.toBe(k);
    });

    it('a missing session and a null session are the same activation', () => {
      expect(idempotencyKey({ ...base, sessionId: null })).toBe(idempotencyKey(base));
    });
  });

  describe('fields cannot be run together into a collision', () => {
    it('("ab","c") and ("a","bc") are different — plain concatenation would make them equal', () => {
      const a = idempotencyKey({ ...base, userId: 'ab', sessionId: 'c' });
      const b = idempotencyKey({ ...base, userId: 'a', sessionId: 'bc' });
      expect(a).not.toBe(b);
    });

    it('refuses a field containing the separator, which could forge such a collision', () => {
      expect(() => idempotencyKey({ ...base, userId: `a${KEY_FIELD_SEPARATOR}b` })).toThrow(RangeError);
      expect(() => idempotencyKey({ ...base, sessionId: `a${KEY_FIELD_SEPARATOR}b` })).toThrow(RangeError);
    });

    it('refuses a timestamp that is not a finite number', () => {
      for (const bad of [NaN, Infinity, -Infinity]) {
        expect(() => idempotencyKey({ ...base, triggerAtMs: bad })).toThrow(RangeError);
      }
    });
  });
});
