import React from 'react';
import { Linking } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import * as Location from 'expo-location';
import { ApiError } from '@lumo/api-client';
import type { Incident, IncidentAttempt } from '@lumo/types';
import EmergencyScreen from '../components/EmergencyModal';
import * as apiService from '../services/apiService';

jest.mock('../services/apiService');
const api = apiService as jest.Mocked<typeof apiService>;

const mockGoBack = jest.fn();
let mockParams: any = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack }),
  useRoute: () => ({ params: mockParams }),
}));

const T = new Date().toISOString();
const att = (over: Partial<IncidentAttempt> = {}): IncidentAttempt => ({
  id: 'a1', recipientId: 'c1', recipientName: 'Maya', channel: 'sms', purpose: 'ALERT', state: 'QUEUED', reason: null,
  queuedAt: T, sentAt: null, deliveredAt: null, acknowledgedAt: null, failedAt: null, ...over,
});
const inc = (state: Incident['state'], attempts: IncidentAttempt[] = [], over: Partial<Incident> = {}): Incident => ({
  id: 'inc-1', state, triggerType: 'manual', countdownEndsAt: null, locationAvailable: false, outcome: state,
  reached: [], acknowledged: [], failed: [], pending: [], capped: [], attempts, ...over,
});

let tree: renderer.ReactTestRenderer;
const text = () => JSON.stringify(tree.toJSON());
const control = (label: RegExp | string) =>
  tree.root.findAll((n) => typeof n.props.onPress === 'function' && (typeof label === 'string' ? n.props.accessibilityLabel === label : label.test(String(n.props.accessibilityLabel))))[0];
const flush = async (ms = 0) => { await act(async () => { if (ms) jest.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); }); };
const open = async (params: any) => {
  mockParams = params;
  await act(async () => { tree = renderer.create(<EmergencyScreen />); });
  await flush();
};

