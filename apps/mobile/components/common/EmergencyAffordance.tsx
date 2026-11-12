import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import styled from 'styled-components/native';

/**
 * A way to reach the emergency screen from a screen that has no SOS button.
 *
 * Every screen a person can land on without being signed in — the login form,
 * the moment the app is restoring a session — needs one of these, because the
 * emergency screen and the phone dialler must never sit behind an account, a
 * network call or a storage read (PLAT-4, emergency-review check 3).
 *
 * It is a plain control that takes a callback, not something that calls
 * `useNavigation` itself, so it can be rendered and tested without a navigator.
 *
 * The label says what it does and no more. It opens a screen and a dialler. It
 * does not send an alert, and the words must not suggest it does (PLAT-9).
 */

const Button = styled(TouchableOpacity)`
  min-height: 52px;
  width: 100%;
  border-width: 2px;
  border-color: #dc2626;
  border-radius: 9999px;
  align-items: center;
  justify-content: center;
  padding: 12px 24px;
  background-color: #ffffff;
`;

// #b91c1c on white is about 6.5:1, above the 4.5:1 floor for text.
const Label = styled(Text)`
  color: #b91c1c;
  font-size: 18px;
  font-weight: bold;
`;

const EmergencyAffordance = ({ onPress }: { onPress: () => void }) => (
  <Button
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel="Emergency help. Opens the emergency screen and phone dialler"
  >
    <Label>Emergency help</Label>
  </Button>
);

export default EmergencyAffordance;
