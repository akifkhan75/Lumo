import React from 'react';
import renderer, { act } from 'react-test-renderer';
import * as Location from 'expo-location';
import { useLocation, type UseLocation } from '../hooks/useLocation';

const loc = Location as jest.Mocked<typeof Location>;
const T = 1_700_000_000_000;
const reading = (accuracy: number | null, over: any = {}) => ({ coords: { latitude: 31.5, longitude: 74.3, accuracy, ...over }, timestamp: T });

let current: UseLocation;
const Probe = ({ active }: { active: boolean }) => {
  current = useLocation(active, () => T);
  return null;
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('useLocation', () => {
  let onFix: (l: any) => void;
  let remove: jest.Mock;
  beforeEach(() => {
    jest.clearAllMocks();
    remove = jest.fn();
    (loc.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
    (loc.watchPositionAsync as jest.Mock).mockImplementation(async (_o: any, cb: any) => { onFix = cb; return { remove }; });
    (loc.reverseGeocodeAsync as jest.Mock).mockResolvedValue([{ isoCountryCode: 'PK', region: 'Punjab' }]);
  });
  const mount = async (active = true) => {
    let t!: renderer.ReactTestRenderer;
    await act(async () => { t = renderer.create(<Probe active={active} />); });
    await flush();
    return t;
  };

  it('never asks for permission on its own', async () => {
    (loc.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined', granted: false, canAskAgain: true });
    await mount();
    expect(current.permission).toBe('undetermined');
    expect(loc.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(loc.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('distinguishes denied from blocked', async () => {
    (loc.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied', granted: false, canAskAgain: true });
    await mount();
    expect(current.permission).toBe('denied');
    (loc.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied', granted: false, canAskAgain: false });
    await act(async () => { await current.request(); });
    expect(current.permission).toBe('blocked');
  });

  it('does not watch when inactive, and removes the subscription on deactivation and unmount', async () => {
    const t = await mount(false);
    expect(loc.watchPositionAsync).not.toHaveBeenCalled();
    await act(async () => { t.update(<Probe active={true} />); });
    await flush();
    expect(loc.watchPositionAsync).toHaveBeenCalledTimes(1);
    await act(async () => { t.update(<Probe active={false} />); });
    expect(remove).toHaveBeenCalledTimes(1);
    await act(async () => { t.update(<Probe active={true} />); });
    await flush();
    act(() => t.unmount());
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('removes a subscription that resolves after cleanup', async () => {
    let resolve!: (s: any) => void;
    (loc.watchPositionAsync as jest.Mock).mockImplementation(() => new Promise((r) => { resolve = r; }));
    const t = await mount();
    act(() => t.unmount());
    await act(async () => { resolve({ remove }); });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('keeps a usable fix with its accuracy and time', async () => {
    await mount();
    await act(async () => { onFix(reading(18)); });
    expect(current.fix).toEqual({ latitude: 31.5, longitude: 74.3, accuracyM: 18, capturedAt: T });
  });

  it.each([[null], [-1], [NaN], [undefined]])('drops a reading with accuracy %s — never coerced to 0', async (acc) => {
    await mount();
    await act(async () => { onFix(reading(acc as any)); });
    expect(current.fix).toBeNull();
  });

  it('a bad reading does not replace a good fix', async () => {
    await mount();
    await act(async () => { onFix(reading(18)); });
    await act(async () => { onFix(reading(null)); });
    expect(current.fix?.accuracyM).toBe(18);
  });

  it('attaches the geocode to the fix it was requested for', async () => {
    await mount();
    await act(async () => { onFix(reading(18)); });
    await flush();
    expect(current.geocoded?.ok).toBe(true);
    expect(current.geocoded?.place.country).toBe('PK');
    expect(current.geocoded?.for.latitude).toBe(31.5);
  });

  it('records a failed geocode as failed, not as a place', async () => {
    (loc.reverseGeocodeAsync as jest.Mock).mockRejectedValue(new Error('offline'));
    await mount();
    await act(async () => { onFix(reading(18)); });
    await flush();
    expect(current.geocoded?.ok).toBe(false);
    expect(current.geocoded?.place.country).toBeNull();
    expect(current.fix).not.toBeNull(); // the position is kept
  });

  it('does not geocode on every fix', async () => {
    await mount();
    await act(async () => { onFix(reading(18)); });
    await flush();
    await act(async () => { onFix(reading(18)); });
    await flush();
    expect(loc.reverseGeocodeAsync).toHaveBeenCalledTimes(1);
  });

  it('reports a failed watch', async () => {
    (loc.watchPositionAsync as jest.Mock).mockRejectedValue(new Error('no provider'));
    await mount();
    expect(current.watchFailed).toBe(true);
    expect(current.fix).toBeNull();
  });

  it('treats unreadable permission state as not granted', async () => {
    (loc.getForegroundPermissionsAsync as jest.Mock).mockRejectedValue(new Error('x'));
    await mount();
    expect(current.permission).toBe('undetermined');
    expect(loc.watchPositionAsync).not.toHaveBeenCalled();
  });
});
