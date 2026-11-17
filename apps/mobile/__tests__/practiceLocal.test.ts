import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UserSettings } from '@lumo/types';
import { localPracticeIncident } from '../services/practiceLocal';
import { attemptLine } from '../services/sosLedger';

const contact = (id: string, name: string, consentStatus: any) => ({ id, name, phone: '+1', consentStatus });
const settings = (contacts: any[], sms = false): UserSettings => ({ trustedContacts: contacts, security: { sendSmsOnSos: sms } } as any);
const NOW = Date.parse('2026-01-01T10:00:00Z');

describe('practice on the phone (no server)', () => {
  it('shows each agreed contact as the server would, with one example failure, all marked simulated', () => {
    const i = localPracticeIncident(settings([contact('a', 'Maya', 'agreed'), contact('b', 'Dad', 'agreed')]), NOW);
    expect(i.mode).toBe('practice');
    expect(i.attempts.map(a => [a.recipientName, a.state, a.reason])).toEqual([['Maya', 'DELIVERED', null], ['Dad', 'FAILED', 'SIMULATED_FAILURE']]);
    for (const a of i.attempts) expect(a.simulated).toBe(true);
    expect(i.state).toBe('PARTIALLY_NOTIFIED');
    expect(i.reached).toEqual(['a']);
    expect(i.failed).toEqual(['b']);
  });

  it('shows a contact who has not agreed as not tried, with the real reason, and nobody to try as a failure, not a success', () => {
    const i = localPracticeIncident(settings([contact('a', 'Maya', 'waiting'), contact('b', 'Dad', 'withdrawn')]), NOW);
    expect(i.attempts.map(a => a.reason)).toEqual(['CONSENT_AWAITING', 'CONSENT_WITHDRAWN']);
    expect(i.state).toBe('ALL_CHANNELS_FAILED');
  });

  it('uses the channels the person has turned on', () => {
    const i = localPracticeIncident(settings([contact('a', 'Maya', 'agreed')], true), NOW);
    expect(i.attempts.map(a => a.channel)).toEqual(['push', 'sms']);
  });

  it('with no settings or no contacts is an empty failure, never an empty success', () => {
    for (const s of [undefined, settings([])]) {
      const i = localPracticeIncident(s, NOW);
      expect(i.attempts).toEqual([]);
      expect(i.state).toBe('ALL_CHANNELS_FAILED');
    }
  });

  it('a contact with no recorded consent is treated as not invited', () => {
    expect(localPracticeIncident(settings([contact('a', 'X', undefined)]), NOW).attempts[0].reason).toBe('CONSENT_NOT_INVITED');
  });

  it('times are offsets from the start, so a rerun reads the same', () => {
    const a = localPracticeIncident(settings([contact('a', 'Maya', 'agreed')]), NOW).attempts[0];
    expect(a.deliveredAt).toBe(new Date(NOW + 3000).toISOString());
  });

  it('cannot send: the module touches no network and no api service', () => {
    const src = readFileSync(join(__dirname, '../services/practiceLocal.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/apiService|fetch\(|XMLHttpRequest|axios/);
  });
});

describe('a practice row is marked', () => {
  it('says practice on a simulated row and explains the example failure', () => {
    const i = localPracticeIncident(settings([contact('a', 'Maya', 'agreed'), contact('b', 'Dad', 'agreed')]), NOW);
    const lines = i.attempts.map(attemptLine);
    for (const l of lines) expect(l).toMatch(/\(practice\)$/);
    expect(lines[1]).toContain('example failure');
  });
  it('leaves a real row as it was', () => {
    const real = { ...localPracticeIncident(settings([contact('a', 'Maya', 'agreed')]), NOW).attempts[0], simulated: undefined };
    expect(attemptLine(real as any)).not.toContain('(practice)');
  });
});
