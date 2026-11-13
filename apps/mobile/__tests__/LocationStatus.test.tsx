import React from 'react';
import { Linking } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import LocationStatus from '../components/LocationStatus';
import type { UseLocation } from '../hooks/useLocation';

const T = 1_700_000_000_000;
const base: UseLocation = { permission: 'granted', fix: null, geocoded: null, watchFailed: false, request: jest.fn(async () => {}) };
const mounted: renderer.ReactTestRenderer[] = [];
afterEach(() => { mounted.splice(0).forEach((t) => act(() => t.unmount())); });
const show = (over: Partial<UseLocation>, now = T) => {
  let t!: renderer.ReactTestRenderer;
  act(() => { t = renderer.create(<LocationStatus location={{ ...base, ...over }} now={() => now} />); });
  mounted.push(t);
  const dump = () => JSON.stringify(t.toJSON());
  const button = (label: string) => t.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  return { dump, button, t };
};
const fix = { latitude: 31.5, longitude: 74.3, accuracyM: 18, capturedAt: T };

describe('LocationStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  it('before permission is asked: says location is off and nothing is shared, offers to ask', async () => {
    const { dump, button } = show({ permission: 'undetermined' });
    expect(dump()).toContain('shares it with no one');
    await act(async () => { button('Allow Lumo to read your location while the app is open').props.onPress(); });
    expect(base.request).toHaveBeenCalledTimes(1);
  });

  it('denied: says nothing is being read, offers to ask again', () => {
    const { dump, button } = show({ permission: 'denied' });
    expect(dump()).toContain('Nothing is being read');
    expect(button('Ask again to read your location while the app is open')).toBeDefined();
  });

  it('blocked: routes to system settings, because asking again does nothing', () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const { button } = show({ permission: 'blocked' });
    act(() => { button('Open this app’s settings to turn on location').props.onPress(); });
    expect(open).toHaveBeenCalled();
  });

  it('granted without a fix: says it is looking, not that it has a position', () => {
    const { dump } = show({});
    expect(dump()).toContain('Looking for your position');
    expect(dump()).not.toContain('Location ');
  });

  it('a fresh fix shows age and accuracy', () => {
    const { dump } = show({ fix }, T + 120_000);
    expect(dump()).toMatch(/2 minutes ago/);
    expect(dump()).toMatch(/±18 m/);
    expect(dump()).not.toContain('Last known');
  });

  it('a stale fix is "last known" and says it is not where you are now', () => {
    const { dump } = show({ fix }, T + 10 * 60_000);
    expect(dump()).toContain('Last known location');
    expect(dump()).toContain('This is not where you are now.');
  });

  it('never prints coordinates, and never implies sharing', () => {
    const { dump } = show({ fix });
    expect(dump()).not.toMatch(/31\.5|74\.3/);
    expect(dump().toLowerCase()).not.toMatch(/sharing|shared with|sent/);
  });

  it('says so when the country could not be determined, and shows it when it could', () => {
    expect(show({ fix, geocoded: { for: fix, requestedAt: T, ok: false, place: { country: null, subdivision: null } } }).dump()).toContain(
      "Couldn't tell which country you are in.",
    );
    expect(show({ fix, geocoded: { for: fix, requestedAt: T, ok: true, place: { country: 'PK', subdivision: 'PB' } } }).dump()).toContain('Country: PK');
  });

  it('does not show a country from a geocode of somewhere else', () => {
    const far = { for: { latitude: 40, longitude: -74, capturedAt: T }, requestedAt: T, ok: true, place: { country: 'US', subdivision: 'NY' } } as any;
    expect(show({ fix, geocoded: far }).dump()).not.toContain('Country:');
  });
});