describe('the SOS screen', () => {
  let openURL: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    api.getSelfDefenseTips.mockResolvedValue([]);
    api.saveActiveSos.mockResolvedValue(undefined as never);
    api.clearActiveSos.mockResolvedValue(undefined as never);
    api.loadActiveSos.mockResolvedValue(null as never);
  });
  afterEach(() => { act(() => tree?.unmount()); openURL.mockRestore(); jest.useRealTimers(); });

  it('a manual press asks for a 3 s countdown with a trigger and a key, and persists BEFORE the request', async () => {
    const order: string[] = [];
    api.saveActiveSos.mockImplementation(async () => { order.push('saved'); });
    api.raiseSos.mockImplementation(async () => { order.push('requested'); return inc('CREATED'); });
    await open({ trigger: 'manual' });
    expect(order.slice(0, 2)).toEqual(['saved', 'requested']);
    const [key, input] = api.raiseSos.mock.calls[0];
    expect(key).toMatch(/^sos-/);
    expect(input).toMatchObject({ triggerType: 'manual', countdownSeconds: 3 });
  });

  it('shake, voice and crash ask for 10 s', async () => {
    for (const trigger of ['shake', 'voice', 'crash'] as const) {
      api.raiseSos.mockClear();
      api.raiseSos.mockResolvedValue(inc('CREATED'));
      await open({ trigger });
      expect(api.raiseSos.mock.calls[0][1]).toMatchObject({ triggerType: trigger, countdownSeconds: 10 });
      act(() => tree.unmount());
    }
  });

  it('while counting: says nothing has been sent, shows the seconds, and offers Cancel', async () => {
    api.raiseSos.mockResolvedValue(inc('CREATED', [], { countdownEndsAt: new Date(Date.now() + 3000).toISOString() }));
    await open({ trigger: 'manual' });
    expect(text()).toContain('Alerting your contacts in');
    expect(text()).toContain('Nothing has been sent yet');
    expect(control('Cancel the alert. Nothing has been sent yet')).toBeDefined();
  });

  it('Cancel stops it, and the screen says nobody was contacted (state CANCELLED)', async () => {
    api.raiseSos.mockResolvedValue(inc('CREATED'));
    api.cancelIncident.mockResolvedValue(inc('CANCELLED'));
    await open({ trigger: 'manual' });
    await act(async () => { control('Cancel the alert. Nothing has been sent yet').props.onPress(); });
    await flush();
    expect(api.cancelIncident).toHaveBeenCalledWith('inc-1');
    expect(text()).toContain('Cancelled');
    expect(api.clearActiveSos).toHaveBeenCalled();
  });

  it('a cancel that is too late says so, and shows what actually happened', async () => {
    api.raiseSos.mockResolvedValue(inc('CREATED'));
    api.cancelIncident.mockRejectedValue(new ApiError('too late', 'http', 409));
    api.getIncident.mockResolvedValue(inc('NOTIFYING', [att({ state: 'SENT', sentAt: T })]));
    await open({ trigger: 'manual' });
    await act(async () => { control('Cancel the alert. Nothing has been sent yet').props.onPress(); });
    await flush();
    expect(text()).toContain('too late to cancel');
    expect(text()).toContain('not confirmed');
  });

  it('the countdown passing is learned from the server, not assumed: the screen moves on only when the incident does', async () => {
    api.raiseSos.mockResolvedValue(inc('CREATED'));
    api.getIncident.mockResolvedValue(inc('CREATED'));
    await open({ trigger: 'manual' });
    await flush(5000);
    expect(text()).toContain('Nothing has been sent yet'); // the local clock hit zero; the server has not said so
    api.getIncident.mockResolvedValue(inc('NOTIFYING', [att({ state: 'SENT', sentAt: T })]));
    await flush(2000);
    expect(text()).toContain('Sending…');
    expect(text()).not.toContain('Nothing has been sent');
  });

  describe('when the request does not complete', () => {
    it('says NOTHING HAS BEEN SENT, puts the dialler first, and retries with the SAME key', async () => {
      api.raiseSos.mockRejectedValueOnce(new ApiError('Network request failed', 'network'));
      await open({ trigger: 'manual' });
      expect(text()).toContain('Nothing has been sent');
      expect(text()).toContain("Lumo can't be reached");
      expect(text()).toContain('Lumo will keep trying');
      expect(control(/Open the phone dialler to call/)).toBeDefined();
      api.raiseSos.mockResolvedValueOnce(inc('CREATED'));
      await act(async () => { control('Try to start the alert again').props.onPress(); });
      await flush();
      expect(api.raiseSos.mock.calls[0][0]).toBe(api.raiseSos.mock.calls[1][0]); // one key, so no duplicate incident
      expect(text()).toContain('Alerting your contacts');
    });

    it('a timeout and a server error are the same: nothing sent, try again', async () => {
      for (const e of [new ApiError('timed out', 'timeout'), new ApiError('Service unavailable', 'http', 503)]) {
        api.raiseSos.mockRejectedValueOnce(e);
        await open({ trigger: 'manual' });
        expect(text()).toContain('Nothing has been sent');
        expect(control('Try to start the alert again')).toBeDefined();
        act(() => tree.unmount());
      }
    });

    it('an unreadable answer is not success', async () => {
      api.raiseSos.mockResolvedValueOnce(undefined as never);
      await open({ trigger: 'manual' });
      expect(text()).toContain('Nothing has been sent');
    });

    it('a rejected credential says Lumo cannot alert contacts, and offers no retry that cannot work', async () => {
      api.raiseSos.mockRejectedValue(new ApiError('Unauthorized', 'http', 401));
      await open({ trigger: 'manual' });
      expect(text()).toContain("You're not signed in here");
      expect(text()).toContain('Nothing has been sent');
      expect(control('Try to start the alert again')).toBeUndefined();
      expect(control(/Open the phone dialler to call/)).toBeDefined();
    });

    it('opened with no trigger (from the login screen) it starts nothing and says so', async () => {
      await open(undefined);
      expect(api.raiseSos).not.toHaveBeenCalled();
      expect(text()).toContain('No alert has been started');
    });
  });

  describe('the live ledger', () => {
    const live = (state: Incident['state'], attempts: IncidentAttempt[], over: Partial<Incident> = {}) => {
      api.raiseSos.mockResolvedValue(inc(state, attempts, over));
      return open({ trigger: 'manual' });
    };

    it('lists each contact on their own, with the most that is true, and no aggregate tick', async () => {
      await live('PARTIALLY_NOTIFIED', [
        att({ state: 'SENT', sentAt: T }),
        att({ id: 'a2', recipientId: 'c2', recipientName: 'Dad', state: 'FAILED', reason: 'NO_ADDRESS' }),
      ]);
      expect(text()).toContain("Sent to 1 of 2 · couldn't reach Dad");
      expect(text()).toContain('Maya');
      expect(text()).toContain('not confirmed');
      expect(text()).toContain('Lumo has no app or number to reach them on');
      expect(text().toLowerCase()).not.toMatch(/contacts have been|alert sent|help is on/);
    });

    it('a cap hit is said out loud', async () => {
      await live('NOTIFYING', [att()], { capped: ['c2', 'c3'] });
      expect(text()).toContain("Today's limit was reached");
      expect(text()).toContain('2 contacts were not alerted');
    });

    it('a failed refresh keeps the last ledger and says how old it is', async () => {
      await live('NOTIFYING', [att({ state: 'SENT', sentAt: T })]);
      api.getIncident.mockRejectedValue(new ApiError('x', 'network'));
      await flush(2000);
      expect(text()).toContain("Can't refresh right now");
      expect(text()).toContain('Maya'); // not blanked
    });

    it('acknowledged names who is responding', async () => {
      await live('ACKNOWLEDGED', [att({ channel: 'push', state: 'ACKNOWLEDGED', acknowledgedAt: T })]);
      expect(text()).toContain('Maya is responding');
    });

    it('with no names (an emergency token), contacts are "Contact 1"', async () => {
      await live('NOTIFYING', [att({ recipientName: undefined, state: 'SENT', sentAt: T })]);
      expect(text()).toContain('Contact 1');
      expect(text()).not.toContain('Maya');
    });

    it('"I\'m safe" ends the alert and shows it ended', async () => {
      await live('NOTIFIED', [att({ state: 'SENT', sentAt: T })]);
      api.resolveIncident.mockResolvedValue(inc('CLOSED', [att({ state: 'SENT', sentAt: T })]));
      await act(async () => { control(/End the alert/).props.onPress(); });
      await flush();
      expect(api.resolveIncident).toHaveBeenCalledWith('inc-1');
      expect(text()).toContain('Ended');
      expect(control(/End the alert/)).toBeUndefined();
    });

    it('polls until the incident ends, then stops', async () => {
      await live('NOTIFYING', [att()]);
      api.getIncident.mockResolvedValue(inc('CLOSED'));
      await flush(2000);
      const calls = api.getIncident.mock.calls.length;
      await flush(10_000);
      expect(api.getIncident.mock.calls.length).toBe(calls);
    });
  });

  describe('ALL_CHANNELS_FAILED', () => {
    it('is a full screen that says nobody was reached, says why per contact, and leads with the dialler', async () => {
      api.raiseSos.mockResolvedValue(inc('ALL_CHANNELS_FAILED', [
        att({ state: 'FAILED', reason: 'PROVIDER_NOT_CONFIGURED' }),
        att({ id: 'a2', recipientId: 'c2', recipientName: 'Dad', state: 'FAILED', reason: 'CONSENT_AWAITING' }),
      ]));
      await open({ trigger: 'manual' });
      expect(text()).toContain('Nobody was reached');
      expect(text()).toContain('Call for help now');
      expect(text()).toContain('Lumo cannot send this kind of message yet');
      expect(text()).toContain("they haven't agreed yet");
      await act(async () => { control(/Open the phone dialler to call/).props.onPress(); });
      expect(openURL).toHaveBeenCalledWith('tel:112');
    });

    it('with no contact who agreed at all, says that', async () => {
      api.raiseSos.mockResolvedValue(inc('ALL_CHANNELS_FAILED', []));
      await open({ trigger: 'manual' });
      expect(text()).toContain('no contact who has agreed');
    });
  });

  describe('the number follows where the DEVICE is', () => {
    const fixAt = async (country: string, subdivision?: string) => {
      (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
      let onFix: (l: any) => void = () => {};
      (Location.watchPositionAsync as jest.Mock).mockImplementation(async (_o: any, cb: any) => { onFix = cb; return { remove: jest.fn() }; });
      (Location.reverseGeocodeAsync as jest.Mock).mockResolvedValue([{ isoCountryCode: country, region: subdivision }]);
      api.raiseSos.mockResolvedValue(inc('ALL_CHANNELS_FAILED', []));
      await open({ trigger: 'manual' });
      await act(async () => { onFix({ coords: { latitude: 31.5, longitude: 74.3, accuracy: 18 }, timestamp: Date.now() }); });
      await flush();
    };

    it('in the US it offers 911, and in Punjab it leads with the national number and marks the regional one "might work"', async () => {
      await fixAt('US', 'California');
      expect(control('Open the phone dialler to call 911')).toBeDefined();
      act(() => tree.unmount());
      await fixAt('PK', 'Punjab');
      expect(control(/Open the phone dialler to call 15/)).toBeDefined();
    });

    it('an unverified number says so', async () => {
      api.raiseSos.mockResolvedValue(inc('ALL_CHANNELS_FAILED', []));
      await open({ trigger: 'manual' });
      expect(text()).toContain('has not been verified');
    });

    it('sends the position and place with the SOS, and omits them when the user turned location sharing off', async () => {
      await fixAt('PK', 'Punjab');
      api.raiseSos.mockClear();
      act(() => tree.unmount());
      await open({ trigger: 'manual', settings: { security: { shareLocationOnSos: false }, personalInfo: {} } });
      expect(api.raiseSos.mock.calls[0][1]).not.toHaveProperty('location');
    });
  });

  describe('resuming after the app was closed', () => {
    it('shows the incident again instead of starting a new one', async () => {
      api.loadActiveSos.mockResolvedValue({ key: 'sos-old', incidentId: 'inc-1', startedAt: Date.now() - 60_000, trigger: 'manual' } as never);
      api.getIncident.mockResolvedValue(inc('NOTIFIED', [att({ state: 'SENT', sentAt: T })]));
      await open({ resume: true });
      expect(api.raiseSos).not.toHaveBeenCalled();
      expect(text()).toContain('Sent to 1 · no response yet');
    });
    it('ignores one from more than six hours ago', async () => {
      api.loadActiveSos.mockResolvedValue({ key: 'sos-old', incidentId: 'inc-1', startedAt: Date.now() - 7 * 3600_000, trigger: 'manual' } as never);
      await open({ resume: true });
      expect(api.getIncident).not.toHaveBeenCalled();
      expect(text()).toContain('No alert has been started');
    });
  });

  it('never claims a thing it cannot prove, in any phase', async () => {
    const phases: Array<() => void> = [
      () => api.raiseSos.mockResolvedValue(inc('CREATED')),
      () => api.raiseSos.mockRejectedValue(new ApiError('x', 'network')),
      () => api.raiseSos.mockResolvedValue(inc('NOTIFIED', [att({ state: 'SENT', sentAt: T })])),
      () => api.raiseSos.mockResolvedValue(inc('ALL_CHANNELS_FAILED', [])),
    ];
    for (const arm of phases) {
      arm();
      await open({ trigger: 'manual' });
      expect(text().toLowerCase()).not.toMatch(/help is on the way|help is coming|contacts (have been |were )?notified|alert (has been |was )?sent|services (have been )?(contacted|called)/);
      act(() => tree.unmount());
    }
  });
});

