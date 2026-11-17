import { describe, expect, it } from 'vitest';
import { channelGate, dailyCapFor } from './gate';
import { completenessIssues } from './validation';
import { PK } from './profiles/pk';
import { US } from './profiles/us';
import { approvedProfile } from './testing/fixtures';

describe('channelGate', () => {
  it('a channel the profile does not list is off in that market', () => {
    expect(channelGate(PK, 'voice')).toEqual({ allowed: false, reason: 'CHANNEL_DISABLED_FOR_REGION' });
  });
  it('a listed channel is allowed', () => {
    expect(channelGate(PK, 'push')).toEqual({ allowed: true });
    expect(channelGate(approvedProfile(), 'voice')).toEqual({ allowed: true });
  });
  it('SMS and voice wait for registration (US A2P 10DLC), but push does not', () => {
    expect(channelGate(US, 'sms')).toEqual({ allowed: false, reason: 'REGISTRATION_INCOMPLETE' });
    expect(channelGate(US, 'voice')).toEqual({ allowed: false, reason: 'REGISTRATION_INCOMPLETE' });
    expect(channelGate(US, 'push')).toEqual({ allowed: true });
  });
  it('registration complete opens them', () => {
    const p = { ...US, messaging: { ...US.messaging, registrationComplete: true } };
    expect(channelGate(p, 'sms')).toEqual({ allowed: true });
  });
});

describe('dailyCapFor', () => {
  it('reads the profile, and is null for an uncapped or unlisted channel', () => {
    expect(dailyCapFor(PK, 'sms')).toBe(30);
    expect(dailyCapFor(PK, 'device_direct_sms')).toBeNull();
    expect(dailyCapFor(PK, 'voice')).toBeNull();
  });
});

describe('the cap is part of profile completeness (PLAT-5)', () => {
  it('a listed channel with no cap is incomplete', () => {
    const p = approvedProfile();
    const bad = { ...p, messaging: { ...p.messaging, dailyCaps: { push: 100, sms: 30, web: 100 } } }; // voice missing
    expect(completenessIssues(bad).map((i) => i.code)).toContain('SPEND_CAP_MISSING');
  });
  it.each([0, -1, 1.5, NaN])('a cap of %s is invalid', (cap) => {
    const p = approvedProfile();
    const bad = { ...p, messaging: { ...p.messaging, dailyCaps: { ...p.messaging.dailyCaps, sms: cap } } };
    expect(completenessIssues(bad).map((i) => i.code)).toContain('SPEND_CAP_INVALID');
  });
  it('device-direct SMS needs no cap', () => {
    expect(completenessIssues(approvedProfile()).map((i) => i.code)).not.toContain('SPEND_CAP_MISSING');
  });
});
