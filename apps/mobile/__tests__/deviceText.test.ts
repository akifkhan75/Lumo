import * as SMS from 'expo-sms';
import { openOfflineText } from '../services/deviceText';

const sms = SMS as jest.Mocked<typeof SMS>;
const contacts = [{ id: 'a', name: 'Maya', phone: '+923001234500' }, { id: 'b', name: 'Dad', phone: '+923001234501' }];

beforeEach(() => {
  jest.clearAllMocks();
  (sms.isAvailableAsync as jest.Mock).mockResolvedValue(true);
  (sms.sendSMSAsync as jest.Mock).mockResolvedValue({ result: 'unknown' });
});

describe('opening the phone\'s own composer', () => {
  it('addresses every contact with the written body, and sends nothing itself', async () => {
    await openOfflineText(contacts, 'the words');
    expect(sms.sendSMSAsync).toHaveBeenCalledWith(['+923001234500', '+923001234501'], 'the words');
  });
  it('reports only what the composer reported', async () => {
    (sms.sendSMSAsync as jest.Mock).mockResolvedValueOnce({ result: 'sent' });
    expect(await openOfflineText(contacts, 'x')).toBe('sent');
    (sms.sendSMSAsync as jest.Mock).mockResolvedValueOnce({ result: 'cancelled' });
    expect(await openOfflineText(contacts, 'x')).toBe('cancelled');
    (sms.sendSMSAsync as jest.Mock).mockResolvedValueOnce({ result: 'unknown' });
    expect(await openOfflineText(contacts, 'x')).toBe('unknown');
  });
  it('with nobody to address it to, opens nothing', async () => {
    expect(await openOfflineText([], 'x')).toBe('no_contacts');
    expect(sms.sendSMSAsync).not.toHaveBeenCalled();
  });
  it('on a phone with no composer, says so and opens nothing', async () => {
    (sms.isAvailableAsync as jest.Mock).mockResolvedValue(false);
    expect(await openOfflineText(contacts, 'x')).toBe('unavailable');
    expect(sms.sendSMSAsync).not.toHaveBeenCalled();
  });
  it('never throws, whatever the native module does', async () => {
    (sms.isAvailableAsync as jest.Mock).mockRejectedValue(new Error('native'));
    expect(await openOfflineText(contacts, 'x')).toBe('error');
    (sms.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    (sms.sendSMSAsync as jest.Mock).mockRejectedValue(new Error('native'));
    expect(await openOfflineText(contacts, 'x')).toBe('error');
  });
});
