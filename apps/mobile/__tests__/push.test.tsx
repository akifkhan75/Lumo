import React from 'react';
import { Linking } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { ApiError } from '@lumo/api-client';
import ContactRoleScreen from '../components/settings/ContactRole';
import ContactAlertScreen from '../components/ContactAlert';
import * as api from '../services/apiService';
import { disablePush, enablePush, lastAlertTap, listenForAlerts, readPushStatus, reportReceived, RESPOND_ACTION } from '../services/pushService';

jest.mock('../services/apiService');
const mockApi = api as jest.Mocked<typeof api>;
const N = Notifications as jest.Mocked<typeof Notifications>;

let mockParams: any = {};
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));

const TOKEN = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo';
const withProject = (id: string | undefined) => { (Constants as any).expoConfig = { extra: id ? { eas: { projectId: id } } : {} }; };
const granted = { granted: true, status: 'granted', canAskAgain: true } as any;

beforeEach(() => {
  jest.clearAllMocks();
  withProject('proj-123');
  N.getPermissionsAsync.mockResolvedValue({ granted: false, status: 'undetermined', canAskAgain: true } as any);
  N.requestPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: false } as any);
  N.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abcdefghijklmnopqrstuv]' } as any);
  mockApi.loadPushDeviceId.mockResolvedValue(null as never);
  mockApi.registerPushDevice.mockResolvedValue('dev-1' as never);
  mockApi.revokePushDevice.mockResolvedValue(undefined as never);
});

describe('pushService', () => {
  it('without a push project it says so and never asks for permission', async () => {
    withProject(undefined);
    expect(await readPushStatus()).toBe('not_configured');
    expect(await enablePush()).toBe('not_configured');
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reading the status never prompts', async () => {
    expect(await readPushStatus()).toBe('off');
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it.each([
    [{ granted: false, status: 'denied', canAskAgain: true }, 'denied'],
    [{ granted: false, status: 'denied', canAskAgain: false }, 'blocked'],
  ])('status for %j is %s', async (perm, expected) => {
    N.getPermissionsAsync.mockResolvedValue(perm as any);
    expect(await readPushStatus()).toBe(expected);
  });

  it('is "on" only with permission AND a registered device', async () => {
    N.getPermissionsAsync.mockResolvedValue(granted);
    expect(await readPushStatus()).toBe('off');
    mockApi.loadPushDeviceId.mockResolvedValue('dev-1' as never);
    expect(await readPushStatus()).toBe('on');
  });

  it('enabling asks, then registers the token with the server, and only then says on', async () => {
    N.requestPermissionsAsync.mockResolvedValue(granted);
    expect(await enablePush()).toBe('on');
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-123' });
    expect(mockApi.registerPushDevice).toHaveBeenCalledWith(expect.objectContaining({ pushToken: 'ExponentPushToken[abcdefghijklmnopqrstuv]', platform: expect.stringMatching(/ios|android/) }));
  });

  it('a refused permission registers nothing; "blocked" when the system will not ask again', async () => {
    expect(await enablePush()).toBe('blocked');
    expect(mockApi.registerPushDevice).not.toHaveBeenCalled();
    N.requestPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: true } as any);
    expect(await enablePush()).toBe('denied');
  });

  it('a registration that fails is "failed", not "on"', async () => {
    N.requestPermissionsAsync.mockResolvedValue(granted);
    mockApi.registerPushDevice.mockRejectedValue(new ApiError('x', 'network'));
    expect(await enablePush()).toBe('failed');
    N.getExpoPushTokenAsync.mockRejectedValue(new Error('no google play services'));
    expect(await enablePush()).toBe('failed');
  });

  it('disabling revokes the registration on the server', async () => {
    await disablePush();
    expect(mockApi.revokePushDevice).toHaveBeenCalled();
  });

  it('reportReceived never throws, and says null when the server could not be told', async () => {
    mockApi.postNotificationReceipt.mockRejectedValue(new ApiError('x', 'network'));
    expect(await reportReceived('a1', 'delivered')).toBeNull();
    mockApi.postNotificationReceipt.mockResolvedValue({ recorded: true } as never);
    expect(await reportReceived('a1', 'delivered')).toEqual({ recorded: true });
  });

  describe('listening', () => {
    const notif = (data: any, title = 'Lumo alert', body = 'Joyce asked Lumo to alert you.') => ({ request: { content: { title, body, data } } }) as any;
    const handlers = () => ({
      received: N.addNotificationReceivedListener.mock.calls[0][0] as (n: any) => void,
      response: N.addNotificationResponseReceivedListener.mock.calls[0][0] as (r: any) => void,
    });

    it('a notification that arrives while the app is open is reported DELIVERED', () => {
      listenForAlerts(jest.fn());
      handlers().received(notif({ attemptId: 'a1' }));
      expect(mockApi.postNotificationReceipt).toHaveBeenCalledWith('a1', 'delivered');
    });

    it('a notification without an attempt id is ignored: nothing is reported for it', () => {
      listenForAlerts(jest.fn());
      handlers().received(notif({}));
      handlers().received(notif({ attemptId: 42 }));
      expect(mockApi.postNotificationReceipt).not.toHaveBeenCalled();
    });

    it('a tap reports delivered and opens the alert; it does NOT acknowledge', () => {
      const open = jest.fn();
      listenForAlerts(open);
      handlers().response({ notification: notif({ attemptId: 'a1' }), actionIdentifier: 'expo.modules.notifications.actions.DEFAULT' });
      expect(mockApi.postNotificationReceipt).toHaveBeenCalledWith('a1', 'delivered');
      expect(mockApi.postNotificationReceipt).not.toHaveBeenCalledWith('a1', 'acknowledged');
      expect(open).toHaveBeenCalledWith({ attemptId: 'a1', title: 'Lumo alert', body: 'Joyce asked Lumo to alert you.', responded: false });
    });

    it('the "I\'m responding" button reports delivered AND acknowledged', () => {
      listenForAlerts(jest.fn());
      handlers().response({ notification: notif({ attemptId: 'a1' }), actionIdentifier: RESPOND_ACTION });
      expect(mockApi.postNotificationReceipt).toHaveBeenCalledWith('a1', 'delivered');
      expect(mockApi.postNotificationReceipt).toHaveBeenCalledWith('a1', 'acknowledged');
    });

    it('stopping removes both listeners', () => {
      const r1 = { remove: jest.fn() }; const r2 = { remove: jest.fn() };
      N.addNotificationReceivedListener.mockReturnValueOnce(r1 as any);
      N.addNotificationResponseReceivedListener.mockReturnValueOnce(r2 as any);
      listenForAlerts(jest.fn())();
      expect(r1.remove).toHaveBeenCalled();
      expect(r2.remove).toHaveBeenCalled();
    });

    it('an alert the app was opened by is found; none, or a fault, is null', async () => {
      N.getLastNotificationResponseAsync.mockResolvedValueOnce({ notification: notif({ attemptId: 'a9' }), actionIdentifier: RESPOND_ACTION } as any);
      expect(await lastAlertTap()).toMatchObject({ attemptId: 'a9', responded: true });
      expect(await lastAlertTap()).toBeNull();
      N.getLastNotificationResponseAsync.mockRejectedValueOnce(new Error('x'));
      expect(await lastAlertTap()).toBeNull();
    });
  });
});

