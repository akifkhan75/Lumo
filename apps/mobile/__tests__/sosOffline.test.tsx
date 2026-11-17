import React from 'react';
import { AppState, Linking } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import * as Notifications from 'expo-notifications';
import { ApiError } from '@lumo/api-client';
import type { Incident, IncidentAttempt } from '@lumo/types';
import EmergencyScreen from '../components/EmergencyModal';
import * as apiService from '../services/apiService';

/** An SOS pressed with no signal (docs/specs/OFFLINE_SOS.md). */
jest.mock('../services/apiService');
const api = apiService as jest.Mocked<typeof apiService>;
const notif = Notifications as jest.Mocked<typeof Notifications>;

const mockGoBack = jest.fn();
let mockParams: any = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack }),
  useRoute: () => ({ params: mockParams }),
}));

const T = new Date().toISOString();
const att = (over: Partial<IncidentAttempt> = {}): IncidentAttempt => ({
  id: 'a1', recipientId: 'c1', recipientName: 'Maya', channel: 'sms', purpose: 'ALERT', state: 'SENT', reason: null,
  queuedAt: T, sentAt: T, deliveredAt: null, acknowledgedAt: null, failedAt: null, ...over,
});
const inc = (state: Incident['state'], attempts: IncidentAttempt[] = [], over: Partial<Incident> = {}): Incident => ({
  id: 'inc-1', state, triggerType: 'manual', countdownEndsAt: null, locationAvailable: false, outcome: state,
  reached: [], acknowledged: [], failed: [], pending: [], capped: [], attempts, ...over,
});
const down = () => new ApiError('Network request failed', 'network');

let tree: renderer.ReactTestRenderer;
const text = () => JSON.stringify(tree.toJSON());
const control = (label: RegExp | string) => tree.root.findAll(n => typeof n.props.onPress === 'function' && (typeof label === 'string' ? n.props.accessibilityLabel === label : label.test(String(n.props.accessibilityLabel))))[0];
const flush = async (ms = 0) => { await act(async () => { if (ms) jest.advanceTimersByTime(ms); for (let i = 0; i < 8; i += 1) await Promise.resolve(); }); };
const open = async (params: any) => { mockParams = params; await act(async () => { tree = renderer.create(<EmergencyScreen />); }); await flush(); };
const press = () => open({ trigger: 'manual' });

let openURL: jest.SpyInstance;
let appStateHandler: ((s: string) => void) | null;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  // A queued once-value from one test must not leak into the next. Only the API is reset: the global native mocks keep their defaults.
  Object.values(api).forEach(f => { if (typeof (f as jest.Mock)?.mockReset === 'function') (f as jest.Mock).mockReset(); });
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => { appStateHandler = h; return { remove: jest.fn() }; }) as never);
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
  api.getSelfDefenseTips.mockResolvedValue([]);
  api.saveActiveSos.mockResolvedValue(undefined as never);
  api.clearActiveSos.mockResolvedValue(undefined as never);
  api.loadActiveSos.mockResolvedValue(null as never);
  (notif.scheduleNotificationAsync as jest.Mock).mockResolvedValue('reminder-1');
});
afterEach(() => { act(() => tree?.unmount()); openURL.mockRestore(); jest.useRealTimers(); });

describe('pressed with no signal', () => {
  it('says nothing has been sent, what Lumo will try, what it needs, and keeps the dialler one tap away', async () => {
    api.raiseSos.mockRejectedValue(down());
    await press();
    expect(text()).toContain('Nothing has been sent');
    expect(text()).toContain("Lumo can't be reached");
    expect(text()).toContain('as long as Lumo stays open');
    expect(text()).toContain('To get help now, call');
    expect(control(/Open the phone dialler to call/)).toBeDefined();
  });

  it('never claims it was sent, queued, delivered or that help is coming', async () => {
    api.raiseSos.mockRejectedValue(down());
    await press();
    expect(text().toLowerCase()).not.toMatch(/\bqueued\b|will be sent|has been sent to|delivered|help is|on its way|notified/);
  });

  it('writes the press to the device BEFORE the request, with the position at the press', async () => {
    const order: string[] = [];
    api.saveActiveSos.mockImplementation(async () => { order.push('saved'); });
    api.raiseSos.mockImplementation(async () => { order.push('requested'); throw down(); });
    await press();
    expect(order.slice(0, 2)).toEqual(['saved', 'requested']);
  });

  it('keeps its own countdown, which does not wait for a server', async () => {
    api.raiseSos.mockRejectedValue(down());
    await press();
    expect(text()).toContain('Your alert is set to start in');
    expect(text()).toContain('Cancel to stop it');
  });
});

