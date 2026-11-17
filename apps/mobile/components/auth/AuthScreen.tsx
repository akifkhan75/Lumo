import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, ImageBackground } from 'react-native';
import styled from 'styled-components/native';
import EmergencyAffordance from '../common/EmergencyAffordance';
import * as apiService from '../../services/apiService';
import { IconMail, IconLock, IconUser, IconChevronRight } from '../../constants';

const OnboardingContainer = styled(View)`
    flex: 1;
`;

const OnboardingImage = styled(ImageBackground)`
    flex: 1;
    justify-content: flex-end;
`;

const OnboardingContent = styled(View)`
    padding: 32px;
    background-color: white;
`;

const OnboardingTitle = styled(Text)`
    font-size: 36px;
    font-weight: bold;
    color: #1f2937;
`;

const OnboardingTitleHighlight = styled(Text)`
    color: #047857;
`;

const OnboardingButton = styled(TouchableOpacity)`
    background-color: black;
    min-height: 56px;
    padding: 16px;
    border-radius: 9999px;
    align-items: center;
    margin-top: 16px;
    flex-direction: row;
    justify-content: space-between;
`;

const OnboardingButtonText = styled(Text)`
    color: white;
    font-size: 18px;
    font-weight: bold;
`;

const Container = styled(View)`
  flex: 1;
  justify-content: center;
  padding: 32px;
  background-color: #ffffff;
`;

const Title = styled(Text)`
  font-size: 28px;
  font-weight: bold;
  text-align: center;
  margin-bottom: 8px;
  color: #1f2937;
`;

const Subtitle = styled(Text)`
  font-size: 16px;
  text-align: center;
  color: #6b7280;
  margin-bottom: 32px;
`;

const TabContainer = styled(View)`
  flex-direction: row;
  margin-bottom: 24px;
  border-bottom-width: 1px;
  border-bottom-color: #e5e7eb;
`;

const TabButton = styled(TouchableOpacity)<{ active: boolean }>`
  flex: 1;
  min-height: 48px;
  justify-content: center;
  padding-vertical: 12px;
  align-items: center;
  border-bottom-width: ${props => (props.active ? '2px' : '0px')};
  border-bottom-color: ${props => (props.active ? '#047857' : 'transparent')};
`;

const TabText = styled(Text)<{ active: boolean }>`
  font-size: 16px;
  font-weight: 600;
  color: ${props => (props.active ? '#047857' : '#6b7280')};
`;

const InputContainer = styled(View)`
  flex-direction: row;
  align-items: center;
  border-bottom-width: 2px;
  border-color: #e5e7eb;
  margin-bottom: 16px;
  padding-bottom: 8px;
`;

const StyledInput = styled(TextInput)`
  flex: 1;
  font-size: 16px;
  padding-start: 12px;
  color: #1f2937;
`;

const SubmitButton = styled(TouchableOpacity)`
  background-color: #1f2937;
  min-height: 56px;
  justify-content: center;
  padding: 16px;
  border-radius: 9999px;
  align-items: center;
  margin-top: 16px;
`;

const ButtonText = styled(Text)`
  color: white;
  font-size: 18px;
  font-weight: bold;
`;

const SwitchTextContainer = styled(View)`
    flex-direction: row;
    justify-content: center;
    margin-top: 24px;
`;

const SwitchText = styled(Text)`
  text-align: center;
  color: #6b7280;
`;

const SwitchButtonText = styled(Text)`
  color: #047857;
  font-weight: 600;
`;

const ErrorText = styled(Text)`
  color: #ef4444;
  text-align: center;
  margin-bottom: 16px;
`;


const OnboardingEmergency = styled(View)`
  margin-top: 16px;
`;

const Onboarding = ({ onGetStarted, onEmergency }: { onGetStarted: () => void; onEmergency: () => void }) => (
    <OnboardingContainer>
        <OnboardingImage source={require('../../assets/images/onboarding_hero.jpg')} resizeMode="cover">
        </OnboardingImage>
        <OnboardingContent>
            <OnboardingTitle>Stay Safe</OnboardingTitle>
            <OnboardingTitle>with <OnboardingTitleHighlight>Lumo</OnboardingTitleHighlight></OnboardingTitle>
            <OnboardingButton onPress={onGetStarted} accessibilityRole="button" accessibilityLabel="Get started: sign in or create an account">
                <OnboardingButtonText>Get Started</OnboardingButtonText>
                <IconChevronRight size={20} color="white" />
            </OnboardingButton>
            {/* The first screen a signed-out person sees has to carry this too. */}
            <OnboardingEmergency>
                <EmergencyAffordance onPress={onEmergency} />
            </OnboardingEmergency>
        </OnboardingContent>
    </OnboardingContainer>
);

