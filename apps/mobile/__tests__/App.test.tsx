/**
 * @format
 *
 * Milestone 1.0 — SOS must be reachable at all.
 *
 * These render the real App with the real navigator. The only things replaced
 * are the network (`apiService`) and the phone's dialler. They exist because
 * the dashboard once gated the entire screen on a settings fetch (KI-27): a
 * slow or failed request left someone with a spinner and no way to reach help,
 * and nothing in the suite noticed, because App.tsx was excluded from coverage
 * and its only test stopped at the login screen.
 */

import React from 'react';
import { Linking } from 'react-native';
import renderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { ApiError } from '@lumo/api-client';
import App from '../App';
import * as apiService from '../services/apiService';

jest.mock('../services/apiService');

const api = apiService as jest.Mocked<typeof apiService>;

// The hands-free triggers are off so no sensor listeners are involved.
const settings: any = {
  personalInfo: { fullName: 'Josim', bloodType: 'O+', allergies: '' },
  trustedContacts: [],
  security: {
    locationSharingEnabled: true,
    shareLocationOnSos: true,
    sendSmsOnSos: false,
    shakeToSosEnabled: false,
    voiceActivationEnabled: false,
    accidentDetectionEnabled: false,
  },
};

const LABEL = {
  sos: 'Emergency. Opens the emergency screen and phone dialler',
  help: 'Emergency help. Opens the emergency screen and phone dialler',
  dialler: 'Open the phone dialler to call your local emergency number',
  retry: 'Try loading your settings again',
  close: 'Close the emergency screen',
};

