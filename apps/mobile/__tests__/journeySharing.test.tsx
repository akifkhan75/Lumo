import React from 'react';
import { Share } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { ApiError } from '@lumo/api-client';
import type { Journey, JourneyLinkInfo } from '@lumo/types';
import JourneyScreen from '../components/JourneyScreen';
import SharingStrip from '../components/SharingStrip';
import * as apiService from '../services/apiService';

jest.mock('../services/apiService');
const api = apiService as jest.Mocked<typeof apiService>;

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ params: undefined }),
}));

const iso = (ms: number) => new Date(ms).toISOString();
const journey = (over: Partial<Journey> = {}): Journey => ({
  id: 'j1', kind: 'walk_home', state: 'ACTIVE', expectedArrivalAt: iso(Date.now() + 600_000), checkInDueAt: iso(Date.now() + 600_000), destination: null, shareLocation: true,
  plan: { graceSeconds: 180, contacts: ['Maya'] }, needsAnswer: false, incidentId: null, startedAt: iso(Date.now()), endedAt: null, ...over,
});
const link = (over: Partial<JourneyLinkInfo> = {}): JourneyLinkInfo => ({
  id: 'l1', createdAt: iso(Date.now()), expiresAt: iso(Date.now() + 3 * 3600_000), revokedAt: null, hasPin: false, viewCount: 0, lastViewedAt: null, live: true, ...over,
});
const PATH = '/j/' + 'b'.repeat(43);
const settings: any = { personalInfo: {}, security: {}, trustedContacts: [{ id: 'c1', name: 'Maya', phone: '+1', consentStatus: 'agreed' }] };

let tree: renderer.ReactTestRenderer;
const text = () => JSON.stringify(tree.toJSON());
const control = (label: RegExp | string) => tree.root.findAll(n => typeof n.props.onPress === 'function' && (typeof label === 'string' ? n.props.accessibilityLabel === label : label.test(String(n.props.accessibilityLabel))))[0];
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }); };
const open = async (links: JourneyLinkInfo[]) => {
  api.getActiveJourney.mockResolvedValue(journey() as never);
  api.listJourneyLinks.mockResolvedValue(links as never);
  await act(async () => { tree = renderer.create(<JourneyScreen />); });
  await flush();
};

const OLD_ENV = process.env.EXPO_PUBLIC_WEB_URL;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_WEB_URL = 'https://lumo.example';
  api.getSettings.mockResolvedValue(settings as never);
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
});
afterEach(() => { act(() => tree?.unmount()); jest.useRealTimers(); process.env.EXPO_PUBLIC_WEB_URL = OLD_ENV; });

describe('the sharing indicator', () => {
  it('shows nothing while no link works', async () => {
    await open([link({ live: false, revokedAt: iso(Date.now()) })]);
    expect(text()).not.toContain('can see this journey right now');
  });

  it('shows, in words and with a way to stop it, for as long as a link is live', async () => {
    await open([link({ viewCount: 2 })]);
    expect(text()).toContain('Anyone with 1 link can see this journey right now');
    expect(text()).toContain('Opened 2 times');
    expect(control('Stop sharing. Turn off every link to this journey')).toBeDefined();
  });

  it('reads the list from the server, not from what the screen remembers (a link made elsewhere still shows)', async () => {
    await open([link({ id: 'elsewhere' })]);
    expect(api.listJourneyLinks).toHaveBeenCalledWith('j1');
    expect(text()).toContain('Anyone with 1 link');
  });

  it('keeps showing a link, marked old, when the list cannot be refreshed', async () => {
    await open([link()]);
    api.listJourneyLinks.mockRejectedValue(new ApiError('x', 'network'));
    await act(async () => { jest.advanceTimersByTime(10_000); });
    await flush();
    expect(text()).toContain('Anyone with 1 link');
    expect(text()).toContain("Can't refresh this right now");
  });
});

describe('stopping', () => {
  it('"Stop sharing" revokes every live link, then re-reads, and the indicator goes only when the server says so', async () => {
    await open([link({ id: 'a' }), link({ id: 'b' })]);
    api.revokeJourneyLink.mockResolvedValue(undefined as never);
    api.listJourneyLinks.mockResolvedValue([link({ id: 'a', live: false }), link({ id: 'b', live: false })] as never);
    await act(async () => { control('Stop sharing. Turn off every link to this journey').props.onPress(); });
    await flush();
    expect(api.revokeJourneyLink.mock.calls).toEqual([['j1', 'a'], ['j1', 'b']]);
    expect(text()).not.toContain('can see this journey right now');
  });

  it('one link can be turned off on its own', async () => {
    await open([link({ id: 'a' }), link({ id: 'b' })]);
    api.revokeJourneyLink.mockResolvedValue(undefined as never);
    await act(async () => { control('Turn off link 2 of 2').props.onPress(); });
    await flush();
    expect(api.revokeJourneyLink).toHaveBeenCalledTimes(1);
    expect(api.revokeJourneyLink).toHaveBeenCalledWith('j1', 'b');
  });

  it('a failed revoke says the link may still work, and the indicator stays', async () => {
    await open([link()]);
    api.revokeJourneyLink.mockRejectedValue(new ApiError('x', 'network'));
    await act(async () => { control('Stop sharing. Turn off every link to this journey').props.onPress(); });
    await flush();
    expect(text()).toContain('It may still work');
    expect(text()).toContain('Anyone with 1 link');
  });
});

