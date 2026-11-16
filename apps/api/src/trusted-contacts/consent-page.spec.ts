import { describe, it, expect } from 'vitest';
import { consentPage } from './consent-page';
import { consentStatusOf, ENDED_CONTACT_WITHDREW, ENDED_DETAILS_CHANGED } from './trusted-contacts.service';

describe('consentPage', () => {
  const act = '/api/v1/contacts/invites/T';
  it('escapes the inviter’s name', () => {
    const html = consentPage({ state: 'pending', inviterName: '<script>alert(1)</script>"&' }, act);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
  it('the invalid page names nobody', () => {
    const html = consentPage({ state: 'invalid' }, act);
    expect(html).toContain("isn't valid");
    expect(html).not.toContain('Joyce');
  });
  it('pending says what is not happening, and offers only agreeing', () => {
    const html = consentPage({ state: 'pending', inviterName: 'Joyce' }, act);
    expect(html).toContain('does not send alerts to contacts today');
    expect(html).toContain(`${act}/accept`);
    expect(html).not.toContain('/revoke');
  });
  it('agreed offers only withdrawing', () => {
    const html = consentPage({ state: 'agreed', inviterName: 'Joyce' }, act);
    expect(html).toContain(`${act}/revoke`);
    expect(html).not.toContain('/accept');
  });
  it('never promises to be told: says the inviter will see it in the app', () => {
    expect(consentPage({ state: 'withdrawn', inviterName: 'Joyce' }, act)).toContain('will see this in their Lumo app');
  });
});

describe('consentStatusOf', () => {
  const now = new Date('2026-11-17T12:00:00Z');
  const future = new Date(now.getTime() + 1000);
  const past = new Date(now.getTime() - 1000);
  const row = (invites: any[], consent: any = null): any => ({ invites, consent });

  it('no invite → not_invited', () => expect(consentStatusOf(row([]), now)).toBe('not_invited'));
  it('open, unaccepted, unexpired → waiting', () =>
    expect(consentStatusOf(row([{ endedAt: null, acceptedAt: null, expiresAt: future }]), now)).toBe('waiting'));
  it('open, unaccepted, expired → expired', () =>
    expect(consentStatusOf(row([{ endedAt: null, acceptedAt: null, expiresAt: past }]), now)).toBe('expired'));
  it('accepted with a live consent → agreed', () =>
    expect(consentStatusOf(row([{ endedAt: null, acceptedAt: past, expiresAt: past }], { revokedAt: null }), now)).toBe('agreed'));
  it('accepted but the consent is revoked → withdrawn, never agreed', () =>
    expect(consentStatusOf(row([{ endedAt: null, acceptedAt: past, expiresAt: past }], { revokedAt: past }), now)).toBe('withdrawn'));
  it('ended by the contact → withdrawn', () =>
    expect(consentStatusOf(row([{ endedAt: past, endedReason: ENDED_CONTACT_WITHDREW, acceptedAt: past, expiresAt: past }]), now)).toBe('withdrawn'));
  it('ended by a changed number → details_changed', () =>
    expect(consentStatusOf(row([{ endedAt: past, endedReason: ENDED_DETAILS_CHANGED, expiresAt: past }]), now)).toBe('details_changed'));
  it('any other ending → expired (needs asking again)', () =>
    expect(consentStatusOf(row([{ endedAt: past, endedReason: 'REPLACED', expiresAt: past }]), now)).toBe('expired'));
});
