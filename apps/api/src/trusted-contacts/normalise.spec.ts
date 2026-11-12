import { describe, expect, it } from 'vitest';
import { normaliseEmail, normalisePhone } from './normalise';

describe('normalisePhone: formatting is not identity', () => {
  it('treats differently formatted forms of one number as equal', () => {
    const forms = ['+1 (555) 010-6000', '+15550106000', '+1.555.010.6000', ' +1 555 010 6000 ', '+1-555-010-6000'];
    expect(new Set(forms.map(normalisePhone)).size).toBe(1);
  });

  it('treats a different number as different', () => {
    expect(normalisePhone('+15550106000')).not.toBe(normalisePhone('+15550106001'));
  });

  it('keeps the leading + significant: a national number is not the same as an international one', () => {
    expect(normalisePhone('+15550106000')).not.toBe(normalisePhone('15550106000'));
  });

  it('handles numbers with no +', () => {
    expect(normalisePhone('(555) 010-6000')).toBe('5550106000');
  });
});

describe('normaliseEmail', () => {
  it('ignores case and surrounding space', () => {
    expect(normaliseEmail('  Mum@Example.COM ')).toBe('mum@example.com');
  });
  it('treats absent, null and blank as the same: no address', () => {
    expect(normaliseEmail(undefined)).toBeNull();
    expect(normaliseEmail(null)).toBeNull();
    expect(normaliseEmail('   ')).toBeNull();
  });
});
