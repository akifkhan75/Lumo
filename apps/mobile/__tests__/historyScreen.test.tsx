import React from 'react';
import { Share } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { ApiError } from '@lumo/api-client';
import type { IncidentSummary, IncidentTimeline } from '@lumo/types';
import HistoryScreen from '../components/HistoryScreen';
import IncidentTimelineScreen from '../components/IncidentTimelineScreen';
import * as apiService from '../services/apiService';

jest.mock('../services/apiService');
const api = apiService as jest.Mocked<typeof apiService>;
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockParams: any = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: mockParams }),
}));

const sum = (id: string, o: Partial<IncidentSummary> = {}): IncidentSummary => ({
  id, mode: 'real', state: 'CLOSED', outcome: 'CLOSED', triggerType: 'manual', triggeredAt: '2026-01-01T10:00:00Z', createdAt: '2026-01-01T10:00:00Z',
  lateBySeconds: 0, locationAvailable: false, contactsTried: 2, contactsReached: 1, contactsFailed: 1, resolvedAt: null, closedAt: null, ...o,
});
const entry = (o: any = {}) => ({ at: '2026-01-01T10:00:05Z', kind: 'attempt', event: 'ATTEMPT_SENT', from: null, to: 'SENT', actor: null, reason: null, recipient: 'Maya', channel: 'sms', purpose: 'ALERT', simulated: false, ...o });
const tl = (o: Partial<IncidentSummary> = {}, entries: any[] = [entry()]): IncidentTimeline => ({ incident: sum('i1', o), entries });

let tree: renderer.ReactTestRenderer;
const text = () => JSON.stringify(tree.toJSON());
const control = (label: RegExp | string) => tree.root.findAll(n => typeof n.props.onPress === 'function' && (typeof label === 'string' ? n.props.accessibilityLabel === label : label.test(String(n.props.accessibilityLabel))))[0];
const flush = async () => { await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }); };
const show = async (el: React.ReactElement, params: any = {}) => { mockParams = params; await act(async () => { tree = renderer.create(el); }); await flush(); };

beforeEach(() => { jest.clearAllMocks(); Object.values(api).forEach(f => { if (typeof (f as jest.Mock)?.mockReset === 'function') (f as jest.Mock).mockReset(); }); });
afterEach(() => { act(() => tree?.unmount()); });

describe('past alerts', () => {
  it('lists real alerts first, newest first as the server sent them, in the ledger\'s words', async () => {
    api.listIncidents.mockResolvedValue({ incidents: [sum('a'), sum('b', { contactsTried: 0, contactsReached: 0, contactsFailed: 0 })], nextCursor: null });
    await show(<HistoryScreen />);
    expect(api.listIncidents).toHaveBeenCalledWith({ limit: 20, cursor: null, mode: 'real' });
    expect(text()).toContain("Sent to 1 of 2 · couldn't reach 1");
    expect(text()).toContain('No contact could be alerted');
    expect(text().toLowerCase()).not.toMatch(/notified/);
  });

  it('says plainly there is nothing yet', async () => {
    api.listIncidents.mockResolvedValue({ incidents: [], nextCursor: null });
    await show(<HistoryScreen />);
    expect(text()).toContain("You haven't raised an alert");
  });

  it('opens one incident\'s timeline by its id', async () => {
    api.listIncidents.mockResolvedValue({ incidents: [sum('abc')], nextCursor: null });
    await show(<HistoryScreen />);
    await act(async () => { control(/Open the timeline$/).props.onPress(); });
    expect(mockNavigate).toHaveBeenCalledWith('IncidentTimeline', { id: 'abc' });
  });

  it('pages: "Show older" asks for the next page and appends it, without repeating', async () => {
    api.listIncidents.mockResolvedValueOnce({ incidents: [sum('a')], nextCursor: 'c1' }).mockResolvedValueOnce({ incidents: [sum('b')], nextCursor: null });
    await show(<HistoryScreen />);
    await act(async () => { control('Show older alerts').props.onPress(); });
    await flush();
    expect(api.listIncidents).toHaveBeenLastCalledWith({ limit: 20, cursor: 'c1', mode: 'real' });
    expect(tree.root.findAll(n => typeof n.props.accessibilityLabel === 'string' && /Open the timeline$/.test(n.props.accessibilityLabel) && typeof n.props.onPress === 'function').length).toBeGreaterThanOrEqual(2);
    expect(control('Show older alerts')).toBeUndefined(); // no more
  });

  it('practice runs are a separate list, marked, and never mixed into the alerts', async () => {
    api.listIncidents.mockImplementation(async (q: any) => q?.mode === 'practice'
      ? { incidents: [sum('p', { mode: 'practice' })], nextCursor: null }
      : { incidents: [sum('r')], nextCursor: null });
    await show(<HistoryScreen />);
    expect(text()).not.toContain('nobody was contacted'); // no rehearsal marker among the real alerts (the toggle's own label is not a row)
    expect(text()).toContain('You pressed SOS');
    await act(async () => { control('Show your practice runs').props.onPress(); });
    await flush();
    expect(api.listIncidents).toHaveBeenLastCalledWith({ limit: 20, cursor: null, mode: 'practice' });
    expect(text()).toContain('Practice: nobody was contacted.');
    expect(text()).not.toContain('You pressed SOS'); // and the real alert is gone from this list
  });

  it('says it could not load, and lets the person try again, rather than show an empty list as if nothing happened', async () => {
    api.listIncidents.mockRejectedValueOnce(new ApiError('x', 'network')).mockResolvedValueOnce({ incidents: [sum('a')], nextCursor: null });
    await show(<HistoryScreen />);
    expect(text()).toContain("Couldn't load your past alerts");
    expect(text()).not.toContain("You haven't raised an alert");
    await act(async () => { control('Try loading your past alerts again').props.onPress(); });
    await flush();
    expect(text()).toContain("Sent to 1 of 2");
  });
});