describe('the "Being a contact" screen', () => {
  let tree: renderer.ReactTestRenderer;
  const text = () => JSON.stringify(tree.toJSON());
  const button = (label: string) => tree.root.findAll((n) => typeof n.props.onPress === 'function' && n.props.accessibilityLabel === label)[0];
  const open = async (params: any = {}) => {
    mockParams = params;
    await act(async () => { tree = renderer.create(<ContactRoleScreen />); });
    await act(async () => { await Promise.resolve(); });
  };
  afterEach(() => act(() => tree?.unmount()));

  it('does not ask for permission just by opening', async () => {
    await open();
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(text()).toContain('Alerts on this phone are off.');
  });

  it('turning alerts on asks, registers, and then says on', async () => {
    N.requestPermissionsAsync.mockResolvedValue(granted);
    await open();
    await act(async () => { button('Turn on alerts on this phone').props.onPress(); });
    await act(async () => { await Promise.resolve(); });
    mockApi.loadPushDeviceId.mockResolvedValue('dev-1' as never);
    expect(mockApi.registerPushDevice).toHaveBeenCalled();
    expect(text()).toContain('Alerts on this phone are on.');
    expect(button('Turn off alerts on this phone')).toBeDefined();
  });

  it('a build with no push project says so instead of offering a button that cannot work', async () => {
    withProject(undefined);
    await open();
    expect(text()).toContain("can't receive alerts yet");
    expect(button('Turn on alerts on this phone')).toBeUndefined();
  });

  it('when the system will not ask again it routes to Settings', async () => {
    N.getPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: false } as any);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await open();
    await act(async () => { button("Open this app's settings to turn on notifications").props.onPress(); });
    expect(openSettings).toHaveBeenCalled();
  });

  describe('joining with a link', () => {
    const type = (v: string) => act(() => { tree.root.findAll((n) => n.props.placeholder === 'Paste the link')[0].props.onChangeText(v); });
    const join = async () => { await act(async () => { button('Join as their contact').props.onPress(); }); await act(async () => { await Promise.resolve(); }); };

    it('sends only the token, taken from the pasted link, and says what it did and did not do', async () => {
      mockApi.claimContactInvite.mockResolvedValue({ claimed: true } as never);
      await open();
      type(`https://api.example/api/v1/contacts/invites/${TOKEN}`);
      await join();
      expect(mockApi.claimContactInvite).toHaveBeenCalledWith(TOKEN);
      expect(text()).toContain("You've joined as their contact");
      expect(text()).toContain('Nothing has been sent to you');
    });

    it('prefills from an app link', async () => {
      await open({ token: TOKEN });
      expect(text()).toContain(TOKEN);
    });

    it('something that is not a link is refused before any request', async () => {
      await open();
      type('hello');
      await join();
      expect(mockApi.claimContactInvite).not.toHaveBeenCalled();
      expect(text()).toContain("doesn't look like a Lumo link");
    });

    it.each([
      [new ApiError('x', 'http', 404), "isn't valid, or it has run out"],
      [new ApiError('This link has already been claimed by another account.', 'http', 409), 'already been claimed'],
      [new ApiError('x', 'http', 401), 'Sign in first'],
      [new ApiError('x', 'network'), "Couldn't reach Lumo"],
    ])('says why it did not work (%#)', async (err, words) => {
      mockApi.claimContactInvite.mockRejectedValue(err);
      await open();
      type(TOKEN);
      await join();
      expect(text()).toContain(words);
      expect(text()).not.toContain("You've joined");
    });
  });
});

