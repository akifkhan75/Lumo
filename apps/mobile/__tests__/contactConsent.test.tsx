import React from 'react';
import { Share } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import ContactSettingsScreen from '../components/settings/ContactSettings';
import * as apiService from '../services/apiService';
import { CONSENT_LABEL, inviteMessage } from '../services/consentStatus';

jest.mock('../services/apiService');
const api = apiService as jest.Mocked<typeof apiService>;

const mockGoBack = jest.fn();
let mockRouteParams: any = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack }),
  useRoute: () => ({ params: mockRouteParams }),
}));

const settings = (status: any = 'not_invited'): any => ({
  personalInfo: { fullName: 'Joyce', bloodType: '', allergies: '' },
  trustedContacts: [{ id: 'c1', name: 'Ayesha', phone: '+923001234567', consentStatus: status }],
  security: {},
});

describe('ContactSettings: consent', () => {
  let tree: renderer.ReactTestRenderer;
  let share: jest.SpyInstance;
  const onSave = jest.fn();
  const show = (s: any) => {
    mockRouteParams = { currentSettings: s, onSave };
    act(() => { tree = renderer.create(<ContactSettingsScreen />); });
  };
  const dump = () => JSON.stringify(tree.toJSON());
  const btn = (re: RegExp) => tree.root.findAll((n) => typeof n.props.onPress === 'function' && re.test(String(n.props.accessibilityLabel)))[0];

  beforeEach(() => {
    jest.clearAllMocks();
    share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
    api.createContactInvite.mockResolvedValue({ url: 'https://api.example/api/v1/contacts/invites/TOKEN', expiresAt: 'x' });
  });
  afterEach(() => { act(() => tree?.unmount()); });

  it.each(Object.entries(CONSENT_LABEL))('shows %s in words', (status, label) => {
    show(settings(status));
    expect(dump()).toContain(label.text);
  });

  it('"agreed" does not promise an alert, and says none are sent yet', () => {
    show(settings('agreed'));
    expect(dump()).toContain('does not send alerts to contacts yet');
    expect(dump()).not.toMatch(/will be alerted|will be notified|will be contacted/i);
  });

  it('never says an invite was sent', () => {
    show(settings('not_invited'));
    expect(dump().toLowerCase()).not.toMatch(/invite sent|invitation sent|we sent|has been sent to them/);
    expect(dump()).toContain('They have not been contacted');
  });

  it('asking makes a link and hands it to the share sheet, and the status becomes "waiting"', async () => {
    show(settings('not_invited'));
    await act(async () => { await btn(/Get a link to ask them/).props.onPress(); });
    expect(api.createContactInvite).toHaveBeenCalledWith('c1');
    expect(share).toHaveBeenCalledTimes(1);
    const message = (share.mock.calls[0][0] as any).message as string;
    expect(message).toContain('https://api.example/api/v1/contacts/invites/TOKEN');
    expect(message).toContain('Joyce');
    expect(dump()).toContain('Waiting for them to agree');
  });

  it('a failed request says so, and shares nothing', async () => {
    api.createContactInvite.mockRejectedValue(new Error('offline'));
    show(settings('not_invited'));
    await act(async () => { await btn(/Get a link to ask them/).props.onPress(); });
    expect(share).not.toHaveBeenCalled();
    expect(dump()).toContain("Couldn't make a link");
    expect(dump()).not.toContain('Waiting for them to agree');
  });

  it('offers no action for an agreed contact', () => {
    show(settings('agreed'));
    expect(btn(/Ask|link/)).toBeUndefined();
  });

  it('a contact with unsaved edits cannot be asked until saved', () => {
    show(settings('not_invited'));
    const phone = tree.root.findAll((n) => n.props.placeholder === 'Phone Number')[0];
    act(() => { phone.props.onChangeText('+923009999999'); });
    expect(btn(/Get a link to ask them/)).toBeUndefined();
    expect(dump()).toContain('Save your changes before asking them');
  });

  it('a contact not yet saved says to save first', () => {
    const s = settings();
    s.trustedContacts = [{ id: 'temp', name: 'New', phone: '+923001234567' }];
    show(s);
    expect(dump()).toContain('Save to be able to ask them to agree');
  });

  it('never sends the read-only status back when saving', async () => {
    show(settings('agreed'));
    await act(async () => { const pressables = tree.root.findAll((n) => typeof n.props.onPress === 'function');
      await pressables[pressables.length - 1].props.onPress(); // "Save & Update" is the last control
    });
    const sent = onSave.mock.calls[0][0].trustedContacts[0];
    expect(sent).toEqual({ id: 'c1', name: 'Ayesha', phone: '+923001234567' });
  });

  it('the message makes clear it came from the person, not the app', () => {
    expect(inviteMessage('Joyce', 'https://x/y')).toContain('Nothing has been sent to you by the app');
  });
});
