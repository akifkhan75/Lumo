import { describe, expect, it } from 'vitest';
import { apply, type Snapshot } from './machine';
import { ATTEMPT_MACHINE, ATTEMPT_EVENTS, isAttemptTerminal, attemptStanding, type AttemptEvent } from './attempt';
import { ATTEMPT_STATES, CHANNEL_CAPABILITIES, capabilityIssues, maxState, type AttemptState, type ChannelCapability } from './capabilities';
import { CHANNELS, type Actor, type Channel } from './types';

const run = (state: AttemptState, event: AttemptEvent, channel: Channel, by: Actor = 'system', evidence?: 'provider' | 'device') =>
  apply(ATTEMPT_MACHINE, { state, priorState: null } as Snapshot<AttemptState>, event, { at: 1, by }, { capability: CHANNEL_CAPABILITIES[channel], evidence });

describe('channel capabilities are data, and self-consistent', () => {
  it.each(CHANNELS)('%s has a coherent capability', (c) => {
    expect(CHANNEL_CAPABILITIES[c].channel).toBe(c);
    expect(capabilityIssues(CHANNEL_CAPABILITIES[c])).toEqual([]);
  });

  it('every channel requires consent, and only email is not emergency-grade', () => {
    for (const c of CHANNELS) expect(CHANNEL_CAPABILITIES[c].requiresConsent).toBe(true);
    expect(CHANNELS.filter((c) => !CHANNEL_CAPABILITIES[c].isEmergencyGrade)).toEqual(['email']);
  });

  it('matches the ledger spec: the furthest each channel can go', () => {
    const expected: Record<Channel, string> = {
      push: 'ACKNOWLEDGED', sms: 'DELIVERED', voice: 'SENT', device_direct_sms: 'SENT', email: 'SENT', web: 'ACKNOWLEDGED',
    };
    for (const c of CHANNELS) expect(maxState(CHANNEL_CAPABILITIES[c])).toBe(expected[c]);
  });

  it('catches a capability that contradicts itself', () => {
    const base = CHANNEL_CAPABILITIES.sms;
    expect(capabilityIssues({ ...base, automaticCeiling: 'DELIVERED', deliveredEvidence: 'none' })).toHaveLength(1);
    expect(capabilityIssues({ ...base, automaticCeiling: 'SENT', deliveredEvidence: 'provider' })).toHaveLength(1);
  });
});

describe('push delivery needs the device, not the push service', () => {
  it('an Expo/FCM/APNs receipt alone NEVER moves a push attempt to DELIVERED', () => {
    // A provider receipt means the push service ACCEPTED the message. It does not
    // mean the handset has it. (Expo docs; APNs has no per-message device receipt.)
    const out = run('SENT', 'RECEIPT_DELIVERED', 'push', 'system', 'provider');
    expect(out).toMatchObject({ ok: false, rejection: 'GUARD_FAILED' });
    expect(out.snapshot.state).toBe('SENT');
  });

  it('a receipt with no stated source is not accepted either', () => {
    expect(run('SENT', 'RECEIPT_DELIVERED', 'push', 'system', undefined)).toMatchObject({ ok: false, rejection: 'GUARD_FAILED' });
  });

  it('the device reporting back is what reaches DELIVERED', () => {
    const out = run('SENT', 'RECEIPT_DELIVERED', 'push', 'contact', 'device');
    expect(out.ok && out.snapshot.state).toBe('DELIVERED');
  });

  it('a push the device never confirms expires and falls back — it is not left looking delivered', () => {
    const out = run('SENT', 'TTL_ELAPSED', 'push');
    expect(out.ok && out.snapshot.state).toBe('EXPIRED');
    expect(out.ok && out.record.effects).toEqual(['triggerFallback']);
  });
});

