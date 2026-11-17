import type { Incident, IncidentAttempt } from '@lumo/types';
import { attemptLine, contactRows, headline, reasonText, REASON_TEXT } from '../services/sosLedger';
import { countdownFor, secondsLeft } from '../services/sosCountdown';

const T = '2026-11-18T09:41:00.000Z';
const att = (over: Partial<IncidentAttempt> = {}): IncidentAttempt => ({
  id: 'a', recipientId: 'c1', recipientName: 'Maya', channel: 'sms', purpose: 'ALERT', state: 'SENT', reason: null,
  queuedAt: T, sentAt: T, deliveredAt: null, acknowledgedAt: null, failedAt: null, ...over,
});
const inc = (state: Incident['state'], attempts: IncidentAttempt[]): Incident => ({
  id: 'i', state, triggerType: 'manual', countdownEndsAt: null, locationAvailable: false, outcome: state,
  reached: [], acknowledged: [], failed: [], pending: [], capped: [], attempts,
});

describe('attemptLine says the most that is true, and no more', () => {
  it.each([
    [{ state: 'QUEUED' }, 'Text: waiting to send'],
    [{ state: 'FAILED', reason: 'NO_ADDRESS' }, 'could not reach — Lumo has no app or number to reach them on'],
    [{ state: 'EXPIRED' }, 'Text: not sent in time'],
  ] as const)('%j', (over, text) => expect(attemptLine(att(over as any))).toContain(text));

  it('a sent text is "not confirmed", never delivered', () => {
    const line = attemptLine(att({ state: 'SENT' }));
    expect(line).toMatch(/sent .* — not confirmed/);
    expect(line.toLowerCase()).not.toContain('delivered');
  });
  it('a push nobody confirmed is "we couldn\'t confirm it arrived", never delivered', () => {
    const line = attemptLine(att({ channel: 'push', state: 'UNKNOWN' }));
    expect(line).toContain("couldn't confirm it arrived");
    expect(line.toLowerCase()).not.toContain('delivered');
  });
  it('only a delivery receipt says delivered, with its time', () => {
    expect(attemptLine(att({ state: 'DELIVERED', deliveredAt: T }))).toMatch(/delivered \d/);
  });
  it('only a person says responding', () => {
    expect(attemptLine(att({ channel: 'push', state: 'ACKNOWLEDGED', acknowledgedAt: T }))).toContain('they are responding');
  });
  it('every state of every channel produces a line with no "notified"', () => {
    for (const channel of ['sms', 'push', 'voice'] as const)
      for (const state of ['QUEUED', 'SENT', 'DELIVERED', 'ACKNOWLEDGED', 'FAILED', 'EXPIRED', 'UNKNOWN'] as const)
        expect(attemptLine(att({ channel, state })).toLowerCase()).not.toMatch(/notified|has been alerted|help is/);
  });
});

describe('reasonText', () => {
  it('has words for every reason the server uses, and a safe fallback', () => {
    for (const k of Object.keys(REASON_TEXT)) expect(reasonText(k).length).toBeGreaterThan(5);
    expect(reasonText(null)).toBe('it did not go through');
    expect(reasonText('VOICE_BUSY')).toBe('the call was not answered');
    expect(reasonText('TWILIO_21211')).toBe('the provider reported a problem');
  });
  it('the cap is explained as a limit, not an error', () => expect(reasonText('SPEND_CAP')).toContain('limit'));
});

describe('contactRows and headline', () => {
  it('one row per contact; the "it ended" messages are not part of the alert', () => {
    const i = inc('NOTIFIED', [att(), att({ id: 'b', purpose: 'RESOLVED' })]);
    expect(contactRows(i)).toHaveLength(1);
    expect(contactRows(i)[0].lines).toHaveLength(1);
  });
  it('names a contact when the server gave a name, "Contact N" when it did not (emergency token)', () => {
    expect(contactRows(inc('NOTIFIED', [att()]))[0].name).toBe('Maya');
    expect(contactRows(inc('NOTIFIED', [att({ recipientName: undefined })]))[0].name).toBe('Contact 1');
  });
  it('NOTIFIED says "sent … no response yet", never "notified"', () => {
    const h = headline(inc('NOTIFIED', [att()]));
    expect(h).toBe('Sent to 1 · no response yet');
    expect(h.toLowerCase()).not.toContain('notified');
  });
  it('PARTIALLY_NOTIFIED names who was missed', () => {
    const i = inc('PARTIALLY_NOTIFIED', [att(), att({ id: 'b', recipientId: 'c2', recipientName: 'Dad', state: 'FAILED', reason: 'NO_ADDRESS' })]);
    expect(headline(i)).toBe("Sent to 1 of 2 · couldn't reach Dad");
  });
  it('a failure is as prominent as a success: it is a row of its own', () => {
    const rows = contactRows(inc('PARTIALLY_NOTIFIED', [att(), att({ id: 'b', recipientId: 'c2', recipientName: 'Dad', state: 'FAILED', reason: 'SPEND_CAP' })]));
    expect(rows.map((r) => r.standing)).toEqual(['reached', 'failed']);
    expect(rows[1].lines[0]).toContain('limit');
  });
  it('acknowledged names who is responding; all-failed says nobody was reached', () => {
    expect(headline(inc('ACKNOWLEDGED', [att({ channel: 'push', state: 'ACKNOWLEDGED', acknowledgedAt: T })]))).toBe('Maya is responding');
    expect(headline(inc('ALL_CHANNELS_FAILED', []))).toBe("Couldn't reach anyone");
  });
  it('a sent text counts as reached for the contact, but the line still says not confirmed', () => {
    const row = contactRows(inc('NOTIFYING', [att({ state: 'SENT' })]))[0];
    expect(row.standing).toBe('reached');
    expect(row.lines[0]).toContain('not confirmed');
  });
});

describe('countdown', () => {
  it('manual is 3 s and every automatic trigger is 10 s, mirroring the server', () => {
    expect(countdownFor('manual')).toBe(3);
    for (const t of ['shake', 'voice', 'crash'] as const) expect(countdownFor(t)).toBe(10);
  });
  it('secondsLeft rounds up, never goes negative, and is null with no deadline', () => {
    expect(secondsLeft(10_000, 7_001)).toBe(3);
    expect(secondsLeft(10_000, 10_000)).toBe(0);
    expect(secondsLeft(10_000, 99_000)).toBe(0);
    expect(secondsLeft(null, 1)).toBeNull();
  });
});
