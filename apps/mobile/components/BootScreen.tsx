import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import styled from 'styled-components/native';
import EmergencyAffordance from './common/EmergencyAffordance';

/**
 * Shown while the app reads the stored session on launch.
 *
 * That read is bounded (see `tokenStorage`), so this screen is brief. It still
 * carries the emergency control, because "brief" is not "never": a blank
 * spinner that someone cannot get past is exactly the failure this milestone
 * exists to remove.
 */

const Container = styled(View)`
  flex: 1;
  background-color: #ffffff;
  justify-content: center;
  align-items: center;
  padding: 32px;
  gap: 24px;
`;

const Status = styled(Text)`
  color: #374151;
  font-size: 16px;
  text-align: center;
`;

const BootScreen = ({ onEmergency }: { onEmergency: () => void }) => (
  <Container>
    <ActivityIndicator size="large" accessibilityLabel="Loading" />
    <Status accessibilityLiveRegion="polite">Restoring your session…</Status>
    <EmergencyAffordance onPress={onEmergency} />
  </Container>
);

export default BootScreen;