describe('a channel can never be recorded above what it can truthfully report', () => {
  it('SMS delivery is vouched for by the provider, not the device', () => {
    expect(run('SENT', 'RECEIPT_DELIVERED', 'sms', 'system', 'provider').ok).toBe(true);
    expect(run('SENT', 'RECEIPT_DELIVERED', 'sms', 'system', 'device')).toMatchObject({ rejection: 'GUARD_FAILED' });
  });

  it.each(['voice', 'device_direct_sms', 'email'] as const)('%s can never be DELIVERED, whoever claims it', (ch) => {
    for (const evidence of ['provider', 'device'] as const) {
      for (const by of ['system', 'contact'] as const) {
        expect(run('SENT', 'RECEIPT_DELIVERED', ch, by, evidence)).toMatchObject({ ok: false, rejection: 'GUARD_FAILED' });
      }
    }
  });

  it.each(['sms', 'voice', 'device_direct_sms', 'email'] as const)('%s cannot be acknowledged — no human can respond through it', (ch) => {
    expect(run('SENT', 'ACK', ch, 'contact')).toMatchObject({ rejection: 'GUARD_FAILED' });
  });

  it.each(['push', 'web'] as const)('%s can be acknowledged, even before any delivery receipt', (ch) => {
    expect(run('SENT', 'ACK', ch, 'contact').ok).toBe(true);
    expect(run('DELIVERED', 'ACK', ch, 'contact').ok).toBe(true);
  });

  it('only a contact acknowledges', () => {
    expect(run('SENT', 'ACK', 'push', 'system')).toMatchObject({ rejection: 'ACTOR_NOT_PERMITTED' });
  });
});

describe('UNKNOWN is the honest state', () => {
  it.each(['voice', 'device_direct_sms', 'email'] as const)('%s can say it cannot report further', (ch) => {
    expect(run('SENT', 'CHANNEL_CANNOT_REPORT', ch).ok).toBe(true);
  });
  it('SMS can too, because its receipts depend on provider and destination network', () => {
    expect(run('SENT', 'CHANNEL_CANNOT_REPORT', 'sms').ok).toBe(true);
  });
  it('push and web cannot — their evidence comes from the device, so absence is a timeout, not "cannot report"', () => {
    for (const ch of ['push', 'web'] as const) expect(run('SENT', 'CHANNEL_CANNOT_REPORT', ch)).toMatchObject({ rejection: 'GUARD_FAILED' });
  });
  it('a channel that stops at SENT lets its TTL lapse to UNKNOWN, not EXPIRED', () => {
    for (const ch of ['voice', 'device_direct_sms', 'email'] as const) {
      const out = run('SENT', 'TTL_ELAPSED', ch);
      expect(out.ok && out.snapshot.state).toBe('UNKNOWN');
      expect(out.ok && out.record.effects).toEqual([]); // not a failure, so no fallback
    }
  });
  it('a channel that could have reported but did not lets its TTL lapse to EXPIRED', () => {
    for (const ch of ['push', 'sms', 'web'] as const) expect(run('SENT', 'TTL_ELAPSED', ch).ok && run('SENT', 'TTL_ELAPSED', ch)).toMatchObject({ snapshot: { state: 'EXPIRED' } });
  });
});

describe('failure and fallback', () => {
  it('a rejected send is FAILED and asks for a fallback', () => {
    const out = run('QUEUED', 'PROVIDER_REJECTED', 'sms');
    expect(out.ok && out.snapshot.state).toBe('FAILED');
    expect(out.ok && out.record.effects).toEqual(['triggerFallback']);
  });
  it('an attempt that never left the queue expires and falls back', () => {
    const out = run('QUEUED', 'TTL_ELAPSED', 'push');
    expect(out.ok && out.snapshot.state).toBe('EXPIRED');
    expect(out.ok && out.record.effects).toEqual(['triggerFallback']);
  });
  it('a spend-cap hit is a FAILED attempt with a recorded reason, and the user is told', () => {
    for (const by of ['system', 'policy'] as const) {
      const out = run('QUEUED', 'SPEND_CAP_REACHED', 'sms', by);
      expect(out.ok && out.snapshot.state).toBe('FAILED');
      expect(out.ok && out.record.effects).toEqual(['recordReasonSpendCap', 'notifyUserSpendCap']);
    }
  });
  it('acceptance by the provider moves QUEUED to SENT', () => {
    expect(run('QUEUED', 'PROVIDER_ACCEPTED', 'push').ok).toBe(true);
  });
  it('acknowledging halts escalation', () => {
    expect(run('SENT', 'ACK', 'push', 'contact').ok && run('SENT', 'ACK', 'push', 'contact')).toMatchObject({ record: { effects: ['haltEscalation'] } });
  });
});

