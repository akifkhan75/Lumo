import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ApiError } from '@lumo/api-client';
import type { Incident, IncidentAttempt } from '@lumo/types';
import EmergencyScreen from '../components/EmergencyModal';
import PracticeScreen from '../components/PracticeScreen';
import JourneyScreen from '../components/JourneyScreen';
import ContactAlertScreen from '../components/ContactAlert';
import BootScreen from '../components/BootScreen';
import HistoryScreen from '../components/HistoryScreen';
import IncidentTimelineScreen from '../components/IncidentTimelineScreen';
import AuthScreen from '../components/auth/AuthScreen';
import SettingsScreen from '../components/settings/SettingsModal';
import AlertSettingsScreen from '../components/settings/AlertSettings';
import ContactSettingsScreen from '../components/settings/ContactSettings';
import * as apiService from '../services/apiService';
import { auditPressables, pressables } from '../test-utils/a11yAudit';

jest.mock('../services/apiService');
const api = apiService as jest.Mocked<typeof apiService>;
let mockParams: any = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));

const T = new Date().toISOString();
const att = (o: Partial<IncidentAttempt> = {}): IncidentAttempt => ({ id: 'a1', recipientId: 'c1', recipientName: 'Maya', channel: 'sms', purpose: 'ALERT', state: 'SENT', reason: null, queuedAt: T, sentAt: T, deliveredAt: null, acknowledgedAt: null, failedAt: null, ...o });
const inc = (state: Incident['state'], attempts: IncidentAttempt[] = []): Incident => ({ id: 'i1', state, triggerType: 'manual', countdownEndsAt: null, locationAvailable: false, outcome: state, reached: [], acknowledged: [], failed: [], pending: [], capped: [], attempts });
const settings: any = { personalInfo: {}, security: { sendSmsOnSos: false }, trustedContacts: [{ id: 'c1', name: 'Maya', phone: '+1', consentStatus: 'agreed' }] };

let tree: renderer.ReactTestRenderer;
const flush = async () => { await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }); };
const show = async (el: React.ReactElement, params: any = {}) => { mockParams = params; await act(async () => { tree = renderer.create(el); }); await flush(); };
const report = (name: string) => {
  const found = auditPressables(tree);
  expect({ screen: name, controls: pressables(tree).length, violations: found }).toEqual({ screen: name, controls: pressables(tree).length, violations: [] });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  api.getSelfDefenseTips.mockResolvedValue([]);
  api.saveActiveSos.mockResolvedValue(undefined as never);
  api.clearActiveSos.mockResolvedValue(undefined as never);
  api.loadActiveSos.mockResolvedValue(null as never);
  api.loadOfflineContacts.mockResolvedValue([{ id: 'c1', name: 'Maya', phone: '+1' }] as never);
  api.getSettings.mockResolvedValue(settings);
  api.getActiveJourney.mockResolvedValue(null as never);
  api.listJourneyLinks.mockResolvedValue([] as never);
});
afterEach(() => { act(() => tree?.unmount()); jest.useRealTimers(); });

