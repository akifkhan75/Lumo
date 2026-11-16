import { describe, it, expect } from 'vitest';
import { resolveRecipients } from './recipients';
import type { ConsentStatus, ContactView } from './trusted-contacts.service';

const c = (id: string, consentStatus: ConsentStatus, consented = consentStatus === 'agreed'): ContactView => ({
  id, name: id, phone: '+923001234567', email: null, priority: 0, consented, consentStatus,
});

describe('resolveRecipients', () => {
  it('only a contact who has agreed is eligible', () => {
    const r = resolveRecipients([c('a', 'agreed'), c('b', 'waiting')]);
    expect(r.eligible.map((x) => x.id)).toEqual(['a']);
  });

  it.each([
    ['not_invited', 'NOT_INVITED'],
    ['waiting', 'AWAITING_CONSENT'],
    ['expired', 'INVITE_EXPIRED'],
    ['withdrawn', 'WITHDRAWN'],
    ['details_changed', 'DETAILS_CHANGED'],
  ] as const)('%s is skipped with reason %s', (status, reason) => {
    const r = resolveRecipients([c('x', status)]);
    expect(r.eligible).toEqual([]);
    expect(r.skipped).toEqual([{ contactId: 'x', name: 'x', reason }]);
  });

  it('every contact is either eligible or skipped — none vanishes', () => {
    const all = [c('1', 'agreed'), c('2', 'not_invited'), c('3', 'withdrawn'), c('4', 'agreed')];
    const r = resolveRecipients(all);
    expect(r.eligible.length + r.skipped.length).toBe(all.length);
  });

  it('a contact whose signals disagree (status agreed, consent not live) is skipped', () => {
    const r = resolveRecipients([c('x', 'agreed', false)]);
    expect(r.eligible).toEqual([]);
    expect(r.skipped[0].reason).toBe('WITHDRAWN');
  });

  it('preserves alert order', () => {
    const r = resolveRecipients([c('1', 'agreed'), c('2', 'agreed'), c('3', 'agreed')]);
    expect(r.eligible.map((x) => x.id)).toEqual(['1', '2', '3']);
  });

  it('no contacts, no recipients', () => {
    expect(resolveRecipients([])).toEqual({ eligible: [], skipped: [] });
  });
});