const neverResolves = () => new Promise<never>(() => {});
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('App: the emergency path does not depend on anything else', () => {
  let tree: ReactTestRenderer;
  let openURL: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  const flush = async () => { await act(async () => { await Promise.resolve(); }); };
  const render = async () => {
    await act(async () => { tree = renderer.create(<App />); });
    await flush();
  };

  const dump = () => JSON.stringify(tree.toJSON());
  const has = (text: string) => dump().includes(text);
  const control = (label: string) => {
    const hit = tree.root.findAll(
      (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function',
    );
    return hit[0];
  };
  const tap = async (label: string) => {
    const target = control(label);
    if (!target) throw new Error(`No control labelled "${label}" on screen`);
    await act(async () => { target.props.onPress(); });
    await flush();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    api.restoreSession.mockResolvedValue(false);
    api.signOut.mockResolvedValue(undefined);
    api.getSelfDefenseTips.mockResolvedValue([]);
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    // The app logs the request failures these tests provoke on purpose.
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => { tree?.unmount(); });
    openURL.mockRestore();
    consoleError.mockRestore();
  });

  // ---------------------------------------------------------------- the exit

  describe('exit criterion: a cold launch with the API down reaches the dialler in two taps or fewer', () => {
    it('signed out', async () => {
      api.restoreSession.mockResolvedValue(false);
      await render();

      expect(has('Stay Safe')).toBe(true);           // the first screen they see
      await tap(LABEL.help);                          // tap 1
      expect(has('Nothing has been sent')).toBe(true);
      await tap(LABEL.dialler);                       // tap 2
      expect(openURL).toHaveBeenCalledWith('tel:');
    });

    it('signed in, with the settings request hanging forever', async () => {
      api.restoreSession.mockResolvedValue(true);
      api.getSettings.mockImplementation(neverResolves);
      await render();

      await tap(LABEL.sos);                           // tap 1
      expect(has('Nothing has been sent')).toBe(true);
      await tap(LABEL.dialler);                       // tap 2
      expect(openURL).toHaveBeenCalledWith('tel:');
    });

    it('signed in, with the settings request failing', async () => {
      api.restoreSession.mockResolvedValue(true);
      api.getSettings.mockRejectedValue(new ApiError('Network request failed', 'network'));
      await render();

      await tap(LABEL.sos);
      await tap(LABEL.dialler);
      expect(openURL).toHaveBeenCalledWith('tel:');
    });
  });

  // ------------------------------------------------------- the boot state

  it('carries an emergency control while the stored session is still being read', async () => {
    api.restoreSession.mockImplementation(neverResolves);
    await render();

    expect(has('Restoring your session')).toBe(true);
    await tap(LABEL.help);
    expect(has('Nothing has been sent')).toBe(true);
  });

  it('does not strand the user on the emergency screen when the session finishes restoring under them', async () => {
    const restoring = deferred<boolean>();
    api.restoreSession.mockReturnValue(restoring.promise);
    api.getSettings.mockImplementation(neverResolves);
    await render();

    await tap(LABEL.help);                       // opened from the boot screen
    expect(has('Nothing has been sent')).toBe(true);

    await act(async () => { restoring.resolve(true); });
    await flush();
    expect(has('Nothing has been sent')).toBe(true);   // not moved off it

    await tap(LABEL.close);                      // and Close has somewhere to go
    expect(control(LABEL.sos)).toBeDefined();
    expect(has('Nothing has been sent')).toBe(false);
  });

  it('treats a failure reading the stored session as signed out, not a crash', async () => {
    api.restoreSession.mockRejectedValue(new Error('keychain unavailable'));
    await render();

    expect(has('Stay Safe')).toBe(true);
    expect(control(LABEL.help)).toBeDefined();
  });

  // --------------------------------------------------- the dashboard, no settings

  describe('the dashboard without settings', () => {
    beforeEach(() => { api.restoreSession.mockResolvedValue(true); });

    it('shows the SOS control from the first frame, while settings are loading', async () => {
      api.getSettings.mockImplementation(neverResolves);
      await render();

      expect(control(LABEL.sos)).toBeDefined();
      expect(has('Loading your settings')).toBe(true);
    });

    it('says plainly that hands-free triggers are off, and does not say SOS sends anything', async () => {
      api.getSettings.mockRejectedValue(new ApiError('Network request failed', 'network'));
      await render();

      expect(has('Shake, voice and crash triggers are off until your settings load')).toBe(true);
      // What the SOS button does, no more: it opens a screen and a dialler.
      expect(has('opens the emergency screen and phone dialler')).toBe(true);
      expect(has('alert sent')).toBe(false);
    });

    it('retries only when asked, and does not loop on its own', async () => {
      api.getSettings.mockRejectedValue(new ApiError('Network request failed', 'network'));
      await render();
      expect(api.getSettings).toHaveBeenCalledTimes(1);

      // Let any scheduled work run. Nothing should refetch by itself.
      await flush(); await flush();
      expect(api.getSettings).toHaveBeenCalledTimes(1);

      await tap(LABEL.retry);
      expect(api.getSettings).toHaveBeenCalledTimes(2);
    });

    it('recovers when a retry succeeds', async () => {
      api.getSettings
        .mockRejectedValueOnce(new ApiError('Network request failed', 'network'))
        .mockResolvedValueOnce(settings);
      await render();
      expect(has("Couldn't load your settings")).toBe(true);

      await tap(LABEL.retry);

      expect(has('Hello Josim')).toBe(true);
      expect(has("Couldn't load your settings")).toBe(false);
      expect(control(LABEL.retry)).toBeUndefined();
    });

    it('still opens the emergency screen once settings have loaded', async () => {
      api.getSettings.mockResolvedValue(settings);
      await render();

      await tap(LABEL.sos);
      expect(has('Nothing has been sent')).toBe(true);
      expect(has('O+')).toBe(true); // the saved blood type is passed through
    });
  });

  // ------------------------------------------- only a real 401 ends a session

  describe('only the server rejecting the token signs anyone out', () => {
    beforeEach(() => { api.restoreSession.mockResolvedValue(true); });

    it.each([
      ['a timeout', new ApiError('timed out', 'timeout')],
      ['a dropped connection', new ApiError('Network request failed', 'network')],
      ['a 5xx', new ApiError('Service unavailable', 'http', 503)],
      ['a non-API error', new Error('boom')],
    ])('keeps the session on %s', async (_name, failure) => {
      api.getSettings.mockRejectedValue(failure);
      await render();

      expect(api.signOut).not.toHaveBeenCalled();
      expect(control(LABEL.sos)).toBeDefined();
      expect(has('Stay Safe')).toBe(false);
    });

    it('signs out on a 401, clearing the stored token', async () => {
      api.getSettings.mockRejectedValue(new ApiError('Unauthorized', 'http', 401));
      await render();

      expect(api.signOut).toHaveBeenCalledTimes(1);
      expect(has('Stay Safe')).toBe(true);
      // Signed out is not stranded: the login screen carries the emergency control.
      expect(control(LABEL.help)).toBeDefined();
    });

    it('does not move the user off the emergency screen when a 401 lands while they are on it', async () => {
      const pending = deferred<any>();
      api.getSettings.mockReturnValue(pending.promise);
      await render();

      await tap(LABEL.sos);
      expect(has('Nothing has been sent')).toBe(true);

      // The session expires while they are looking at the emergency screen.
      await act(async () => { pending.reject(new ApiError('Unauthorized', 'http', 401)); });
      await flush();

      expect(api.signOut).toHaveBeenCalledTimes(1);
      expect(has('Nothing has been sent')).toBe(true);
      // And the dialler still works from where they are.
      await tap(LABEL.dialler);
      expect(openURL).toHaveBeenCalledWith('tel:');

      // Leaving the emergency screen lands on login, not on a dead end.
      await tap(LABEL.close);
      expect(has('Stay Safe')).toBe(true);
    });
  });
});