describe('trying again by itself', () => {
  it('retries with the SAME key, backing off 2, 4, 8 seconds, and reports how long ago it was by its own stopwatch', async () => {
    api.raiseSos.mockRejectedValue(down());
    await press();
    expect(api.raiseSos).toHaveBeenCalledTimes(1);
    expect(api.raiseSos.mock.calls[0][1].elapsedSeconds).toBe(0);
    await flush(1900); expect(api.raiseSos).toHaveBeenCalledTimes(1); // not yet
    await flush(200);  expect(api.raiseSos).toHaveBeenCalledTimes(2); // after 2 s
    await flush(3900); expect(api.raiseSos).toHaveBeenCalledTimes(2);
    await flush(200);  expect(api.raiseSos).toHaveBeenCalledTimes(3); // 4 s later
    await flush(8100); expect(api.raiseSos).toHaveBeenCalledTimes(4); // 8 s later
    const keys = new Set(api.raiseSos.mock.calls.map(c => c[0]));
    expect(keys.size).toBe(1);
    expect(api.raiseSos.mock.calls[1][1].elapsedSeconds).toBe(2);
    expect(api.raiseSos.mock.calls[3][1].elapsedSeconds).toBe(14);
  });

  it('shows the live ledger once it gets through, cancels the reminder, and says how late it was', async () => {
    api.raiseSos.mockRejectedValueOnce(down()).mockResolvedValueOnce(inc('NOTIFYING', [att()], { lateBySeconds: 600 }));
    await press();
    expect(notif.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    await flush(2100);
    expect(notif.cancelScheduledNotificationAsync).toHaveBeenCalledWith('reminder-1');
    expect(text()).toContain('Maya');
    expect(text()).toContain('about 10 minutes after you pressed it');
    expect(api.saveActiveSos).toHaveBeenLastCalledWith(expect.objectContaining({ incidentId: 'inc-1' }));
  });

  it('retries as soon as the app comes back to the foreground, without waiting out the delay', async () => {
    api.raiseSos.mockRejectedValueOnce(down()).mockResolvedValueOnce(inc('NOTIFYING', [att()]));
    await press();
    expect(api.raiseSos).toHaveBeenCalledTimes(1);
    await act(async () => { appStateHandler?.('active'); });
    await flush();
    expect(api.raiseSos).toHaveBeenCalledTimes(2);
  });

  it('"Try now" does not wait either, and a second try never overlaps the first', async () => {
    let release!: (i: Incident) => void;
    api.raiseSos.mockRejectedValueOnce(down()).mockImplementationOnce(() => new Promise<Incident>(r => { release = r; }));
    await press();
    await act(async () => { control('Try to start the alert again').props.onPress(); });
    await act(async () => { appStateHandler?.('active'); control('Try to start the alert again')?.props.onPress(); });
    expect(api.raiseSos).toHaveBeenCalledTimes(2); // the in-flight one is not doubled
    await act(async () => { release(inc('NOTIFYING', [att()])); });
    await flush();
    expect(text()).toContain('Maya');
  });

  it('schedules the reminder once, on the first failure, not on every retry', async () => {
    api.raiseSos.mockRejectedValue(down());
    await press();
    await flush(2100); await flush(4100);
    expect(notif.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the answer cannot change: signed out, or refused', async () => {
    api.raiseSos.mockRejectedValue(new ApiError('Unauthorized', 'http', 401));
    await press();
    await flush(60_000);
    expect(api.raiseSos).toHaveBeenCalledTimes(1);
    expect(text()).toContain("not signed in");
  });
});

describe('too long ago', () => {
  it('says so, sends nothing, clears the saved press so it never comes back, and keeps the dialler', async () => {
    api.raiseSos.mockRejectedValue(new ApiError('Too long ago. Nothing was sent.', 'http', 400, true));
    await press();
    expect(text()).toContain('Too long ago to send');
    expect(text()).toContain('nothing was sent');
    expect(api.clearActiveSos).toHaveBeenCalled();
    expect(control(/Open the phone dialler to call/)).toBeDefined();
    await flush(60_000);
    expect(api.raiseSos).toHaveBeenCalledTimes(1);
    expect(notif.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('cancelling while offline', () => {
  it('stops sending FIRST, writes that down, then settles it with Lumo by the key, and says cancelled only when Lumo says so', async () => {
    const order: string[] = [];
    api.raiseSos.mockRejectedValue(down());
    api.saveActiveSos.mockImplementation(async (v: any) => { if (v.cancelled) order.push('wrote-cancelled'); });
    api.cancelSosByKey.mockImplementation(async () => { order.push('cancel-by-key'); return inc('CANCELLED'); });
    await press();
    await act(async () => { control('Cancel the alert. Nothing has been sent').props.onPress(); });
    await flush();
    expect(order).toEqual(['wrote-cancelled', 'cancel-by-key']);
    expect(api.cancelSosByKey).toHaveBeenCalledWith(api.raiseSos.mock.calls[0][0]);
    expect(text()).toContain('Cancelled');
    await flush(60_000);
    expect(api.raiseSos).toHaveBeenCalledTimes(1); // no retry sends it after it was cancelled
    expect(api.clearActiveSos).toHaveBeenCalled();
  });

  it('when Lumo cannot be reached for the cancel, says it is not confirmed, and keeps trying to settle it', async () => {
    api.raiseSos.mockRejectedValue(down());
    api.cancelSosByKey.mockRejectedValueOnce(down()).mockResolvedValueOnce(inc('CANCELLED'));
    await press();
    await act(async () => { control('Cancel the alert. Nothing has been sent').props.onPress(); });
    await flush();
    expect(text()).toContain('Cancelled on this phone');
    expect(text()).toContain("couldn't be reached to confirm");
    expect(text()).toContain('your contacts may still be told');
    await flush(2100);
    expect(api.cancelSosByKey).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Cancelled');
    expect(text()).not.toContain('Cancelled on this phone');
  });

  it('when the alert had already gone out, shows what really happened, not "cancelled"', async () => {
    api.raiseSos.mockRejectedValue(down());
    api.cancelSosByKey.mockResolvedValue(inc('NOTIFYING', [att()]));
    await press();
    await act(async () => { control('Cancel the alert. Nothing has been sent').props.onPress(); });
    await flush();
    expect(text()).toContain('too late to cancel');
    expect(text()).toContain('Maya');
  });

  it('can be cancelled while a request is still in flight, and the response that arrives after does not bring the alert back to life', async () => {
    let release!: (i: Incident) => void;
    api.raiseSos.mockImplementation(() => new Promise<Incident>(r => { release = r; })); // Lumo has not answered
    api.cancelSosByKey.mockResolvedValue(inc('CANCELLED'));
    await press();
    await act(async () => { control('Cancel the alert. Nothing has been sent').props.onPress(); });
    await flush();
    expect(text()).toContain('Cancelled');
    await act(async () => { release(inc('NOTIFYING', [att()])); }); // the stray response, arriving late
    await flush();
    expect(text()).toContain('Cancelled');
    expect(text()).not.toContain('Maya'); // it did not become a live ledger
    expect(api.saveActiveSos).not.toHaveBeenCalledWith(expect.objectContaining({ incidentId: 'inc-1' }));
  });

  it('is not offered, and not needed, once Lumo has the incident (the ordinary cancel is used)', async () => {
    api.raiseSos.mockResolvedValue(inc('CREATED'));
    api.cancelIncident.mockResolvedValue(inc('CANCELLED'));
    await press();
    await act(async () => { control('Cancel the alert. Nothing has been sent yet').props.onPress(); });
    await flush();
    expect(api.cancelIncident).toHaveBeenCalledWith('inc-1');
    expect(api.cancelSosByKey).not.toHaveBeenCalled();
  });
});

describe('the app was closed and reopened', () => {
  const now = () => Date.now();

  it('sends the saved press with the SAME key, how long ago it was, and the position at the press', async () => {
    const fix = { latitude: 33.6, longitude: 73.0, accuracyM: 12, capturedAt: now() - 400_000 };
    api.loadActiveSos.mockResolvedValue({ key: 'sos-saved-1', startedAt: now() - 300_000, trigger: 'manual', fix } as never);
    api.raiseSos.mockResolvedValue(inc('NOTIFYING', [att()], { lateBySeconds: 300 }));
    await open({ resume: true });
    const [key, input] = api.raiseSos.mock.calls[0];
    expect(key).toBe('sos-saved-1');
    expect(input.elapsedSeconds).toBeGreaterThanOrEqual(299);
    expect(input.location).toEqual(fix);
    expect(text()).toContain('Maya');
  });

  it('a press the person cancelled is finished as a cancel, and is NEVER sent', async () => {
    api.loadActiveSos.mockResolvedValue({ key: 'sos-saved-2', startedAt: now() - 60_000, trigger: 'manual', cancelled: true } as never);
    api.cancelSosByKey.mockResolvedValue(inc('CANCELLED'));
    await open({ resume: true });
    expect(api.cancelSosByKey).toHaveBeenCalledWith('sos-saved-2');
    expect(api.raiseSos).not.toHaveBeenCalled();
    expect(text()).toContain('Cancelled');
  });

  it('a press older than 6 hours is dropped, not offered and not sent', async () => {
    api.loadActiveSos.mockResolvedValue({ key: 'sos-old', startedAt: now() - 7 * 3600_000, trigger: 'manual' } as never);
    await open({ resume: true });
    expect(api.raiseSos).not.toHaveBeenCalled();
    expect(api.clearActiveSos).toHaveBeenCalled();
  });

  it('when the saved press is refused as too long ago, says so and clears it', async () => {
    api.loadActiveSos.mockResolvedValue({ key: 'sos-edge', startedAt: now() - 5 * 3600_000, trigger: 'manual' } as never);
    api.raiseSos.mockRejectedValue(new ApiError('Too long ago. Nothing was sent.', 'http', 400, true));
    await open({ resume: true });
    expect(text()).toContain('Too long ago to send');
    expect(api.clearActiveSos).toHaveBeenCalled();
  });
});
