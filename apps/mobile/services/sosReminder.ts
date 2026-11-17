import * as Notifications from 'expo-notifications';

/**
 * The reminder for an SOS Lumo could not send (docs/specs/OFFLINE_SOS.md). It is the ONLY thing that can reach a person whose app was
 * closed while the alert was waiting for a signal, and it is a reminder, not a send: it says nothing has been sent and asks them to open
 * Lumo or call. It is scheduled when the first try fails, and cancelled the moment Lumo has the incident, or the person cancels.
 *
 * Never throws and never blocks: without notification permission there is simply no reminder, and the screen does not claim one.
 */
let scheduledId: string | null = null;

export async function scheduleSosReminder(afterSeconds: number): Promise<void> {
  try {
    await cancelSosReminder();
    scheduledId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Your alert has not been sent',
        body: 'Lumo could not reach its server. Open Lumo to keep trying, or call your local emergency number.',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.max(5, Math.round(afterSeconds)) },
    });
  } catch { /* no permission, or the module is unavailable: no reminder, and nothing claims one */ }
}

export async function cancelSosReminder(): Promise<void> {
  const id = scheduledId;
  scheduledId = null;
  if (!id) return;
  try { await Notifications.cancelScheduledNotificationAsync(id); } catch { /* already gone */ }
}
