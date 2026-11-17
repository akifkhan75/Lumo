import React from 'react';
import renderer, { act } from 'react-test-renderer';
import * as Location from 'expo-location';
import { ApiError } from '@lumo/api-client';
import type { Journey } from '@lumo/types';
import JourneyScreen from '../components/JourneyScreen';
import * as apiService from '../services/apiService';

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

const iso = (ms: number) => new Date(ms).toISOString();
const journey = (over: Partial<Journey> = {}): Journey => ({
  id: 'j1', kind: 'walk_home', state: 'ACTIVE', expectedArrivalAt: iso(Date.now() + 600_000), checkInDueAt: iso(Date.now() + 600_000), destination: null, shareLocation: true,
  plan: { graceSeconds: 180, contacts: ['Maya', 'Dad'] }, needsAnswer: false, incidentId: null, startedAt: iso(Date.now()), endedAt: null, ...over,
});
const settings: any = { personalInfo: {}, security: {}, trustedContacts: [
  { id: 'c1', name: 'Maya', phone: '+1', consentStatus: 'agreed' }, { id: 'c2', name: 'Dad', phone: '+2', consentStatus: 'agreed' } ] };

let tree: renderer.ReactTestRenderer;
const text = () => JSON.stringify(tree.toJSON());
const control = (label: RegExp | string) => tree.root.findAll((n) => typeof n.props.onPress === 'function' && (typeof label === 'string' ? n.props.accessibilityLabel === label : label.test(String(n.props.accessibilityLabel))))[0];
const flush = async (ms = 0) => { await act(async () => { if (ms) jest.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const open = async (j: Journey | null, params?: any) => {
  mockParams = params;
  api.getActiveJourney.mockResolvedValue(j as never);
  await act(async () => { tree = renderer.create(<JourneyScreen />); });
  await flush();
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  api.getSettings.mockResolvedValue(settings as never);
  api.postJourneyLocation.mockResolvedValue({ stored: 1, duplicates: 0, atDestination: false, arrived: false } as never);
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined', granted: false, canAskAgain: true });
});
afterEach(() => { act(() => tree?.unmount()); jest.useRealTimers(); });

describe('setting up a journey', () => {
  it('shows the plan BEFORE it runs, in "will try" words, and says contacts are not told about the journey', async () => {
    await open(null);
    expect(text()).toContain('Only you are asked.');
    expect(text()).toContain('will try to alert Maya, then Dad');
    expect(text()).toContain('not told about the journey itself');
    expect(text().toLowerCase()).not.toMatch(/will be notified|help is on/);
  });

  it('starts with the kind, the length and the position choice the person made, and shows the new journey', async () => {
    api.createJourney.mockResolvedValue(journey({ kind: 'ride' }) as never);
    await open(null);
    await act(async () => { control(/^Ride\./).props.onPress(); });
    await act(async () => { control('30 min').props.onPress(); });
    await act(async () => { control('Do not save my position').props.onPress(); });
    await act(async () => { control(/^Start the ride journey for 30 min/).props.onPress(); });
    await flush();
    const input = api.createJourney.mock.calls[0][0];
    expect(input).toMatchObject({ kind: 'ride', shareLocation: false });
    const ms = new Date(input.expectedArrivalAt).getTime() - Date.now();
    expect(ms).toBeGreaterThan(29 * 60_000);
    expect(ms).toBeLessThan(31 * 60_000);
    expect(text()).toContain('Ride in progress');
  });

  it('the Check-In entry opens it on a custom timer', async () => {
    await open(null, { kind: 'custom' });
    expect(control('Custom. A timer you set.')?.props.accessibilityState).toMatchObject({ selected: true });
  });

  it('cannot start when no contact has agreed, and says why, rather than start a journey nobody could be told about', async () => {
    api.getSettings.mockResolvedValue({ ...settings, trustedContacts: [{ id: 'c1', name: 'Maya', phone: '+1', consentStatus: 'waiting' }] } as never);
    await open(null);
    expect(text()).toContain('None of your contacts has agreed');
    expect(control(/^Start the/).props.disabled).toBe(true);
  });

  it('says what the server said when it refuses, and never shows a journey that was not created', async () => {
    api.createJourney.mockRejectedValue(new ApiError('You already have a journey in progress. Finish or cancel it first.', 'http', 409));
    await open(null);
    await act(async () => { control(/^Start the/).props.onPress(); });
    await flush();
    expect(text()).toContain('already have a journey in progress');
    expect(text()).not.toContain('Walk home in progress'); // no journey was shown
  });

  it('a network failure says so and keeps the form', async () => {
    api.createJourney.mockRejectedValue(new ApiError('x', 'network'));
    await open(null);
    await act(async () => { control(/^Start the/).props.onPress(); });
    await flush();
    expect(text()).toContain("Couldn't start the journey");
    expect(control(/^Start the/)).toBeDefined();
  });

  it('asks for location only from a button, never by itself', async () => {
    await open(null);
    expect((Location.requestForegroundPermissionsAsync as jest.Mock)).not.toHaveBeenCalled();
    expect(control('Allow Lumo to read your location while the app is open')).toBeDefined();
  });
});

describe('a running journey', () => {
  it('says when they should arrive, what happens if not (asked first, then who is tried), and that the server keeps it', async () => {
    await open(journey());
    expect(text()).toContain('Walk home in progress');
    expect(text()).toContain('Lumo will ask you first');
    expect(text()).toContain('will try to alert Maya, then Dad');
    expect(text()).toContain("server keeps this deadline even if your phone dies");
  });

  it('"I\'ve arrived" ends it, and the screen says only what the server answered', async () => {
    api.arriveJourney.mockResolvedValue(journey({ state: 'CLOSED' }) as never);
    await open(journey());
    await act(async () => { control("I've arrived. End the journey").props.onPress(); });
    await flush();
    expect(api.arriveJourney).toHaveBeenCalledWith('j1');
    expect(text()).toContain("Journey ended. You've arrived.");
  });

  it('a failed "I\'ve arrived" says it did not go and keeps the journey', async () => {
    api.arriveJourney.mockRejectedValue(new ApiError('x', 'network'));
    await open(journey());
    await act(async () => { control("I've arrived. End the journey").props.onPress(); });
    await flush();
    expect(text()).toContain("Couldn't end the journey");
    expect(text()).toContain('Walk home in progress');
  });

  it('"I need 15 more minutes" sends a new time about 15 minutes from now', async () => {
    api.checkInJourney.mockResolvedValue(journey() as never);
    await open(journey());
    await act(async () => { control('I need 15 more minutes').props.onPress(); });
    await flush();
    const ms = new Date(api.checkInJourney.mock.calls[0][1]).getTime() - Date.now();
    expect(ms).toBeGreaterThan(14 * 60_000);
    expect(ms).toBeLessThan(16 * 60_000);
  });

  it('cancelling says nobody is told, and ends it', async () => {
    api.cancelJourney.mockResolvedValue(journey({ state: 'CANCELLED' }) as never);
    await open(journey());
    expect(control('Cancel the journey. Nobody is told')).toBeDefined();
    await act(async () => { control('Cancel the journey. Nobody is told').props.onPress(); });
    await flush();
    expect(text()).toContain('Journey cancelled. Nobody was told.');
  });

  it('polls, and when a refresh fails keeps the journey on screen and says it is old and still kept', async () => {
    await open(journey());
    api.getActiveJourney.mockRejectedValue(new ApiError('x', 'network'));
    await flush(5000);
    expect(text()).toContain("Can't refresh right now");
    expect(text()).toContain('still being kept by Lumo');
    expect(text()).toContain('Walk home in progress');
  });

  it('moves to the question when the server says a check-in is due', async () => {
    await open(journey());
    api.getActiveJourney.mockResolvedValue(journey({ state: 'CHECK_IN_DUE', needsAnswer: true, checkInDueAt: iso(Date.now() - 1000) }) as never);
    await flush(5000);
    expect(text()).toContain('Are you OK?');
  });

  it('stops polling once it has ended', async () => {
    await open(journey({ state: 'CLOSED' }));
    const n = api.getActiveJourney.mock.calls.length;
    await flush(20_000);
    expect(api.getActiveJourney.mock.calls.length).toBe(n);
  });
});

describe('the question: are you OK?', () => {
  const asking = () => journey({ state: 'CHECK_IN_DUE', needsAnswer: true, checkInDueAt: iso(Date.now() - 30_000) });

  it('says only the person has been asked, and when contacts may start being tried, as an estimate', async () => {
    await open(asking());
    expect(text()).toContain('Are you OK?');
    expect(text()).toContain('Only you have been asked so far');
    expect(text()).toContain('may start trying to alert your contacts at about');
  });

  it('"I\'m OK" gives more time; the answer is not claimed until the server says so', async () => {
    api.checkInJourney.mockRejectedValue(new ApiError('x', 'network'));
    await open(asking());
    await act(async () => { control("I'm OK. Give me 15 more minutes").props.onPress(); });
    await flush();
    expect(text()).toContain("Couldn't send your answer");
    expect(text()).toContain('Are you OK?'); // still asking: it did not go
    api.checkInJourney.mockResolvedValue(journey() as never);
    await act(async () => { control("I'm OK. Give me 15 more minutes").props.onPress(); });
    await flush();
    expect(text()).toContain('Walk home in progress');
  });

  it('"I\'ve arrived" answers it too', async () => {
    api.arriveJourney.mockResolvedValue(journey({ state: 'CLOSED' }) as never);
    await open(asking());
    await act(async () => { control("I've arrived. End the journey").props.onPress(); });
    await flush();
    expect(text()).toContain('Journey ended');
  });
});

describe('after an alert went out', () => {
  const alerted = () => journey({ state: 'ALERTED', incidentId: 'inc-9' });

  it('says so, opens the incident (not a new SOS), and still lets them say they are safe', async () => {
    await open(alerted());
    expect(text()).toContain('A check-in went unanswered, so Lumo is trying to alert your contacts');
    await act(async () => { control('See who was alerted and call for help').props.onPress(); });
    expect(mockNavigate).toHaveBeenCalledWith('Emergency', { incidentId: 'inc-9' });
    expect(control(/^I'm safe/)).toBeDefined();
    expect(control("Cancel the journey. Nobody is told")).toBeUndefined(); // cancelling is not an option once an alert is out
  });
});

describe('the position, in plain view', () => {
  const granted = () => (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
  const watchWith = async () => {
    let onFix: (l: any) => void = () => undefined;
    (Location.watchPositionAsync as jest.Mock).mockImplementation(async (_o: any, cb: any) => { onFix = cb; return { remove: jest.fn() }; });
    // Fixes arrive seconds apart in life, so each is its own update here too (React batches updates made in one act).
    return async (n = 1) => { for (let i = 0; i < n; i++) await act(async () => { onFix({ coords: { latitude: 33.68 + i / 1000, longitude: 73.04, accuracy: 12 }, timestamp: Date.now() + i }); }); };
  };

  it('says it is not being saved when the person said no, or location is off', async () => {
    await open(journey({ shareLocation: false }));
    expect(text()).toContain('Not saved: you chose not to.');
    act(() => tree.unmount());
    await open(journey());
    expect(text()).toContain('Not being saved: location is off.');
  });

  it('saves fixes while Lumo is open, in batches, says so, and never sends an unknown accuracy', async () => {
    granted();
    const emit = await watchWith();
    await open(journey());
    await emit(5);
    await flush();
    expect(api.postJourneyLocation).toHaveBeenCalledTimes(1);
    const [id, batch] = api.postJourneyLocation.mock.calls[0];
    expect(id).toBe('j1');
    expect(batch).toHaveLength(5);
    expect(batch.every((f) => typeof f.accuracyM === 'number' && f.accuracyM >= 0)).toBe(true);
    expect(text()).toContain('Saved while Lumo is open');
  });

  it('keeps what it could not send and says so, then sends it', async () => {
    granted();
    const emit = await watchWith();
    api.postJourneyLocation.mockRejectedValueOnce(new ApiError('x', 'network'));
    await open(journey());
    await emit(5);
    await flush();
    expect(text()).toContain("can't reach Lumo right now (5 waiting)");
    await flush(30_000);
    expect(api.postJourneyLocation).toHaveBeenCalledTimes(2);
    expect(api.postJourneyLocation.mock.calls[1][1]).toHaveLength(5);
  });

  it('"Stop saving my position" stops it, and says so', async () => {
    granted();
    const emit = await watchWith();
    await open(journey());
    await act(async () => { control('Stop saving my position for this journey').props.onPress(); });
    await emit(6);
    await flush(30_000);
    expect(api.postJourneyLocation).not.toHaveBeenCalled();
    expect(text()).toContain('Not being saved: you stopped it.');
  });

  it('saves nothing once the journey has ended', async () => {
    granted();
    const emit = await watchWith();
    await open(journey({ state: 'CLOSED' }));
    await emit(6);
    await flush(30_000);
    expect(api.postJourneyLocation).not.toHaveBeenCalled();
  });
});
