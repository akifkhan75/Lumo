import type { JourneyLinkInfo } from '@lumo/types';
import { indicatorTitle, linkLine, liveLinks, shareMessage, shareUrl, webBaseUrl, whatTheyWillSee } from '../services/journeyLinks';

const link = (over: Partial<JourneyLinkInfo> = {}): JourneyLinkInfo => ({
  id: 'l1', createdAt: '2026-01-01T10:00:00Z', expiresAt: '2026-01-01T14:00:00Z', revokedAt: null, hasPin: false, viewCount: 0, lastViewedAt: null, live: true, ...over,
});
const PATH = '/j/' + 'a'.repeat(43);

describe('the web address', () => {
  it('accepts https, strips trailing slashes, refuses everything else', () => {
    expect(webBaseUrl('https://lumo.example/')).toBe('https://lumo.example');
    expect(webBaseUrl('http://lumo.example')).toBeNull();
    expect(webBaseUrl('ftp://x')).toBeNull();
    expect(webBaseUrl('')).toBeNull();
    expect(webBaseUrl(undefined)).toBeNull();
    expect(webBaseUrl('https://')).toBeNull();
  });
  it('allows plain http only for a development build', () => {
    expect(webBaseUrl('http://192.168.1.5:3006', true)).toBe('http://192.168.1.5:3006');
  });
});

describe('the link', () => {
  it('joins the web address and the path the API returned', () => {
    expect(shareUrl('https://lumo.example', PATH)).toBe(`https://lumo.example${PATH}`);
  });
  it('refuses to build a link with no web address or a path that is not a journey token', () => {
    expect(shareUrl(null, PATH)).toBeNull();
    expect(shareUrl('https://lumo.example', '/j/short')).toBeNull();
    expect(shareUrl('https://lumo.example', '/api/v1/anything')).toBeNull();
    expect(shareUrl('https://lumo.example', `${PATH}/../x`)).toBeNull();
  });
  it('says the PIN comes separately and never contains it', () => {
    const m = shareMessage('https://lumo.example/j/x', null, true);
    expect(m).toContain('https://lumo.example/j/x');
    expect(m).toContain('give it to you separately');
    expect(shareMessage('https://u', null, false)).not.toContain('PIN');
  });
});

describe('the indicator', () => {
  it('counts only links that work', () => {
    expect(liveLinks([link(), link({ id: 'l2', live: false }), link({ id: 'l3', revokedAt: '2026-01-01T11:00:00Z', live: false })]).map(l => l.id)).toEqual(['l1']);
    expect(liveLinks(null)).toEqual([]);
  });
  it('is empty when nothing is live and says "anyone with" when something is', () => {
    expect(indicatorTitle([])).toBe('');
    expect(indicatorTitle([link()])).toBe('Anyone with 1 link can see this journey right now');
    expect(indicatorTitle([link(), link({ id: 'l2' })])).toBe('Anyone with these 2 links can see this journey right now');
  });
  it('reports only what the server counted and never claims it was sent or who opened it', () => {
    expect(linkLine(link())).toContain('Not opened yet');
    expect(linkLine(link({ viewCount: 1, lastViewedAt: '2026-01-01T10:30:00Z' }))).toContain('Opened once');
    expect(linkLine(link({ viewCount: 4, hasPin: true }))).toMatch(/Opened 4 times.*PIN/);
    for (const l of [link(), link({ viewCount: 3 })]) expect(linkLine(l).toLowerCase()).not.toMatch(/\bsent\b|delivered|seen by|viewed by/);
  });
  it('says what is handed over, and that no position is when none is saved', () => {
    expect(whatTheyWillSee(true)).toContain('last saved position with how old it is');
    expect(whatTheyWillSee(false)).toContain('no position');
  });
});
