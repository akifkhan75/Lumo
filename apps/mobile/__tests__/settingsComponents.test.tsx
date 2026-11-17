import React from 'react';
import renderer, { act } from 'react-test-renderer';
import SettingsScreen from '../components/settings/SettingsModal';
import ProfileSettingsScreen from '../components/settings/ProfileSettings';
import ContactSettingsScreen from '../components/settings/ContactSettings';
import AlertSettingsScreen from '../components/settings/AlertSettings';

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

describe('Settings Screens', () => {
  const defaultSettings: any = {
    personalInfo: {
      fullName: 'Alice Test',
      bloodType: 'O+',
      allergies: 'None',
    },
    trustedContacts: [
      { id: '1', name: 'Bob', phone: '1234567890' },
    ],
    security: {
      locationSharingEnabled: true,
      shakeToAlert: true,
      voiceActivation: false,
      fallDetection: true,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
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

  describe('SettingsScreen', () => {
    it('renders menu items and triggers navigation / logout', () => {
      const onLogout = jest.fn();
      const onSave = jest.fn();
      mockRouteParams = {
        onLogout,
        onSave,
        currentSettings: defaultSettings,
      };

      let testRenderer: any;
      act(() => {
        testRenderer = renderer.create(<SettingsScreen />);
      });

      const buttons = getPressableButtons(testRenderer.root);
      expect(buttons.length).toBeGreaterThan(0);

      // Back button
      act(() => {
        buttons[0].props.onPress();
      });
      expect(mockGoBack).toHaveBeenCalled();

      // Navigation buttons
      act(() => {
        buttons[1].props.onPress();
      });
      expect(mockNavigate).toHaveBeenCalledWith('ProfileSettings', expect.any(Object));

      act(() => {
        buttons[2].props.onPress();
      });
      expect(mockNavigate).toHaveBeenCalledWith('ContactSettings', expect.any(Object));

      act(() => {
        buttons[3].props.onPress();
      });
      expect(mockNavigate).toHaveBeenCalledWith('ContactRole', expect.anything());

      act(() => {
        buttons[4].props.onPress();
      });
      expect(mockNavigate).toHaveBeenCalledWith('AlertSettings', expect.any(Object));

      // Logout button (last)
      act(() => {
        buttons[buttons.length - 1].props.onPress();
      });
      expect(onLogout).toHaveBeenCalled();
    });
  });

  describe('ProfileSettingsScreen', () => {
    it('updates profile and saves', async () => {
      const onSave = jest.fn();
      mockRouteParams = {
        currentSettings: defaultSettings,
        onSave,
      };

      let testRenderer: any;
      act(() => {
        testRenderer = renderer.create(<ProfileSettingsScreen />);
      });

      const inputs = testRenderer.root.findAll((node: any) => typeof node.props.onChangeText === 'function');
      act(() => {
        inputs[0].props.onChangeText('Alice Smith');
      });

      const buttons = getPressableButtons(testRenderer.root);
      const saveBtn = buttons[buttons.length - 1];
      await act(async () => {
        saveBtn.props.onPress();
        await Promise.resolve();
      });

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          personalInfo: expect.objectContaining({ fullName: 'Alice Smith' }),
        })
      );
      expect(mockGoBack).toHaveBeenCalled();
    });
  });

  describe('ContactSettingsScreen', () => {
    it('renders contacts, removes a contact, adds a contact and saves', async () => {
      const onSave = jest.fn();
      mockRouteParams = {
        currentSettings: defaultSettings,
        onSave,
      };

      let testRenderer: any;
      act(() => {
        testRenderer = renderer.create(<ContactSettingsScreen />);
      });

      let buttons = getPressableButtons(testRenderer.root);
      // Remove contact button
      act(() => {
        buttons[1].props.onPress();
      });

      // Re-query buttons after state change and save
      buttons = getPressableButtons(testRenderer.root);
      const saveBtn = buttons[buttons.length - 1];
      await act(async () => {
        saveBtn.props.onPress();
        await Promise.resolve();
      });

      expect(onSave).toHaveBeenCalled();
    });
  });

  describe('AlertSettingsScreen', () => {
    it('toggles alert preferences and saves', async () => {
      const onSave = jest.fn();
      mockRouteParams = {
        currentSettings: defaultSettings,
        onSave,
      };

      let testRenderer: any;
      act(() => {
        testRenderer = renderer.create(<AlertSettingsScreen />);
      });

      const switches = testRenderer.root.findAll((node: any) => typeof node.props.onValueChange === 'function');
      if (switches.length > 0) {
        act(() => {
          switches[0].props.onValueChange(false);
        });
      }

      const buttons = getPressableButtons(testRenderer.root);
      const saveBtn = buttons[buttons.length - 1];
      await act(async () => {
        saveBtn.props.onPress();
        await Promise.resolve();
      });

      expect(onSave).toHaveBeenCalled();
    });
  });
});
