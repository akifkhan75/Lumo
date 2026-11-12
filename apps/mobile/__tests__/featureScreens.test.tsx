import React from 'react';
import renderer, { act } from 'react-test-renderer';
import EmergencyScreen from '../components/EmergencyModal';
import FakeCallScreen from '../components/FakeCallScreen';
import FollowMeScreen from '../components/FollowMeModal';
import CheckInScreen from '../components/CheckInModal';
import CommunitySafetyScreen from '../components/CommunitySafetyModal';
import ReportHazardScreen from '../components/ReportHazardModal';
import SafetyAssistantScreen from '../components/SafetyAssistantModal';
import * as apiService from '../services/apiService';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: any = {};

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
    }),
    useRoute: () => ({
      params: mockRouteParams,
    }),
  };
});

jest.mock('../services/apiService');

describe('Feature and Modal Screens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  const getPressableButtons = (root: any) => {
    const seen = new Set();
    const result: any[] = [];
    root.findAll((node: any) => {
      if (typeof node.props.onPress === 'function' && !seen.has(node.props.onPress)) {
        seen.add(node.props.onPress);
        result.push(node);
      }
    });
    return result;
  };

  const getInputs = (root: any) => {
    const seen = new Set();
    const result: any[] = [];
    root.findAll((node: any) => {
      if (typeof node.props.onChangeText === 'function' && !seen.has(node.props.onChangeText)) {
        seen.add(node.props.onChangeText);
        result.push(node);
      }
    });
    return result;
  };

  describe('EmergencyScreen', () => {
    it('renders emergency calling screen and triggers defense guide', async () => {
      (apiService.getSelfDefenseTips as jest.Mock).mockResolvedValueOnce([
        'Yell loudly for assistance',
      ]);
      mockRouteParams = {
        settings: {
          personalInfo: { bloodType: 'B+' },
          emergencyContacts: [],
        },
      };

      let testRenderer: any;
      await act(async () => {
        testRenderer = renderer.create(<EmergencyScreen />);
        await Promise.resolve();
      });

      const buttons = getPressableButtons(testRenderer.root);
      // Back button
      act(() => {
        buttons[0].props.onPress();
      });
      expect(mockGoBack).toHaveBeenCalled();

      act(() => {
        testRenderer.unmount();
      });
    });
  });

  describe('FakeCallScreen', () => {
    it('loads fake call script and accepts call', async () => {
      (apiService.getFakeCallScript as jest.Mock).mockResolvedValueOnce({
        callerName: 'Alex',
        script: ['Hello', 'Where are you?'],
      });

      let testRenderer: any;
      await act(async () => {
        testRenderer = renderer.create(<FakeCallScreen />);
        await Promise.resolve();
      });

      let buttons = getPressableButtons(testRenderer.root);
      // Answer button is index 1
      if (buttons[1]) {
        act(() => {
          buttons[1].props.onPress();
        });
      }

      // Decline button
      buttons = getPressableButtons(testRenderer.root);
      if (buttons[0]) {
        act(() => {
          buttons[0].props.onPress();
        });
      }
      expect(mockGoBack).toHaveBeenCalled();

      act(() => {
        testRenderer.unmount();
      });
    });

    it('handles script fetch error and uses fallback', async () => {
      (apiService.getFakeCallScript as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      let testRenderer: any;
      await act(async () => {
        testRenderer = renderer.create(<FakeCallScreen />);
        await Promise.resolve();
      });

      expect(testRenderer.toJSON()).toBeTruthy();

      act(() => {
        testRenderer.unmount();
      });
    });
  });

  describe('FollowMeScreen', () => {
    it('renders and toggles follow me tracking', () => {
      let testRenderer: any;
      act(() => {
        testRenderer = renderer.create(<FollowMeScreen />);
      });

      let buttons = getPressableButtons(testRenderer.root);
      // Back button
      act(() => {
        buttons[0].props.onPress();
      });
      expect(mockGoBack).toHaveBeenCalled();

      // Start/Stop tracking button is the last one
      const actionBtn = buttons[buttons.length - 1];
      act(() => {
        actionBtn.props.onPress();
      });
      buttons = getPressableButtons(testRenderer.root);
      act(() => {
        buttons[buttons.length - 1].props.onPress();
      });

      act(() => {
        testRenderer.unmount();
      });
    });
  });

  describe('CheckInScreen', () => {
    it('renders timer and allows selecting durations and starting timer', () => {
      mockRouteParams = {};
      let testRenderer: any;
      act(() => {
        testRenderer = renderer.create(<CheckInScreen />);
      });

      let buttons = getPressableButtons(testRenderer.root);
      // Select 15 min (button 1)
      if (buttons[1]) {
        act(() => {
          buttons[1].props.onPress();
        });
      }

      // Start Timer
      buttons = getPressableButtons(testRenderer.root);
      const startBtn = buttons[buttons.length - 1];
      act(() => {
        startBtn.props.onPress();
      });

      act(() => {
        jest.advanceTimersByTime(1000);
      });

      // Cancel Timer
      buttons = getPressableButtons(testRenderer.root);
      act(() => {
        buttons[buttons.length - 1].props.onPress();
      });

      act(() => {
        testRenderer.unmount();
      });
    });

    // Regression: KI-19. The countdown used to decrement a counter once per
    // tick, so any time the JS thread was paused (backgrounded, Doze, Low
    // Power Mode) was simply lost and an overdue check-in never fired. The
    // deadline is now wall-clock, so it expires as soon as the app runs again.
    it('expires against the wall clock, not against ticks it managed to run', () => {
      const onEmergency = jest.fn();
      mockRouteParams = { onEmergency };
      let testRenderer: any;
      act(() => {
        testRenderer = renderer.create(<CheckInScreen />);
      });

      // Start the 15-minute timer.
      const buttons = getPressableButtons(testRenderer.root);
      act(() => {
        buttons[1].props.onPress();
      });

      // Simulate the app being suspended past the deadline: the clock moves,
      // but only one tick ever runs.
      act(() => {
        jest.setSystemTime(Date.now() + 16 * 60 * 1000);
        jest.advanceTimersByTime(1000);
      });

      expect(onEmergency).toHaveBeenCalledTimes(1);
      expect(mockGoBack).toHaveBeenCalled();

      act(() => {
        testRenderer.unmount();
      });
    });
  });

  describe('CommunitySafetyScreen', () => {
    it('renders community features and safety tips', () => {
      let testRenderer: any;
      act(() => {
        testRenderer = renderer.create(<CommunitySafetyScreen />);
      });

      const buttons = getPressableButtons(testRenderer.root);
      // Back button
      act(() => {
        buttons[0].props.onPress();
      });
      expect(mockGoBack).toHaveBeenCalled();

      act(() => {
        testRenderer.unmount();
      });
    });
  });

  describe('CommunitySafetyScreen hazard reports', () => {
    const openHazardReports = async () => {
      let testRenderer: any;
      await act(async () => {
        testRenderer = renderer.create(<CommunitySafetyScreen />);
      });
      // "View reports" on the hazard-reports feature card. The label renders
      // as ['View reports', ' \u2192'], so match either shape and walk up to
      // the nearest pressable ancestor.
      const [label] = testRenderer.root.findAll((node: any) => {
        const children = node.props.children;
        return Array.isArray(children)
          ? children.includes('View reports')
          : children === 'View reports';
      });
      let pressable = label;
      while (pressable && typeof pressable.props.onPress !== 'function') {
        pressable = pressable.parent;
      }
      await act(async () => {
        pressable.props.onPress();
        await Promise.resolve();
      });
      return testRenderer;
    };

    it('says there are no reports rather than inventing examples', async () => {
      (apiService.getHazardReports as jest.Mock).mockResolvedValue([]);

      const testRenderer = await openHazardReports();
      const text = JSON.stringify(testRenderer.toJSON());

      expect(text).toContain('No reports.');
      // The two fabricated rows this view used to ship with.
      expect(text).not.toContain('Elm Street Park');
      expect(text).not.toContain('Downtown Station');

      act(() => {
        testRenderer.unmount();
      });
    });

    it('renders a report with its age and confirmation count, and no severity', async () => {
      (apiService.getHazardReports as jest.Mock).mockResolvedValue([
        {
          id: 'report-1',
          type: 'POOR_LIGHTING',
          source: 'COMMUNITY',
          description: 'Streetlight out on the footbridge',
          coordinates: { latitude: 51.5074, longitude: -0.1278, accuracyMetres: 12 },
          reportedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
          confirmationCount: 1,
          influencesRouting: false,
        },
      ]);

      const testRenderer = await openHazardReports();
      const text = JSON.stringify(testRenderer.toJSON());

      expect(text).toContain('Lighting out');
      expect(text).toContain('reported 2 days ago');
      expect(text).toContain('1 confirmation');
      expect(text).toContain('Unconfirmed');
      expect(text.toLowerCase()).not.toContain('severity');

      act(() => {
        testRenderer.unmount();
      });
    });

    it('does not mark an unconfirmed report as acted upon', async () => {
      (apiService.getHazardReports as jest.Mock).mockResolvedValue([
        {
          id: 'report-2',
          type: 'OBSTRUCTED_PATH',
          source: 'COMMUNITY',
          description: 'Scaffolding across the pavement',
          coordinates: { latitude: 51.5, longitude: -0.1, accuracyMetres: null },
          reportedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          confirmationCount: 5,
          influencesRouting: true,
        },
      ]);

      const testRenderer = await openHazardReports();
      const text = JSON.stringify(testRenderer.toJSON());

      expect(text).toContain('5 confirmations');
      expect(text).not.toContain('Unconfirmed');

      act(() => {
        testRenderer.unmount();
      });
    });

    it('surfaces a load failure instead of an empty list', async () => {
      (apiService.getHazardReports as jest.Mock).mockRejectedValue(new Error('offline'));

      const testRenderer = await openHazardReports();
      const text = JSON.stringify(testRenderer.toJSON());

      expect(text).toContain('Could not load reports.');
      expect(text).not.toContain('No reports.');

      act(() => {
        testRenderer.unmount();
      });
    });
  });

  describe('ReportHazardScreen', () => {
    it('offers no way to submit a report, because Lumo has no position to attach', () => {
      mockRouteParams = {};

      let testRenderer: any;
      act(() => {
        testRenderer = renderer.create(<ReportHazardScreen />);
      });

      // No text entry and no severity picker: the form is gone, not disabled.
      expect(getInputs(testRenderer.root)).toHaveLength(0);

      // Only navigation remains. Back and Close share the one onClose handler,
      // so the de-duplicating helper sees a single distinct press target:
      // nothing on this screen can create a report.
      const buttons = getPressableButtons(testRenderer.root);
      expect(buttons).toHaveLength(1);

      act(() => {
        buttons[0].props.onPress();
      });
      expect(mockGoBack).toHaveBeenCalled();

      act(() => {
        testRenderer.unmount();
      });
    });

    it('states plainly that the feature is unavailable', () => {
      mockRouteParams = {};

      let testRenderer: any;
      act(() => {
        testRenderer = renderer.create(<ReportHazardScreen />);
      });

      const text = JSON.stringify(testRenderer.toJSON());
      expect(text).toContain('NOT AVAILABLE YET');
      expect(text).toContain('Lumo cannot read your location');

      act(() => {
        testRenderer.unmount();
      });
    });
  });

  describe('SafetyAssistantScreen', () => {
    it('sends safety chat message and renders assistant reply', async () => {
      (apiService.safetyChat as jest.Mock).mockResolvedValueOnce({
        response: 'Head towards the supermarket on the corner.',
      });

      let testRenderer: any;
      await act(async () => {
        testRenderer = renderer.create(<SafetyAssistantScreen />);
      });

      const inputs = getInputs(testRenderer.root);
      act(() => {
        inputs[0].props.onChangeText('Where should I walk?');
      });

      let buttons = getPressableButtons(testRenderer.root);
      // Send button is last
      const sendBtn = buttons[buttons.length - 1];
      await act(async () => {
        await sendBtn.props.onPress();
        await Promise.resolve();
      });

      expect(apiService.safetyChat).toHaveBeenCalledWith(
        'Where should I walk?',
        expect.any(Array)
      );

      act(() => {
        testRenderer.unmount();
      });
    });
  });
});