describe('the accessibility floor on the safety path (PLAT-2)', () => {
  it('SOS: counting down', async () => { api.raiseSos.mockResolvedValue(inc('CREATED')); await show(<EmergencyScreen />, { trigger: 'manual' }); report('SOS counting'); });
  it('SOS: the live ledger', async () => { api.raiseSos.mockResolvedValue(inc('NOTIFYING', [att()])); await show(<EmergencyScreen />, { trigger: 'manual' }); report('SOS live'); });
  it('SOS: nobody reached', async () => { api.raiseSos.mockResolvedValue(inc('ALL_CHANNELS_FAILED', [att({ state: 'FAILED', reason: 'NO_ADDRESS' })])); await show(<EmergencyScreen />, { trigger: 'manual' }); report('SOS failed'); });
  it('SOS: no signal', async () => { api.raiseSos.mockRejectedValue(new ApiError('x', 'network')); await show(<EmergencyScreen />, { trigger: 'manual' }); report('SOS offline'); });
  it('SOS: before anything is pressed', async () => { await show(<EmergencyScreen />, {}); report('SOS idle'); });
  it('Practice: before and during', async () => { await show(<PracticeScreen />, { settings }); report('Practice idle'); });
  it('Journey: setting one up', async () => { await show(<JourneyScreen />, undefined); report('Journey setup'); });
  it('Journey: running, with a link live', async () => {
    api.getActiveJourney.mockResolvedValue({ id: 'j1', kind: 'walk_home', state: 'ACTIVE', expectedArrivalAt: T, checkInDueAt: T, destination: null, shareLocation: true, plan: { graceSeconds: 180, contacts: ['Maya'] }, needsAnswer: false, incidentId: null, startedAt: T, endedAt: null } as never);
    api.listJourneyLinks.mockResolvedValue([{ id: 'l1', createdAt: T, expiresAt: T, revokedAt: null, hasPin: false, viewCount: 1, lastViewedAt: T, live: true }] as never);
    process.env.EXPO_PUBLIC_WEB_URL = 'https://lumo.example';
    await show(<JourneyScreen />, undefined);
    report('Journey running');
  });

  const full: any = { personalInfo: { fullName: 'Josim', bloodType: 'O+', allergies: '' }, trustedContacts: [{ id: 'c1', name: 'Maya', phone: '+1', consentStatus: 'agreed' }],
    security: { locationSharingEnabled: true, shareLocationOnSos: true, sendSmsOnSos: false, shakeToSosEnabled: true, voiceActivationEnabled: true, accidentDetectionEnabled: true } };
  const saved = { currentSettings: full, onSave: jest.fn(), onLogout: jest.fn() };
  it('a contact\'s alert: the "I\'m responding" control', async () => { await show(<ContactAlertScreen />, { attemptId: 'a1', title: 'Lumo alert', body: 'Sam asked Lumo to alert you.', responded: false }); report('Contact alert'); });
  it('settings', async () => { await show(<SettingsScreen />, saved); report('Settings'); });
  it('settings: alerts, where the automatic triggers are switched', async () => { await show(<AlertSettingsScreen />, saved); report('Alert settings'); });
  it('settings: contacts', async () => { await show(<ContactSettingsScreen />, saved); report('Contact settings'); });

  // Reachable signed out: the emergency button here is the one a person with no account, or an expired login, can still press (KI-27).
  it('the boot screen (signed out)', async () => { await show(<BootScreen onEmergency={() => undefined} />); report('Boot'); });
  it('the first screen (signed out)', async () => { await show(<AuthScreen onLoginSuccess={() => undefined} onEmergency={() => undefined} />); report('Onboarding'); });
  it('the sign-in form (signed out)', async () => {
    await show(<AuthScreen onLoginSuccess={() => undefined} onEmergency={() => undefined} />);
    const start = pressables(tree).find(p => /get started|start/i.test(String(p.props.accessibilityLabel)));
    expect(start).toBeDefined();
    await act(async () => { start!.props.onPress(); });
    report('Sign in');
  });

  const summary: any = { id: 'i1', mode: 'real', state: 'CLOSED', outcome: 'CLOSED', triggerType: 'manual', triggeredAt: T, createdAt: T, lateBySeconds: 0, locationAvailable: false, contactsTried: 2, contactsReached: 1, contactsFailed: 1, resolvedAt: null, closedAt: null };
  it('past alerts', async () => { (api as any).listIncidents.mockResolvedValue({ incidents: [summary], nextCursor: 'c' }); await show(<HistoryScreen />); report('History'); });
  it('a timeline', async () => { (api as any).getIncidentTimeline.mockResolvedValue({ incident: summary, entries: [{ at: T, kind: 'attempt', event: 'ATTEMPT_SENT', from: null, to: 'SENT', actor: null, reason: null, recipient: 'Maya', channel: 'sms', purpose: 'ALERT', simulated: false }] }); await show(<IncidentTimelineScreen />, { id: 'i1' }); report('Timeline'); });
});

