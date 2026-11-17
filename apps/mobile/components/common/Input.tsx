import React from 'react';
import { View, TextInput, TextInputProps } from 'react-native';
import styled from 'styled-components/native';

interface InputProps extends TextInputProps {
  label: string;
  icon?: React.ReactNode;
}

const InputWrapper = styled(View)`
  border-bottom-width: 2px;
  border-color: #e5e7eb; /* gray-200 */
  flex-direction: row;
  align-items: center;
  padding-bottom: 8px;
`;

const IconWrapper = styled(View)`
  padding-end: 12px;
`;

const StyledTextInput = styled(TextInput)`
  flex: 1;
  font-size: 16px;
  color: #1f2937;
`;

export const Input: React.FC<InputProps> = ({ label, icon, ...props }) => {
  return (
    <InputWrapper>
      {icon && <IconWrapper>{icon}</IconWrapper>}
      <StyledTextInput
        placeholder={label}
        placeholderTextColor="#9ca3af" /* gray-400 */
        {...props}
      />
    </InputWrapper>
  );
};