// `onEmergency` is required, not optional: this is the screen someone lands on
// when they are signed out, and a signed-out person must still be able to reach
// the emergency screen and the phone dialler.
const AuthScreen = ({ onLoginSuccess, onEmergency }: { onLoginSuccess: () => void; onEmergency: () => void }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [step, setStep] = useState<'onboarding' | 'auth'>('onboarding');
  const [email, setEmail] = useState('josim@example.com');
  const [password, setPassword] = useState('password');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    setError('');
    if (!email || !password) {
      setError('Please fill in both email and password.');
      return;
    }
    setIsLoading(true);
    try {
      await apiService.login(email, password);
      onLoginSuccess();
    } catch (err: any) {
      setError(err.message || 'Login failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async () => {
    setError('');
    if (!name || !email || !password) {
      setError('Please fill in all fields.');
      return;
    }
    setIsLoading(true);
    try {
      await apiService.signup(name, email, password);
      onLoginSuccess();
    } catch (err: any) {
      setError(err.message || "Signup failed.");
    } finally {
      setIsLoading(false);
    }
  };

  if (step === 'onboarding') {
    return <Onboarding onGetStarted={() => setStep('auth')} onEmergency={onEmergency} />;
  }

  return (
    <Container>
      <Title>Welcome!</Title>
      <Subtitle>Sign in or create an account to continue.</Subtitle>
      <TabContainer>
        <TabButton active={mode === 'login'} onPress={() => setMode('login')} accessibilityRole="tab" accessibilityLabel="Log in to your account" accessibilityState={{ selected: mode === 'login' }}>
          <TabText active={mode === 'login'}>Login</TabText>
        </TabButton>
        <TabButton active={mode === 'signup'} onPress={() => setMode('signup')} accessibilityRole="tab" accessibilityLabel="Create a new account" accessibilityState={{ selected: mode === 'signup' }}>
          <TabText active={mode === 'signup'}>Sign Up</TabText>
        </TabButton>
      </TabContainer>

      {mode === 'signup' && (
        <InputContainer>
          <IconUser size={20} color="#9ca3af" />
          <StyledInput
            placeholder="Full Name"
            accessibilityLabel="Your full name"
            value={name}
            onChangeText={setName}
            editable={!isLoading}
          />
        </InputContainer>
      )}

      <InputContainer>
        <IconMail size={20} color="#9ca3af" />
        <StyledInput
          placeholder="Email"
          accessibilityLabel="Your email address"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          editable={!isLoading}
        />
      </InputContainer>
      <InputContainer>
        <IconLock size={20} color="#9ca3af" />
        <StyledInput
          placeholder="Password"
          accessibilityLabel="Your password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!isLoading}
        />
      </InputContainer>

      {error ? <ErrorText accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</ErrorText> : null}

      <SubmitButton onPress={mode === 'login' ? handleLogin : handleSignup} disabled={isLoading} accessibilityRole="button" accessibilityLabel={isLoading ? 'Signing you in' : mode === 'login' ? 'Log in' : 'Create your account'} accessibilityState={{ busy: isLoading, disabled: isLoading }}>
        {isLoading ? <ActivityIndicator color="white" /> : <ButtonText>{mode === 'login' ? 'Login' : 'Create Account'}</ButtonText>}
      </SubmitButton>

      <SwitchTextContainer>
        <SwitchText>
            {mode === 'login' ? "Don't have an account? " : "Already have an account? "}
        </SwitchText>
        <TouchableOpacity onPress={() => setMode(mode === 'login' ? 'signup' : 'login')} accessibilityRole="button" accessibilityLabel={mode === 'login' ? 'Switch to creating an account' : 'Switch to logging in'} style={{ minHeight: 44, justifyContent: 'center' }}>
            <SwitchButtonText>{mode === 'login' ? 'Sign up' : 'Log in'}</SwitchButtonText>
        </TouchableOpacity>
      </SwitchTextContainer>

      <EmergencyAffordance onPress={onEmergency} />
    </Container>
  );
};

export default AuthScreen;