describe('deliberate rejections — the ledger is evidence', () => {
  it('FAILED → SENT: a retry is a NEW attempt with a new attemptNumber, never a mutation', () => {
    expect(run('FAILED', 'PROVIDER_ACCEPTED', 'sms')).toMatchObject({ rejection: 'ILLEGAL_TRANSITION' });
  });
  it('UNKNOWN → DELIVERED: once a channel says it cannot report, a later claim is not trustworthy', () => {
    for (const evidence of ['provider', 'device'] as const) {
      expect(run('UNKNOWN', 'RECEIPT_DELIVERED', 'sms', 'system', evidence)).toMatchObject({ rejection: 'ILLEGAL_TRANSITION' });
    }
  });
  it('ACKNOWLEDGED → DELIVERED: acknowledgement supersedes delivery', () => {
    expect(run('ACKNOWLEDGED', 'RECEIPT_DELIVERED', 'push', 'contact', 'device')).toMatchObject({ rejection: 'ILLEGAL_TRANSITION' });
  });
  it.each(['FAILED', 'EXPIRED', 'UNKNOWN', 'ACKNOWLEDGED'] as const)('%s allows nothing further', (terminal) => {
    for (const e of ATTEMPT_EVENTS) for (const ch of CHANNELS) for (const by of ['system', 'contact', 'policy', 'user'] as const) {
      expect(run(terminal, e, ch, by, CHANNEL_CAPABILITIES[ch].deliveredEvidence === 'none' ? undefined : CHANNEL_CAPABILITIES[ch].deliveredEvidence).ok).toBe(false);
    }
  });
});

describe('terminality', () => {
  it('FAILED, EXPIRED, UNKNOWN and ACKNOWLEDGED are always terminal', () => {
    for (const s of ['FAILED', 'EXPIRED', 'UNKNOWN', 'ACKNOWLEDGED'] as const) {
      for (const c of CHANNELS) expect(isAttemptTerminal(s, CHANNEL_CAPABILITIES[c])).toBe(true);
    }
  });
  it('QUEUED and SENT never are', () => {
    for (const s of ['QUEUED', 'SENT'] as const) for (const c of CHANNELS) expect(isAttemptTerminal(s, CHANNEL_CAPABILITIES[c])).toBe(false);
  });
  it('DELIVERED is terminal only where nobody can acknowledge through the channel', () => {
    expect(isAttemptTerminal('DELIVERED', CHANNEL_CAPABILITIES.sms)).toBe(true);
    expect(isAttemptTerminal('DELIVERED', CHANNEL_CAPABILITIES.push)).toBe(false);
  });
});

describe('how an attempt counts toward the rollup', () => {
  const sms = CHANNEL_CAPABILITIES.sms;
  const voice = CHANNEL_CAPABILITIES.voice;
  const cases: [AttemptState, ChannelCapability, string][] = [
    ['ACKNOWLEDGED', sms, 'acknowledged'],
    ['DELIVERED', sms, 'reached'],
    ['UNKNOWN', sms, 'reached'], // unconfirmed, but the message did leave the system
    ['SENT', voice, 'reached'], // SENT is as far as voice can ever go
    ['SENT', sms, 'pending'], // a receipt can still come
    ['QUEUED', sms, 'pending'],
    ['FAILED', sms, 'failed'],
    ['EXPIRED', sms, 'failed'],
  ];
  it.each(cases)('%s on a given channel is %s', (state, cap, standing) => {
    expect(attemptStanding(state, cap)).toBe(standing);
  });
  it('covers every state', () => {
    expect(new Set(cases.map((c) => c[0]))).toEqual(new Set(ATTEMPT_STATES));
  });
});