describe('the alert screen', () => {
  let tree: renderer.ReactTestRenderer;
  const text = () => JSON.stringify(tree.toJSON());
  const respond = () => tree.root.findAll((n) => typeof n.props.onPress === 'function' && /I'm responding/.test(String(n.props.accessibilityLabel)))[0];
  const open = async (params: any) => { mockParams = params; await act(async () => { tree = renderer.create(<ContactAlertScreen />); }); };
  afterEach(() => act(() => tree?.unmount()));

  it('shows who asked, and tells them nothing until the server answers', async () => {
    await open({ attemptId: 'a1', title: 'Lumo alert', body: 'Joyce asked Lumo to alert you.', responded: false });
    expect(text()).toContain('Joyce asked Lumo to alert you.');
    expect(text()).toContain('Lumo does not contact emergency services');
    expect(text()).not.toContain('Your answer was sent');
  });

  it('"I\'m responding" is reported, and the screen says only what the server said', async () => {
    mockApi.postNotificationReceipt.mockResolvedValue({ recorded: true } as never);
    await open({ attemptId: 'a1', title: 't', body: 'b', responded: false });
    await act(async () => { respond().props.onPress(); });
    expect(mockApi.postNotificationReceipt).toHaveBeenCalledWith('a1', 'acknowledged');
    expect(text()).toContain('Your answer was sent');
    expect(respond()).toBeUndefined();
  });

  it('an answer that was already recorded says so; an unreachable server says it did not go, and lets them try again', async () => {
    mockApi.postNotificationReceipt.mockResolvedValueOnce({ recorded: false } as never);
    await open({ attemptId: 'a1', title: 't', body: 'b', responded: false });
    await act(async () => { respond().props.onPress(); });
    expect(text()).toContain('already been recorded');
    act(() => tree.unmount());

    mockApi.postNotificationReceipt.mockRejectedValue(new ApiError('x', 'network'));
    await open({ attemptId: 'a1', title: 't', body: 'b', responded: false });
    await act(async () => { respond().props.onPress(); });
    expect(text()).toContain("Couldn't send your answer");
    expect(respond()).toBeDefined();
  });

  it('opened after tapping the notification button, it already says the answer was sent', async () => {
    await open({ attemptId: 'a1', title: 't', body: 'b', responded: true });
    expect(text()).toContain('Your answer was sent');
  });
});

describe('the Android channel', () => {
  it('is created before the token is asked for, on Android only', async () => {
    const { Platform } = require('react-native');
    const original = Platform.OS;
    Platform.OS = 'android';
    N.requestPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted', canAskAgain: true } as any);
    const order: string[] = [];
    N.setNotificationChannelAsync.mockImplementation(async () => { order.push('channel'); return undefined as any; });
    N.getExpoPushTokenAsync.mockImplementation(async () => { order.push('token'); return { data: 'ExponentPushToken[abcdefghijklmnopqrstuv]' } as any; });
    await enablePush();
    expect(order).toEqual(['channel', 'token']);
    Platform.OS = original;
  });
});
