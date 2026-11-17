import React from 'react';
import { Linking } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { ApiError } from '@lumo/api-client';
import type { Incident, IncidentAttempt } from '@lumo/types';
import PracticeScreen from '../components/PracticeScreen';
import * as apiService from '../services/apiService';
import { PRACTICE_BANNER } from '../services/practiceCopy';

jest.mock('../services/apiService');
const api = apiService as jest.Mocked<typeof apiService>;

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
let mockParams: any;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
  useRoute: () => ({ params: mockParams }),
}));

const T = new Date().toISOString();
const att = (over: Partial<IncidentAttempt> = {}): IncidentAttempt => ({
  id: 'a1', recipientId: 'c1', recipientName: 'Maya', channel: 'push', purpose: 'ALERT', state: 'DELIVERED', reason: null,
  queuedAt: T, sentAt: T, deliveredAt: T, acknowledgedAt: null, failedAt: null, simulated: true, ...over,
});
const inc = (state: Incident['state'], attempts: IncidentAttempt[] = [], over: Partial<Incident> = {}): Incident => ({
  id: 'p1', mode: 'practice', state, triggerType: 'manual', countdownEndsAt: null, locationAvailable: false, outcome: state,
  reached: [], acknowledged: [], failed: [], pending: [], capped: [], attempts, ...over,
});
const settings: any = { personalInfo: {}, security: { sendSmsOnSos: false }, trustedContacts: [
  { id: 'c1', name: 'Maya', phone: '+1', consentStatus: 'agreed' }, { id: 'c2', name: 'Dad', phone: '+2', consentStatus: 'agreed' } ] };

let tree: renderer.ReactTestRenderer;
const text = () => JSON.stringify(tree.toJSON());
const control = (label: RegExp | string) => tree.root.findAll(n => typeof n.props.onPress === 'function' && (typeof label === 'string' ? n.props.accessibilityLabel === label : label.test(String(n.props.accessibilityLabel))))[0];
const flush = async (ms = 0) => { await act(async () => { if (ms) jest.advanceTimersByTime(ms); for (let i = 0; i < 6; i += 1) await Promise.resolve(); }); };
const open = async (params: any = { settings }) => { mockParams = params; await act(async () => { tree = renderer.create(<PracticeScreen />); }); await flush(); };
const start = async () => { await act(async () => { control(/^Start a practice run/).props.onPress(); }); await flush(); };

let openURL: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
  api.saveActiveSos.mockResolvedValue(undefined as never);
  api.clearActiveSos.mockResolvedValue(undefined as never);
});
afterEach(() => { act(() => tree?.unmount()); openURL.mockRestore(); jest.useRealTimers(); });

describe('the banner', () => {
  it('is the spec\'s words, and is on screen in every state', async () => {
    expect(PRACTICE_BANNER).toBe('Practice — nobody will be contacted');
    await open();
    expect(text()).toContain(PRACTICE_BANNER); // before starting
    api.raiseSos.mockResolvedValue(inc('CREATED'));
    await start();
    expect(text()).toContain(PRACTICE_BANNER); // counting
    act(() => tree.unmount());
    api.raiseSos.mockResolvedValue(inc('PARTIALLY_NOTIFIED', [att(), att({ id: 'a2', recipientId: 'c2', recipientName: 'Dad', state: 'FAILED', reason: 'SIMULATED_FAILURE', deliveredAt: null })]));
    await open();
    await start();
    expect(text()).toContain(PRACTICE_BANNER); // live
    act(() => tree.unmount());
    api.raiseSos.mockRejectedValue(new ApiError('x', 'network'));
    await open();
    await start();
    expect(text()).toContain(PRACTICE_BANNER); // offline
    act(() => tree.unmount());
    api.raiseSos.mockRejectedValue(new ApiError('no', 'http', 401));
    await open();
    await start();
    expect(text()).toContain(PRACTICE_BANNER); // signed out
  });
});

