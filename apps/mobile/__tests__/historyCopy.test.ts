import type { IncidentSummary, IncidentTimeline, TimelineEntry } from '@lumo/types';
import { entryText, lateText, outcomeText, PRACTICE_NOTE, rowLabel, rowParts, timelineShareText, triggerLabel } from '../services/historyCopy';

const s = (o: Partial<IncidentSummary> = {}): IncidentSummary => ({
  id: 'i1', mode: 'real', state: 'CLOSED', outcome: 'CLOSED', triggerType: 'manual', triggeredAt: '2026-01-01T10:00:00Z', createdAt: '2026-01-01T10:00:00Z',
  lateBySeconds: 0, locationAvailable: false, contactsTried: 3, contactsReached: 2, contactsFailed: 1, resolvedAt: null, closedAt: null, ...o,
});
const e = (o: Partial<TimelineEntry> = {}): TimelineEntry => ({ at: '2026-01-01T10:00:05Z', kind: 'attempt', event: 'ATTEMPT_SENT', from: null, to: 'SENT', actor: null, reason: null, recipient: 'Maya', channel: 'sms', purpose: 'ALERT', simulated: false, ...o });

describe('how it went, in the ledger\'s own words', () => {
  it('says "sent to 2 of 3 · couldn\'t reach 1", never "notified"', () => {
    expect(outcomeText(s())).toBe("Sent to 2 of 3 · couldn't reach 1");
    expect(outcomeText(s({ contactsFailed: 0, contactsReached: 3 }))).toBe('Sent to 3 of 3');
  });
  it('says who responded only when someone did', () => expect(outcomeText(s({ outcome: 'ACKNOWLEDGED' }))).toBe('A contact said they were responding'));
  it('says no contact could be alerted rather than a success', () => expect(outcomeText(s({ contactsTried: 0, contactsReached: 0, contactsFailed: 0 }))).toBe('No contact could be alerted'));
  it('says a cancelled press was cancelled before it was sent, and a live countdown is counting down', () => {
    expect(outcomeText(s({ state: 'CANCELLED', contactsTried: 0 }))).toBe('Cancelled before it was sent');
    expect(outcomeText(s({ state: 'CREATED' }))).toBe('Counting down');
  });
  it('never claims anyone was notified or helped', () => {
    for (const x of [s(), s({ outcome: 'ACKNOWLEDGED' }), s({ contactsTried: 0 }), s({ state: 'CANCELLED' })]) expect(rowLabel(x).toLowerCase()).not.toMatch(/notified|help is|on its way|safe/);
  });
});

describe('a late alert', () => {
  it('says how late, and why, from two minutes', () => {
    expect(lateText(s({ lateBySeconds: 119 }))).toBeNull();
    expect(lateText(s({ lateBySeconds: 600 }))).toBe('Sent about 10 minutes after you pressed it: there was no signal.');
    expect(lateText(s({ lateBySeconds: 3 * 3600 }))).toContain('about 3 hours');
  });
});

describe('a rehearsal is marked wherever it appears', () => {
  it('its row says practice and that nobody was contacted', () => {
    const p = rowParts(s({ mode: 'practice' }));
    expect(p.title).toBe('Practice run');
    expect(p.details).toContain(PRACTICE_NOTE);
    expect(rowLabel(s({ mode: 'practice' }))).toContain('nobody was contacted');
  });
  it('its entries are marked, and so is a shared file', () => {
    expect(entryText(e({ simulated: true }))).toContain('(practice)');
    const t: IncidentTimeline = { incident: s({ mode: 'practice' }), entries: [e({ simulated: true })] };
    expect(timelineShareText(t)).toContain(PRACTICE_NOTE);
    expect(timelineShareText(t)).toContain('(practice)');
  });
  it('a real one is not marked', () => {
    expect(entryText(e())).not.toContain('practice');
    expect(timelineShareText({ incident: s(), entries: [e()] })).not.toContain('Practice');
  });
});

describe('an entry, in words', () => {
  it('names the contact, the channel and exactly what the ledger recorded', () => {
    expect(entryText(e())).toBe('Text to Maya: sent, not confirmed');
    expect(entryText(e({ to: 'DELIVERED', channel: 'push' }))).toBe('App alert to Maya: delivered');
    expect(entryText(e({ to: 'FAILED', reason: 'NO_ADDRESS' }))).toContain('could not reach');
    expect(entryText(e({ to: 'FAILED', reason: 'NO_ADDRESS' }))).toContain('no app or number');
  });
  it('says who caused an incident step', () => {
    expect(entryText(e({ kind: 'incident', event: 'CREATED', to: 'CREATED', actor: 'user' }))).toBe('Alert started (you)');
    expect(entryText(e({ kind: 'incident', event: 'ACK_RECEIVED', to: 'ACKNOWLEDGED', actor: 'contact' }))).toBe('A contact said they were responding (a contact)');
  });
  it('keeps the "it ended" messages apart from the alert', () => expect(entryText(e({ purpose: 'RESOLVED' }))).toContain('It-ended message'));
  it('copes with a removed contact and an unknown state', () => {
    expect(entryText(e({ recipient: null }))).toContain('to a contact');
    expect(entryText(e({ kind: 'incident', to: 'SOMETHING_NEW', event: 'SOMETHING_NEW' }))).toContain('SOMETHING_NEW');
  });
});

describe('what is shared', () => {
  it('is names, times and words, and nothing that is not in the export', () => {
    const text = timelineShareText({ incident: s({ lateBySeconds: 600 }), entries: [e(), e({ at: '2026-01-01T10:00:09Z', to: 'DELIVERED' })] });
    expect(text.split('\n')[0]).toContain('Lumo alert');
    expect(text).toContain('Sent about 10 minutes after');
    expect(text).toContain('Text to Maya');
    expect(text).not.toMatch(/\+\d{6,}|maps\.google|latitude/i);
  });
});

describe('the trigger', () => {
  it('is in plain words, and unknown ones are still an alert', () => {
    expect(triggerLabel('manual')).toBe('You pressed SOS');
    expect(triggerLabel('missed_check_in')).toBe('A journey check-in went unanswered');
    expect(triggerLabel('anything_new')).toBe('An alert');
  });
});