describe('the escalation plan on the SOS screen', () => {
  let t: renderer.ReactTestRenderer;
  beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks();
    api.getSelfDefenseTips.mockResolvedValue([]);
    api.saveActiveSos.mockResolvedValue(undefined as never);
    api.clearActiveSos.mockResolvedValue(undefined as never);
  });
  afterEach(() => { act(() => t?.unmount()); jest.useRealTimers(); });
  const show = async (i: Incident) => {
    api.raiseSos.mockResolvedValue(i);
    mockParams = { trigger: 'manual' };
    await act(async () => { t = renderer.create(<EmergencyScreen />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    return JSON.stringify(t.toJSON());
  };

  it('says who is tried next, in "will try" words, while a step is in flight', async () => {
    const out = await show(inc('NOTIFYING', [att({ state: 'SENT', sentAt: T })], { escalation: { phase: 'RUNNING', stepOrder: 1, steps: 3, nextStepAt: Date.now() + 120_000 } }));
    expect(out).toContain('If nobody responds, Lumo will try the next contact at about');
    expect(out.toLowerCase()).not.toMatch(/will be notified|help is/);
  });
  it('says nothing about a next step on the last one, or once someone is responding', async () => {
    expect(await show(inc('NOTIFYING', [att()], { escalation: { phase: 'RUNNING', stepOrder: 3, steps: 3, nextStepAt: Date.now() + 1000 } }))).not.toContain('try the next contact');
    act(() => t.unmount());
    expect(await show(inc('ACKNOWLEDGED', [att({ channel: 'push', state: 'ACKNOWLEDGED', acknowledgedAt: T })], { escalation: { phase: 'HALTED', stepOrder: 1, steps: 3, nextStepAt: null } }))).not.toContain('try the next contact');
  });
  it('a plan limit is explained', async () => {
    const out = await show(inc('NOTIFYING', [att({ state: 'FAILED', reason: 'MAX_RECIPIENTS', recipientName: 'Dad', recipientId: 'c2' })]));
    expect(out).toContain('your plan limits how many people are alerted');
  });
});
