import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

const node = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('sha256Hex', () => {
  describe('published test vectors (NIST FIPS 180-4)', () => {
    it('empty string', () => {
      expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });
    it('"abc"', () => {
      expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
    it('the 448-bit message, which forces a second padding block', () => {
      expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
        '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
      );
    });
    it('one million "a"', () => {
      expect(sha256Hex('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
    });
  });

  it('agrees with node:crypto at every length across the padding boundaries', () => {
    // 55 fills a block with its length field; 56 and 64 are where padding spills.
    for (let n = 0; n <= 200; n++) {
      const s = 'x'.repeat(n);
      expect(sha256Hex(s), `length ${n}`).toBe(node(s));
    }
  });

  it('agrees with node:crypto on multi-byte UTF-8, including emoji and CJK', () => {
    for (const s of ['é', 'ß', '日本語', 'مرحبا', '🚨', 'a🚨b', '👨‍👩‍👧', 'اردو — پاکستان', '\u0000', '\u007f', '\u0080', '߿', 'ࠀ', '￿']) {
      expect(sha256Hex(s), JSON.stringify(s)).toBe(node(s));
    }
  });

  it('treats an unpaired surrogate as U+FFFD, as TextEncoder does', () => {
    const replacement = node('�');
    expect(sha256Hex('\ud800')).toBe(replacement); // lone high
    expect(sha256Hex('\udc00')).toBe(replacement); // lone low
    expect(sha256Hex('\ud800x')).toBe(node('�x')); // high followed by a non-surrogate
    expect(sha256Hex('a\ud83d')).toBe(node('a�')); // high at the very end
  });

  it('agrees with node:crypto on pseudo-random strings', () => {
    // A tiny deterministic generator so the test is repeatable without Math.random.
    let seed = 0x2545f491;
    const next = () => ((seed = (Math.imul(seed, 1103515245) + 12345) | 0) >>> 0);
    for (let i = 0; i < 300; i++) {
      let s = '';
      const len = next() % 150;
      for (let j = 0; j < len; j++) s += String.fromCodePoint(32 + (next() % 0x2000));
      expect(sha256Hex(s)).toBe(node(s));
    }
  });

  it('is lowercase hex, 64 characters', () => {
    expect(sha256Hex('anything')).toMatch(/^[0-9a-f]{64}$/);
  });
});
