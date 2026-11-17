import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import styled from 'styled-components/native';
import { Input } from '../common/Input';
import { IconUser, IconMail, IconLock } from '../../constants';
import { PersonalInfo } from '../../types';
import * as apiService from '../../services/apiService';

const FormContainer = styled(View)`
  gap: 24px;
`;

const SubmitButton = styled(TouchableOpacity)`
  width: 100%;
  background-color: #000;
  justify-content: center;
  align-items: center;
  padding: 12px;
  border-radius: 9999px;
  opacity: ${props => (props.disabled ? 0.5 : 1)};
`;

const SubmitButtonText = styled(Text)`
  color: #fff;
  font-weight: bold;
  font-size: 18px;
`;

const SwitchContainer = styled(View)`
  flex-direction: row;
  justify-content: center;
  align-items: center;
`;

const SwitchText = styled(Text)`
  text-align: center;
  font-size: 14px;
  color: #6b7280;
`;

const SwitchButton = styled(TouchableOpacity)``;

const SwitchButtonText = styled(Text)`
  font-weight: 600;
  color: #047857;
  text-decoration: underline;
`;

const ErrorText = styled(Text)`
  color: #ef4444;
  font-size: 14px;
  text-align: center;
`;

interface SignupProps {
  onLoginSuccess: (newUser?: Partial<PersonalInfo>) => void;
  onSwitchToLogin: () => void;
}

export const Signup: React.FC<SignupProps> = ({ onLoginSuccess, onSwitchToLogin }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const handleSubmit = async () => {
    setError('');
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!name || !email || !password) {
      setError('Please fill in all fields.');
      return;
    }

    setIsLoading(true);
    try {
      const { user } = await apiService.signup(name, email, password);
      onLoginSuccess(user);
    } catch(err: any) {
        setError(err.message || "Signup failed. Please try again.");
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <FormContainer>
      <Input
        label="Full Name"
        icon={<IconUser size={20} color="#9ca3af" />}
        value={name}
        onChangeText={setName}
        editable={!isLoading}
      />
      <Input
        label="Email"
        keyboardType="email-address"
        icon={<IconMail size={20} color="#9ca3af" />}
        value={email}
        onChangeText={setEmail}
        editable={!isLoading}
        autoCapitalize="none"
      />
      <Input
        label="Password"
        secureTextEntry
        icon={<IconLock size={20} color="#9ca3af" />}
        value={password}
        onChangeText={setPassword}
        editable={!isLoading}
      />
      <Input
        label="Confirm Password"
        secureTextEntry
        icon={<IconLock size={20} color="#9ca3af" />}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        editable={!isLoading}
      />

      {error && <ErrorText>{error}</ErrorText>}

      <SubmitButton
        onPress={handleSubmit}
        disabled={isLoading}
      >
        {isLoading ? <ActivityIndicator color="#fff" /> : <SubmitButtonText>Create Account</SubmitButtonText>}
      </SubmitButton>

      <SwitchContainer>
        <SwitchText>Already have an account?{' '}</SwitchText>
        <SwitchButton onPress={onSwitchToLogin}>
            <SwitchButtonText>Log in</SwitchButtonText>
        </SwitchButton>
      </SwitchContainer>
    </FormContainer>
  );
};
