import { agreedForCache, MAX_CACHED_CONTACTS, offlineTextBody, textStatusLine, type TextStatus } from '../services/offlineText';

const NOW = Date.parse('2026-01-01T12:00:00Z');
const fix = (over: Partial<{ latitude: number; longitude: number; accuracyM: number | null; capturedAt: number }> = {}) => ({ latitude: 33.6844, longitude: 73.0479, accuracyM: 12, capturedAt: NOW - 2 * 60_000, ...over });

describe('who the text may be addressed to', () => {
  it('keeps ONLY contacts who agreed, with a number, as id, name and number and nothing else', () => {
    const out = agreedForCache([
      { id: 'a', name: 'Maya', phone: ' +923001234500 ', consentStatus: 'agreed', extra: 'x' } as any,
      { id: 'b', name: 'Dad', phone: '+2', consentStatus: 'waiting' },
      { id: 'c', name: 'Sam', phone: '+3', consentStatus: 'withdrawn' },
      { id: 'd', name: 'Lee', phone: '+4', consentStatus: 'expired' },
      { id: 'e', name: 'Kim', phone: '+5', consentStatus: 'not_invited' },
      { id: 'f', name: 'Ann', phone: '+6', consentStatus: 'details_changed' },
      { id: 'g', name: 'No consent field', phone: '+7' },
      { id: 'h', name: 'No number', phone: '', consentStatus: 'agreed' },
      { id: 'i', name: 'Null number', phone: null, consentStatus: 'agreed' },
    ]);
    expect(out).toEqual([{ id: 'a', name: 'Maya', phone: '+923001234500' }]);
    expect(Object.keys(out[0]).sort()).toEqual(['id', 'name', 'phone']);
  });
  it('copes with nothing', () => {
    expect(agreedForCache(null)).toEqual([]);
    expect(agreedForCache(undefined)).toEqual([]);
  });
  it('caps how many are kept, so the encrypted value stays small', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `${i}`, name: `C${i}`, phone: `+${i}`, consentStatus: 'agreed' as const }));
    expect(agreedForCache(many)).toHaveLength(MAX_CACHED_CONTACTS);
  });
});

describe('what the text says', () => {
  it('is in the first person (the person is the sender), says Lumo could not alert them, and says where, when and how precisely', () => {
    const t = offlineTextBody(fix(), NOW);
    expect(t).toContain('I pressed SOS in the Lumo app');
    expect(t).toContain('Lumo could not alert you automatically');
    expect(t).toContain('about 2 min ago, within 12 m');
    expect(t).toContain('https://maps.google.com/?q=33.6844,73.0479');
    expect(t).not.toContain('I may have moved');
  });
  it('says an old position is last known and that they may have moved', () => {
    const t = offlineTextBody(fix({ capturedAt: NOW - 30 * 60_000 }), NOW);
    expect(t).toContain('My last known location (about 30 min ago');
    expect(t).toContain('I may have moved');
  });
  it('leaves out the precision when it is not known, and never invents one', () => {
    const t = offlineTextBody(fix({ accuracyM: null }), NOW);
    expect(t).not.toContain('within');
    expect(t).toContain('about 2 min ago)');
  });
  it('says plainly there is no location rather than guess', () => {
    const t = offlineTextBody(null, NOW);
    expect(t).toContain('I do not have a location');
    expect(t).not.toContain('maps.google.com');
    expect(offlineTextBody(undefined, NOW)).toBe(t);
  });
  it('never claims anyone has been alerted or that help is coming', () => {
    for (const t of [offlineTextBody(fix(), NOW), offlineTextBody(null, NOW)]) {
      expect(t.toLowerCase()).not.toMatch(/help is|on its way|has been alerted|notified|delivered/);
    }
  });
  it('a clock that disagrees never produces a negative age', () => {
    expect(offlineTextBody(fix({ capturedAt: NOW + 10 * 60_000 }), NOW)).toContain('about 0 min ago');
  });
});

describe('what the screen says after the composer closes', () => {
  const all: TextStatus[] = ['unavailable', 'no_contacts', 'sent', 'cancelled', 'unknown', 'error'];
  it('"sent" is only what the messages app said, and delivery is disclaimed', () => {
    const l = textStatusLine('sent', ['Maya', 'Dad']);
    expect(l).toContain('Your messages app says you sent the text to Maya, Dad');
    expect(l).toContain("can't tell whether it arrived");
  });
  it('cancelled says nothing was sent', () => expect(textStatusLine('cancelled', ['Maya'])).toContain('Nothing has been sent'));
  it('unknown does not guess either way', () => expect(textStatusLine('unknown', [])).toContain("can't tell whether you sent"));
  it('every outcome without a send points the person to doing it themselves', () => {
    for (const s of ['unavailable', 'no_contacts', 'error'] as const) expect(textStatusLine(s, [])).toMatch(/Call or message/);
  });
  it('no outcome says delivered, received, or alerted', () => {
    for (const s of all) expect(textStatusLine(s, ['Maya']).toLowerCase()).not.toMatch(/\bdelivered\b|has received|has been alerted|notified/);
  });
});
