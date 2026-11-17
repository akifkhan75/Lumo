import * as Notifications from 'expo-notifications';
import { cancelSosReminder, scheduleSosReminder } from '../services/sosReminder';

const n = Notifications as jest.Mocked<typeof Notifications>;
beforeEach(async () => {
  await cancelSosReminder(); // the module remembers the last id: start every test with none
  jest.clearAllMocks();
  (n.scheduleNotificationAsync as jest.Mock).mockResolvedValue('r1');
  (n.cancelScheduledNotificationAsync as jest.Mock).mockResolvedValue(undefined);
});

describe('the SOS reminder', () => {
  it('says nothing has been sent and asks to open Lumo or call', async () => {
    await scheduleSosReminder(20);
    const arg = (n.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.content.title).toBe('Your alert has not been sent');
    expect(arg.content.body).toContain('Open Lumo');
    expect(arg.trigger).toEqual({ type: 'timeInterval', seconds: 20 });
  });
  it('is never sooner than 5 seconds', async () => {
    await scheduleSosReminder(0);
    expect((n.scheduleNotificationAsync as jest.Mock).mock.calls[0][0].trigger.seconds).toBe(5);
  });
  it('replaces an earlier one and cancels it on request', async () => {
    await scheduleSosReminder(20);
    await scheduleSosReminder(30);
    expect(n.cancelScheduledNotificationAsync).toHaveBeenCalledWith('r1');
    await cancelSosReminder();
    expect(n.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
    await cancelSosReminder(); // nothing left: no second cancel
    expect(n.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
  });
  it('never throws when notifications are unavailable', async () => {
    (n.scheduleNotificationAsync as jest.Mock).mockRejectedValue(new Error('no permission'));
    await expect(scheduleSosReminder(20)).resolves.toBeUndefined();
    (n.cancelScheduledNotificationAsync as jest.Mock).mockRejectedValue(new Error('x'));
    await expect(cancelSosReminder()).resolves.toBeUndefined();
  });
});
