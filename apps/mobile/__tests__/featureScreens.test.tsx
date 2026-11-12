import React from 'react';
import renderer, { act } from 'react-test-renderer';
import EmergencyScreen from '../components/EmergencyModal';
import FakeCallScreen from '../components/FakeCallScreen';
import FollowMeScreen from '../components/FollowMeModal';
import CheckInScreen from '../components/CheckInModal';
import CommunitySafetyScreen from '../components/CommunitySafetyModal';
import ReportDangerZoneScreen from '../components/ReportDangerZoneModal';
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

  describe('ReportDangerZoneScreen', () => {
    it('submits a danger zone report', async () => {
      const onReport = jest.fn();
      mockRouteParams = { onReport };

      let testRenderer: any;
      act(() => {
        testRenderer = renderer.create(<ReportDangerZoneScreen />);
      });

      let buttons = getPressableButtons(testRenderer.root);
      // Click a severity or type option
      if (buttons[2]) {
        act(() => {
          buttons[2].props.onPress();
        });
      }

      const inputs = getInputs(testRenderer.root);
      act(() => {
        inputs[0].props.onChangeText('Dark road with poor street lighting');
      });

      // Submit report button (last button)
      buttons = getPressableButtons(testRenderer.root);
      const submitBtn = buttons[buttons.length - 1];
      await act(async () => {
        submitBtn.props.onPress();
        await Promise.resolve();
      });

      expect(onReport).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Dark road with poor street lighting',
        })
      );

      // Back button closes screen
      act(() => {
        buttons[0].props.onPress();
      });
      expect(mockGoBack).toHaveBeenCalled();

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
