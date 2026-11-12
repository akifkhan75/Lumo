import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Login } from '../components/auth/Login';
import { Signup } from '../components/auth/Signup';
import AuthScreen from '../components/auth/AuthScreen';
import * as apiService from '../services/apiService';

jest.mock('../services/apiService');

describe('Auth Components', () => {
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

  describe('Login', () => {
    it('submits login form successfully', async () => {
      (apiService.login as jest.Mock).mockResolvedValueOnce({
        user: { name: 'Alice', email: 'alice@test.com' },
        token: 'tok-123',
      });
      const onLoginSuccess = jest.fn();
      const onSwitchToSignup = jest.fn();

      let testRenderer: any;
      await act(async () => {
        testRenderer = renderer.create(
          <Login onLoginSuccess={onLoginSuccess} onSwitchToSignup={onSwitchToSignup} />
        );
      });

      const buttons = getPressableButtons(testRenderer.root);
      const submitButton = buttons[0];

      await act(async () => {
        submitButton.props.onPress();
        await Promise.resolve();
      });

      expect(apiService.login).toHaveBeenCalledWith('josim@example.com', 'password');
      expect(onLoginSuccess).toHaveBeenCalledWith({ name: 'Alice', email: 'alice@test.com' });
    });

    it('displays error on login failure', async () => {
      (apiService.login as jest.Mock).mockRejectedValueOnce(new Error('Invalid password'));
      const onLoginSuccess = jest.fn();

      let testRenderer: any;
      await act(async () => {
        testRenderer = renderer.create(
          <Login onLoginSuccess={onLoginSuccess} onSwitchToSignup={jest.fn()} />
        );
      });

      const buttons = getPressableButtons(testRenderer.root);
      await act(async () => {
        buttons[0].props.onPress();
        await Promise.resolve();
      });

      expect(onLoginSuccess).not.toHaveBeenCalled();
    });

    it('switches to signup on button press', async () => {
      const onSwitchToSignup = jest.fn();
      let testRenderer: any;
      await act(async () => {
        testRenderer = renderer.create(
          <Login onLoginSuccess={jest.fn()} onSwitchToSignup={onSwitchToSignup} />
        );
      });

      const buttons = getPressableButtons(testRenderer.root);
      const switchButton = buttons[1];
      act(() => {
        switchButton.props.onPress();
      });
      expect(onSwitchToSignup).toHaveBeenCalled();
    });
  });

  describe('Signup', () => {
    it('shows error if passwords do not match', async () => {
      const onLoginSuccess = jest.fn();
      let testRenderer: any;
      await act(async () => {
        testRenderer = renderer.create(
          <Signup onLoginSuccess={onLoginSuccess} onSwitchToLogin={jest.fn()} />
        );
      });

      const inputs = getInputs(testRenderer.root);
      // inputs: 0: Name, 1: Email, 2: Password, 3: ConfirmPassword
      act(() => {
        inputs[0].props.onChangeText('Bob');
        inputs[1].props.onChangeText('bob@test.com');
        inputs[2].props.onChangeText('pass1');
        inputs[3].props.onChangeText('pass2');
      });

      const buttons = getPressableButtons(testRenderer.root);
      await act(async () => {
        buttons[0].props.onPress();
      });

      expect(apiService.signup).not.toHaveBeenCalled();
      expect(onLoginSuccess).not.toHaveBeenCalled();
    });

    it('submits signup successfully when valid', async () => {
      (apiService.signup as jest.Mock).mockResolvedValueOnce({
        user: { name: 'Bob', email: 'bob@test.com' },
        token: 'tok-bob',
      });
      const onLoginSuccess = jest.fn();
      let testRenderer: any;
      await act(async () => {
        testRenderer = renderer.create(
          <Signup onLoginSuccess={onLoginSuccess} onSwitchToLogin={jest.fn()} />
        );
      });

      const inputs = getInputs(testRenderer.root);
      act(() => {
        inputs[0].props.onChangeText('Bob');
        inputs[1].props.onChangeText('bob@test.com');
        inputs[2].props.onChangeText('securepass');
        inputs[3].props.onChangeText('securepass');
      });

      const buttons = getPressableButtons(testRenderer.root);
      await act(async () => {
        await buttons[0].props.onPress();
      });

      expect(apiService.signup).toHaveBeenCalledWith('Bob', 'bob@test.com', 'securepass');
      expect(onLoginSuccess).toHaveBeenCalledWith({ name: 'Bob', email: 'bob@test.com' });
    });
  });

  describe('AuthScreen', () => {
    it('transitions from onboarding to auth form, handles login and signup tabs', async () => {
      (apiService.login as jest.Mock).mockResolvedValueOnce({ token: 'tok' });
      const onLoginSuccess = jest.fn();
      let testRenderer: any;
      await act(async () => {
        testRenderer = renderer.create(<AuthScreen onLoginSuccess={onLoginSuccess} onEmergency={jest.fn()} />);
      });

      // Initially on onboarding
      let buttons = getPressableButtons(testRenderer.root);
      const getStartedBtn = buttons[0];
      act(() => {
        getStartedBtn.props.onPress();
      });

      // Now on auth form
      buttons = getPressableButtons(testRenderer.root);
      // Tab 1: SignUp
      act(() => {
        buttons[1].props.onPress();
      });
      // Tab 0: Login
      buttons = getPressableButtons(testRenderer.root);
      act(() => {
        buttons[0].props.onPress();
      });

      // Submit login
      buttons = getPressableButtons(testRenderer.root);
      const submitBtn = buttons[2];
      await act(async () => {
        submitBtn.props.onPress();
        await Promise.resolve();
      });

      expect(onLoginSuccess).toHaveBeenCalled();
    });
  });
});
