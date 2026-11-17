import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as api from './apiService';

/**
 * Being reachable by push (docs/specs/NOTIFICATIONS.md).
 *
 * This is how a CONTACT's phone gets alerts: a push token registered against their signed-in account, which the server
 * links to a contact only when they have claimed that contact's link. The permission prompt appears ONLY from
 * `enablePush`, which a button calls; nothing here asks at launch.
 *
 * What it can and cannot say about delivery: a notification that arrives while the app is open, or is tapped, is
 * REPORTED as received (`reportReceived`). A notification that arrives while the app is closed cannot be reported by
 * this code (that needs a background task, and on iOS the notification service extension of milestone 1.16), so the
 * sender will record it as "sent, not confirmed". That is true, not a failure.
 */

export type PushStatus =
  | 'not_configured' // no EAS project id: this build cannot obtain a push token at all
  | 'off'            // never turned on
  | 'denied'         // refused, but the system will ask again
  | 'blocked'        // refused and the system will not ask again
  | 'on'
  | 'failed';        // asked and granted, but registering did not work

export const ALERT_CHANNEL = 'alerts';
export const ALERT_CATEGORY = 'lumo-alert';
export const RESPOND_ACTION = 'respond';

const projectId = (): string | undefined =>
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;

/** Foreground presentation, the Android channel, and the "I'm responding" action. Safe to call repeatedly. */
export async function prepareNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(ALERT_CHANNEL, {
        name: 'Alerts from people who chose you as a contact',
        importance: Notifications.AndroidImportance.MAX,
      });
    }
    await Notifications.setNotificationCategoryAsync(ALERT_CATEGORY, [
      { identifier: RESPOND_ACTION, buttonTitle: "I'm responding", options: { opensAppToForeground: true } },
    ]);
  } catch {
    /* alerts still arrive; only the channel styling and the action button are missing */
  }
}

export async function readPushStatus(): Promise<PushStatus> {
  if (!projectId()) return 'not_configured';
  try {
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted) return p.status === 'undetermined' ? 'off' : p.canAskAgain ? 'denied' : 'blocked';
  } catch {
    return 'off';
  }
  return (await api.loadPushDeviceId()) ? 'on' : 'off';
}

/** Ask the system for permission, get this phone's token, and register it. Call ONLY from a button. */
export async function enablePush(): Promise<PushStatus> {
  const id = projectId();
  if (!id) return 'not_configured';
  try {
    let p = await Notifications.getPermissionsAsync();
    if (!p.granted) p = await Notifications.requestPermissionsAsync();
    if (!p.granted) return p.canAskAgain ? 'denied' : 'blocked';
    await prepareNotifications(); // the Android channel must exist before a token is requested
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await api.registerPushDevice({ platform: Platform.OS === 'ios' ? 'ios' : 'android', osVersion: String(Platform.Version), pushToken: data });
    return 'on';
  } catch {
    return 'failed';
  }
}

export async function disablePush(): Promise<void> {
  await api.revokePushDevice();
}

/** What this phone tells the server about an alert it actually has in its hands. Best effort; never throws. */
export async function reportReceived(attemptId: string, kind: 'delivered' | 'acknowledged'): Promise<{ recorded: boolean } | null> {
  try {
    return await api.postNotificationReceipt(attemptId, kind);
  } catch {
    return null;
  }
}

export interface AlertTap { attemptId: string; title: string; body: string; responded: boolean }

const asTap = (n: Notifications.Notification, actionId?: string): AlertTap | null => {
  const attemptId = (n.request.content.data as { attemptId?: unknown } | undefined)?.attemptId;
  if (typeof attemptId !== 'string') return null;
  return { attemptId, title: n.request.content.title ?? 'Lumo', body: n.request.content.body ?? '', responded: actionId === RESPOND_ACTION };
};

/**
 * Listen for alerts. Receiving or being tapped is reported as DELIVERED; the "I'm responding" button is reported as
 * ACKNOWLEDGED; a tap on the body opens the alert screen. Returns a function that stops listening.
 */
export function listenForAlerts(onOpen: (tap: AlertTap) => void): () => void {
  const received = Notifications.addNotificationReceivedListener(n => {
    const tap = asTap(n);
    if (tap) reportReceived(tap.attemptId, 'delivered');
  });
  const responded = Notifications.addNotificationResponseReceivedListener(r => {
    const tap = asTap(r.notification, r.actionIdentifier);
    if (!tap) return;
    reportReceived(tap.attemptId, 'delivered');
    if (tap.responded) reportReceived(tap.attemptId, 'acknowledged');
    onOpen(tap);
  });
  return () => { received.remove(); responded.remove(); };
}

/** An alert tapped while the app was closed: it is the response the app was opened with. */
export async function lastAlertTap(): Promise<AlertTap | null> {
  try {
    const r = await Notifications.getLastNotificationResponseAsync();
    return r ? asTap(r.notification, r.actionIdentifier) : null;
  } catch {
    return null;
  }
}
