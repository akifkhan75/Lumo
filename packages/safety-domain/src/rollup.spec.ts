import { describe, expect, it } from 'vitest';
import { rollupIncident, type AttemptView } from './rollup';

const a = (recipientId: string, channel: AttemptView['channel'], state: AttemptView['state']): AttemptView => ({ recipientId, channel, state });

describe('rollupIncident (docs/specs/DELIVERY_LEDGER.md §3)', () => {
  it('any acknowledged attempt makes the incident ACKNOWLEDGED — the only state meaning "help knows"', () => {
    const r = rollupIncident([a('maya', 'push', 'ACKNOWLEDGED'), a('dad', 'push', 'FAILED'), a('mum', 'sms', 'DELIVERED')]);
    expect(r.outcome).toBe('ACKNOWLEDGED');
    expect(r.acknowledged).toEqual(['maya']);
  });

  it('everyone reached and nobody responded is NOTIFIED — "sent", never "acknowledged"', () => {
    const r = rollupIncident([a('maya', 'push', 'DELIVERED'), a('mum', 'sms', 'DELIVERED')]);
    expect(r.outcome).toBe('NOTIFIED');
    expect(r.acknowledged).toEqual([]);
  });

  it('some reached and some not is PARTIALLY_NOTIFIED, and names who was missed', () => {
    const r = rollupIncident([a('maya', 'sms', 'DELIVERED'), a('mum', 'sms', 'DELIVERED'), a('dad', 'sms', 'FAILED')]);
    expect(r.outcome).toBe('PARTIALLY_NOTIFIED');
    expect(r.failed).toEqual(['dad']);
    expect(r.reached).toEqual(['maya', 'mum']);
  });

  it('nobody reached is ALL_CHANNELS_FAILED, never success', () => {
    const r = rollupIncident([a('maya', 'push', 'FAILED'), a('dad', 'sms', 'EXPIRED')]);
    expect(r.outcome).toBe('ALL_CHANNELS_FAILED');
    expect(r.failed).toEqual(['maya', 'dad']);
  });

  it('an incident with nobody to notify is ALL_CHANNELS_FAILED too', () => {
    expect(rollupIncident([]).outcome).toBe('ALL_CHANNELS_FAILED');
  });

  it('attempts still in flight keep it NOTIFYING', () => {
    const r = rollupIncident([a('maya', 'sms', 'DELIVERED'), a('dad', 'push', 'QUEUED')]);
    expect(r.outcome).toBe('NOTIFYING');
    expect(r.pending).toEqual(['dad']);
  });

  describe('a fallback is the same recipient, so it is rolled up per recipient', () => {
    it('a failed push followed by a delivered SMS means the recipient WAS reached', () => {
      const r = rollupIncident([a('dad', 'push', 'FAILED'), a('dad', 'sms', 'DELIVERED')]);
      expect(r.outcome).toBe('NOTIFIED');
      expect(r.failed).toEqual([]);
    });

    it('a failed push with the SMS fallback still in flight is pending, not failed', () => {
      const r = rollupIncident([a('dad', 'push', 'FAILED'), a('dad', 'sms', 'QUEUED')]);
      expect(r.outcome).toBe('NOTIFYING');
    });

    it('one recipient’s success does not hide another’s failure', () => {
      const r = rollupIncident([a('maya', 'push', 'DELIVERED'), a('dad', 'push', 'FAILED'), a('dad', 'sms', 'FAILED')]);
      expect(r.outcome).toBe('PARTIALLY_NOTIFIED');
      expect(r.failed).toEqual(['dad']);
    });

    it('the best standing across a recipient’s attempts wins, in either order', () => {
      expect(rollupIncident([a('x', 'sms', 'FAILED'), a('x', 'push', 'ACKNOWLEDGED')]).acknowledged).toEqual(['x']);
      expect(rollupIncident([a('x', 'push', 'ACKNOWLEDGED'), a('x', 'sms', 'FAILED')]).acknowledged).toEqual(['x']);
    });
  });

  describe('honesty about what "reached" means', () => {
    it('an SMS whose receipt never came (UNKNOWN) is reached-but-unconfirmed, not failed', () => {
      const r = rollupIncident([a('mum', 'sms', 'UNKNOWN')]);
      expect(r.outcome).toBe('NOTIFIED');
      expect(r.reached).toEqual(['mum']);
    });

    it('a push stuck at SENT is still pending — a device receipt can yet come', () => {
      expect(rollupIncident([a('maya', 'push', 'SENT')]).outcome).toBe('NOTIFYING');
    });

    it('a voice call at SENT has gone as far as it can, so it is settled', () => {
      expect(rollupIncident([a('maya', 'voice', 'SENT')]).outcome).toBe('NOTIFIED');
    });
  });
});