describe('it cannot be confused with, or act as, a real SOS', () => {
  it('asks the server for a practice run, with a countdown, and writes no saved SOS record', async () => {
    api.raiseSos.mockResolvedValue(inc('CREATED'));
    await open();
    await start();
    expect(api.raiseSos.mock.calls[0][1]).toMatchObject({ mode: 'practice', triggerType: 'manual', countdownSeconds: 3 });
    expect(api.saveActiveSos).not.toHaveBeenCalled();
  });

  it('never clears a real SOS\'s saved record, even when the practice run ends', async () => {
    api.raiseSos.mockResolvedValue(inc('CREATED'));
    api.cancelIncident.mockResolvedValue(inc('CANCELLED'));
    await open();
    await start();
    await act(async () => { control('Cancel the practice run').props.onPress(); });
    await flush();
    expect(api.clearActiveSos).not.toHaveBeenCalled();
    expect(api.saveActiveSos).not.toHaveBeenCalled();
  });

  it('has no control that opens the phone dialler: a rehearsal cannot place a call', async () => {
    api.raiseSos.mockResolvedValue(inc('PARTIALLY_NOTIFIED', [att()]));
    await open();
    await start();
    expect(text()).not.toMatch(/Open the phone dialler|Call \d/);
    for (const c of tree.root.findAll(n => typeof n.props.onPress === 'function')) {
      await act(async () => { try { c.props.onPress(); } catch { /* ignore */ } });
    }
    expect(openURL).not.toHaveBeenCalled();
  });

  it('offers a plainly labelled way to the REAL emergency screen, and starts no SOS by doing so', async () => {
    await open();
    await act(async () => { control(/Open the real emergency screen/).props.onPress(); });
    expect(mockNavigate).toHaveBeenCalledWith('Emergency', { settings });
    expect(api.raiseSos).not.toHaveBeenCalled();
  });
});

describe('the run', () => {
  it('explains itself and says what the contacts will look like before anything starts', async () => {
    await open();
    expect(text()).toContain('Nobody gets a message');
    expect(text()).toContain('2 contacts have agreed');
    expect(api.raiseSos).not.toHaveBeenCalled(); // nothing starts by opening the screen
  });

  it('says so when no contact has agreed, rather than rehearse a success', async () => {
    await open({ settings: { ...settings, trustedContacts: [{ id: 'c1', name: 'Maya', phone: '+1', consentStatus: 'waiting' }] } });
    expect(text()).toContain('None of your contacts has agreed');
  });

  it('counts down and can be cancelled, as a real one can', async () => {
    api.raiseSos.mockResolvedValue(inc('CREATED', [], { countdownEndsAt: new Date(Date.now() + 3000).toISOString() }));
    api.cancelIncident.mockResolvedValue(inc('CANCELLED'));
    await open();
    await start();
    expect(text()).toContain('Practice alert in');
    await act(async () => { control('Cancel the practice run').props.onPress(); });
    await flush();
    expect(api.cancelIncident).toHaveBeenCalledWith('p1');
    expect(text()).toContain('Practice cancelled');
  });

  it('shows the simulated ledger, every row marked, with the headline and the note that nothing was sent', async () => {
    api.raiseSos.mockResolvedValue(inc('PARTIALLY_NOTIFIED', [
      att(),
      att({ id: 'a2', recipientId: 'c2', recipientName: 'Dad', state: 'FAILED', reason: 'SIMULATED_FAILURE', deliveredAt: null }),
    ]));
    await open();
    await start();
    expect(text()).toContain('Practice: Sent to');
    expect(text()).toContain('Nothing was sent to anyone');
    expect(text()).toContain('delivered');
    expect(text()).toContain('example failure');
    expect(text().match(/\(practice\)/g)?.length).toBe(2);
  });

  it('"End practice" ends it on the server and says it finished', async () => {
    api.raiseSos.mockResolvedValue(inc('NOTIFIED', [att()]));
    api.resolveIncident.mockResolvedValue(inc('CLOSED', [att()]));
    await open();
    await start();
    await act(async () => { control('End the practice run').props.onPress(); });
    await flush();
    expect(api.resolveIncident).toHaveBeenCalledWith('p1');
    expect(text()).toContain('Practice finished');
  });

  it('says nobody to try when no contact agreed, as a real SOS would, not a success', async () => {
    api.raiseSos.mockResolvedValue(inc('ALL_CHANNELS_FAILED', []));
    await open();
    await start();
    expect(text()).toContain('nobody to try');
    expect(text()).not.toContain('Sent to');
  });
});

describe('offline and signed out', () => {
  it('runs on the phone from the saved contacts when Lumo cannot be reached, and says so', async () => {
    api.raiseSos.mockRejectedValue(new ApiError('x', 'network'));
    await open();
    await start();
    expect(text()).toContain('this practice ran on your phone');
    expect(text()).toContain('Maya');
    expect(text()).toContain('example failure');
    expect(text()).toContain('Nothing was sent to anyone');
    expect(api.saveActiveSos).not.toHaveBeenCalled();
    expect(openURL).not.toHaveBeenCalled();
  });

  it('with no settings loaded, the offline run shows nobody to try rather than inventing contacts', async () => {
    api.raiseSos.mockRejectedValue(new ApiError('x', 'network'));
    await open({});
    await start();
    expect(text()).toContain('nobody to try');
  });

  it('when signed out, says practice needs an account, and invents no ledger', async () => {
    api.raiseSos.mockRejectedValue(new ApiError('no', 'http', 401));
    await open();
    await start();
    expect(text()).toContain("You're not signed in");
    expect(text()).not.toContain('Practice: ');
  });
});