describe('App: location on the dashboard', () => {
  it('is off at launch, does not ask the OS by itself, and claims no sharing', async () => {
    const Location = require('expo-location');
    api.restoreSession.mockResolvedValue(true);
    api.getSettings.mockImplementation(() => new Promise<never>(() => {}));
    let tree!: ReactTestRenderer;
    await act(async () => { tree = renderer.create(<App />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('Location is off');
    expect(text).toContain('shares it with no one');
    expect(text).not.toContain('does not read your position yet');
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    act(() => { tree.unmount(); });
  });
});

describe('App: the dashboard map', () => {
  const Location = require('expo-location');
  const flushAll = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  const mountSignedIn = async () => {
    api.restoreSession.mockResolvedValue(true);
    api.getSettings.mockImplementation(() => new Promise<never>(() => {}));
    let tree!: ReactTestRenderer;
    await act(async () => { tree = renderer.create(<App />); });
    await flushAll();
    return tree;
  };
  const byId = (t: ReactTestRenderer, id: string) => t.root.findAll((n) => n.props.testID === id && typeof n.type === 'string');

  it('renders a real map, no marker and no accuracy circle, and says the position is not known', async () => {
    const tree = await mountSignedIn();
    expect(byId(tree, 'map').length).toBe(1);
    expect(byId(tree, 'map-marker').length).toBe(0);
    expect(byId(tree, 'map-circle').length).toBe(0);
    expect(JSON.stringify(tree.toJSON())).toContain("Your position isn't known");
    act(() => { tree.unmount(); });
  });

  it('draws the marker and accuracy circle only once there is a real fix', async () => {
    let onFix: (l: any) => void = () => {};
    Location.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
    Location.watchPositionAsync.mockImplementation(async (_o: any, cb: any) => { onFix = cb; return { remove: jest.fn() }; });
    const tree = await mountSignedIn();
    expect(byId(tree, 'map-marker').length).toBe(0);

    await act(async () => { onFix({ coords: { latitude: 31.5, longitude: 74.3, accuracy: 18 }, timestamp: Date.now() }); });
    expect(byId(tree, 'map-marker').length).toBe(1);
    expect(byId(tree, 'map-circle')[0].props.radius).toBe(18);
    act(() => { tree.unmount(); });
  });

  it('draws no hazard report (that is a deliberate Phase 4 change)', async () => {
    const tree = await mountSignedIn();
    // The dashboard does not even fetch them: pins are Phase 4, with their own age/confidence rules.
    expect(api.getHazardReports).not.toHaveBeenCalled();
    expect(byId(tree, 'map-marker').length).toBe(0);
    act(() => { tree.unmount(); });
  });

  it('no longer says the map is a picture or the avatar is not you', async () => {
    const tree = await mountSignedIn();
    expect(JSON.stringify(tree.toJSON())).not.toContain('static picture');
    act(() => { tree.unmount(); });
  });
});
