import { describe, expect, it } from 'vitest';
import { PRACTICE_NOT_TRIED, SIMULATED_FAILURE, simulatePractice } from './practice';
import { rollupIncident } from './rollup';

import type { Channel } from './types';
const P: Channel[] = ['push'];
const yes = (id: string, channels: Channel[] = P) => ({ id, eligible: true, channels });
const no = (id: string, skipReason?: string, channels: Channel[] = P) => ({ id, eligible: false, channels, ...(skipReason ? { skipReason } : {}) });

describe('simulatePractice', () => {
  it('is deterministic: the same input gives the same ledger', () => {
    const a = simulatePractice([yes('a', ['push', 'sms']), yes('b', ['push', 'sms'])]);
    expect(simulatePractice([yes('a', ['push', 'sms']), yes('b', ['push', 'sms'])])).toEqual(a);
  });

  it('marks every row simulated, so no row can be read as a real one', () => {
    const rows = simulatePractice([yes('a', ['push', 'sms']), no('b', undefined, ['push', 'sms']), yes('c', ['push', 'sms'])]);
    expect(rows.length).toBe(6);
    for (const r of rows) expect(r.simulated).toBe(true);
  });

  it('shows push as delivered (a device receipt) and sms as only sent (nothing can confirm it)', () => {
    const rows = simulatePractice([yes('a', ['push', 'sms'])]);
    expect(rows[0]).toMatchObject({ channel: 'push', state: 'DELIVERED', deliveredAfterS: 3 });
    expect(rows[1]).toMatchObject({ channel: 'sms', state: 'FAILED', reason: SIMULATED_FAILURE }); // last of two attempts
    expect(simulatePractice([yes('a', ['sms'])])[0]).toMatchObject({ state: 'SENT', deliveredAfterS: null });
  });

  it('includes exactly one simulated failure when two or more attempts are made, and it is the last', () => {
    const rows = simulatePractice([yes('a'), yes('b'), yes('c')]);
    expect(rows.map(r => r.state)).toEqual(['DELIVERED', 'DELIVERED', 'FAILED']);
    expect(rows[2].reason).toBe(SIMULATED_FAILURE);
    expect(rows[2]).toMatchObject({ failedAfterS: 20, sentAfterS: 2 });
  });

  it('adds no failure when only one attempt is made (it would be an invented failure of the only path)', () => {
    const rows = simulatePractice([yes('a')]);
    expect(rows.map(r => r.state)).toEqual(['DELIVERED']);
  });

  it('shows a contact who may not be alerted as not tried, with the reason, and counts nothing for them', () => {
    const rows = simulatePractice([no('a', 'CONSENT_AWAITING'), no('b'), yes('c'), yes('d')]);
    expect(rows[0]).toMatchObject({ state: 'FAILED', reason: 'CONSENT_AWAITING', failedAfterS: 0 });
    expect(rows[1]).toMatchObject({ state: 'FAILED', reason: PRACTICE_NOT_TRIED });
    // the two real-looking attempts (c, d): the failure lands on the last, not on the not-tried rows
    expect(rows[2].state).toBe('DELIVERED');
    expect(rows[3]).toMatchObject({ state: 'FAILED', reason: SIMULATED_FAILURE });
  });

  it('gives each recipient their own channels (a step may use sms for one and push for another)', () => {
    const rows = simulatePractice([yes('a', ['sms']), yes('b', ['push'])]);
    expect(rows.map(r => [r.recipientId, r.channel])).toEqual([['a', 'sms'], ['b', 'push']]);
  });

  it('gives nobody to try an all-failed ledger, never an empty success', () => {
    const rows = simulatePractice([no('a')]);
    expect(rollupIncident(rows).outcome).toBe('ALL_CHANNELS_FAILED');
    expect(simulatePractice([])).toEqual([]);
  });

  it('rolls up like a real ledger: one reached and one failed is partially notified', () => {
    expect(rollupIncident(simulatePractice([yes('a'), yes('b')])).outcome).toBe('PARTIALLY_NOTIFIED');
    expect(rollupIncident(simulatePractice([yes('a')])).outcome).toBe('NOTIFIED');
  });
});