describe('a timeline', () => {
  it('shows what happened, in order, with names, and says it never includes a position or number', async () => {
    api.getIncidentTimeline.mockResolvedValue(tl({}, [entry({ kind: 'incident', event: 'CREATED', to: 'CREATED', actor: 'user', recipient: null, channel: null, purpose: null }), entry()]));
    await show(<IncidentTimelineScreen />, { id: 'i1' });
    expect(api.getIncidentTimeline).toHaveBeenCalledWith('i1');       // viewing: NOT an export
    expect(text()).toContain('Alert started (you)');
    expect(text()).toContain('Text to Maya: sent, not confirmed');
    expect(text()).toContain('never includes a position or a phone number');
  });

  it('a rehearsal has the banner and says nobody was contacted', async () => {
    api.getIncidentTimeline.mockResolvedValue(tl({ mode: 'practice' }, [entry({ simulated: true })]));
    await show(<IncidentTimelineScreen />, { id: 'p1' });
    expect(text()).toContain('Practice: nobody was contacted');
    expect(text()).toContain('(practice)');
  });

  it('sharing asks the server for the AUDITED export, shares its words, and says Lumo sent nothing', async () => {
    api.getIncidentTimeline.mockResolvedValue(tl());
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    await show(<IncidentTimelineScreen />, { id: 'i1' });
    await act(async () => { control(/^Share this timeline/).props.onPress(); });
    await flush();
    expect(api.getIncidentTimeline).toHaveBeenLastCalledWith('i1', true);
    expect((spy.mock.calls[0][0] as { message: string }).message).toContain('Text to Maya');
    expect(text()).toContain('Lumo does not send it anywhere');
    spy.mockRestore();
  });

  it('if the export cannot be prepared, shares nothing and says so', async () => {
    api.getIncidentTimeline.mockResolvedValueOnce(tl()).mockRejectedValueOnce(new ApiError('x', 'network'));
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    await show(<IncidentTimelineScreen />, { id: 'i1' });
    await act(async () => { control(/^Share this timeline/).props.onPress(); });
    await flush();
    expect(spy).not.toHaveBeenCalled();
    expect(text()).toContain('Nothing was shared');
    spy.mockRestore();
  });

  it('says it could not load, rather than show an empty timeline', async () => {
    api.getIncidentTimeline.mockRejectedValue(new ApiError('x', 'network'));
    await show(<IncidentTimelineScreen />, { id: 'i1' });
    expect(text()).toContain("Couldn't load this timeline");
  });
});