describe('sharing', () => {
  it('makes a link and hands the full URL to the share sheet, never the PIN, and says Lumo sent nothing', async () => {
    api.createJourneyLink.mockResolvedValue({ id: 'n1', path: PATH, expiresAt: iso(Date.now() + 3600_000), hasPin: false, sentByLumo: false } as never);
    await open([]);
    await act(async () => { control(/^Make a link/).props.onPress(); });
    await flush();
    expect(api.createJourneyLink).toHaveBeenCalledWith('j1', {});
    const message = (Share.share as jest.Mock).mock.calls[0][0].message as string;
    expect(message).toContain(`https://lumo.example${PATH}`);
    expect(text()).toContain('Lumo has not sent it to anyone');
    expect(text().toLowerCase()).not.toMatch(/link (was )?sent|shared with|delivered/);
  });

  it('passes a PIN to the server but keeps it out of the shared text', async () => {
    api.createJourneyLink.mockResolvedValue({ id: 'n1', path: PATH, expiresAt: iso(Date.now() + 3600_000), hasPin: true, sentByLumo: false } as never);
    await open([]);
    const input = tree.root.findAll(n => n.props.keyboardType === 'number-pad')[0];
    await act(async () => { input.props.onChangeText('4821'); });
    await act(async () => { control(/^Make a link/).props.onPress(); });
    await flush();
    expect(api.createJourneyLink).toHaveBeenCalledWith('j1', { pin: '4821' });
    expect((Share.share as jest.Mock).mock.calls[0][0].message).not.toContain('4821');
  });

  it('refuses a PIN that is not 4 to 8 digits before asking the server', async () => {
    await open([]);
    const input = tree.root.findAll(n => n.props.keyboardType === 'number-pad')[0];
    await act(async () => { input.props.onChangeText('12'); });
    expect(text()).toContain('A PIN is 4 to 8 digits.');
    expect(control(/^Make a link/).props.disabled).toBe(true);
  });

  it('says what the server said when it refuses (too many links) and shares nothing', async () => {
    api.createJourneyLink.mockRejectedValue(new ApiError('This journey already has several links. Revoke one first.', 'http', 409));
    await open([]);
    await act(async () => { control(/^Make a link/).props.onPress(); });
    await flush();
    expect(text()).toContain('already has several links');
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('a share sheet that fails does not hide the link: the indicator shows it exists', async () => {
    (Share.share as jest.Mock).mockRejectedValue(new Error('no sheet'));
    api.createJourneyLink.mockResolvedValue({ id: 'n1', path: PATH, expiresAt: iso(Date.now() + 3600_000), hasPin: false, sentByLumo: false } as never);
    await open([]);
    api.listJourneyLinks.mockResolvedValue([link({ id: 'n1' })] as never);
    await act(async () => { control(/^Make a link/).props.onPress(); });
    await flush();
    expect(text()).toContain('Anyone with 1 link');
  });

  it('with no web address configured, makes no link and says why (a link nobody can open is not sharing)', async () => {
    delete process.env.EXPO_PUBLIC_WEB_URL;
    await open([]);
    expect(control(/^Make a link/)).toBeUndefined();
    expect(text()).toContain('no web address set');
  });

  it('a link that cannot be turned into a URL is turned off again and the person is told', async () => {
    api.createJourneyLink.mockResolvedValue({ id: 'n1', path: '/not-a-journey-path', expiresAt: iso(Date.now() + 3600_000), hasPin: false, sentByLumo: false } as never);
    api.revokeJourneyLink.mockResolvedValue(undefined as never);
    await open([]);
    await act(async () => { control(/^Make a link/).props.onPress(); });
    await flush();
    expect(api.revokeJourneyLink).toHaveBeenCalledWith('j1', 'n1');
    expect(Share.share).not.toHaveBeenCalled();
    expect(text()).toContain('nothing is being shared');
  });

  it('tells the person that no position is shown when they chose not to save one', async () => {
    api.getActiveJourney.mockResolvedValue(journey({ shareLocation: false }) as never);
    api.listJourneyLinks.mockResolvedValue([] as never);
    await act(async () => { tree = renderer.create(<JourneyScreen />); });
    await flush();
    expect(text()).toContain('but no position');
  });
});

describe('the dashboard strip', () => {
  const strip = (count: number, onPress = jest.fn()) => { act(() => { tree = renderer.create(<SharingStrip count={count} onPress={onPress} />); }); return onPress; };
  it('renders nothing when no link works', () => {
    strip(0);
    expect(tree.toJSON()).toBeNull();
  });
  it('says how many links are on, and opens the journey to stop them', () => {
    const onPress = strip(2);
    expect(text()).toContain('2 links to your journey are on');
    act(() => { control(/Open to see who could be looking/).props.onPress(); });
    expect(onPress).toHaveBeenCalled();
  });
});
