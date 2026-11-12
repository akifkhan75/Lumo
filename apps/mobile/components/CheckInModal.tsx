import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import styled from 'styled-components/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { IconArrowLeft, IconTimer } from '../constants';
import DemoBanner from './common/DemoBanner';

const Container = styled(View)`
  flex: 1;
  background-color: white;
  padding: 16px;
`;

const Header = styled(View)`
  flex-direction: row;
  align-items: center;
  margin-bottom: 16px;
  padding-top: 32px;
`;

const BackButton = styled(TouchableOpacity)`
  padding: 8px;
`;

const Title = styled(Text)`
  font-size: 24px;
  font-weight: bold;
  color: #1f2937;
  margin-left: 16px;
`;

const Body = styled(View)`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const Description = styled(Text)`
    color: #4b5563;
    margin-bottom: 24px;
    text-align: center;
    max-width: 80%;
`;

const TimerText = styled(Text)`
    font-size: 60px;
    font-weight: bold;
    font-family: ${Platform.OS === 'ios' ? 'Menlo' : 'monospace'};
    color: #2563eb; /* blue-600 */
    margin-bottom: 32px;
`;

const TimeOptionsGrid = styled(View)`
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    gap: 16px;
    width: 100%;
    max-width: 300px;
`;

const TimeOptionButton = styled(TouchableOpacity)`
    background-color: #dbeafe; /* blue-100 */
    padding: 16px;
    border-radius: 8px;
    width: 45%;
    align-items: center;
`;

const TimeOptionText = styled(Text)`
    color: #1d4ed8; /* blue-700 */
    font-weight: 600;
`;

const CancelButton = styled(TouchableOpacity)`
  background-color: #1f2937;
  padding: 16px;
  border-radius: 9999px;
  align-items: center;
  margin-top: 16px;
  width: 100%;
`;

const ButtonText = styled(Text)`
  color: white;
  font-size: 18px;
  font-weight: bold;
`;


const TIME_OPTIONS = [
  { label: '15 min', value: 15 * 60 }, { label: '30 min', value: 30 * 60 },
  { label: '1 hour', value: 60 * 60 }, { label: '2 hours', value: 120 * 60 },
];

const CheckInScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { onEmergency } = route.params as { onEmergency: () => void; };

  // The deadline is the source of truth, not a counter. Decrementing once per
  // tick silently loses time whenever the JS thread is paused (backgrounded,
  // Doze, Low Power Mode), so a check-in that should have expired would not
  // fire. Deriving from a wall-clock deadline makes the timer correct the
  // moment the app runs again.
  //
  // KNOWN LIMIT: this still only fires while the app is alive. Firing a missed
  // check-in from a terminated app needs a scheduled background task, which is
  // Phase 1 work (see docs/specs/SAFETY_CHECK.md).
  const [deadline, setDeadline] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  const onClose = useCallback(() => navigation.goBack(), [navigation]);

  useEffect(() => {
    if (deadline === null) {
      setTimeLeft(null);
      return;
    }
    const tick = () => setTimeLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  useEffect(() => {
    if (deadline === null || timeLeft === null || timeLeft > 0) return;
    setDeadline(null);
    onClose();
    onEmergency();
  }, [deadline, timeLeft, onClose, onEmergency]);

  const handleStartTimer = (seconds: number) => setDeadline(Date.now() + seconds * 1000);

  const handleCancelTimer = () => {
    setDeadline(null);
    onClose();
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  return (
    <Container>
      <Header>
        <BackButton onPress={onClose}>
          <IconArrowLeft size={24} color="#1f2937" />
        </BackButton>
        <Title>Scheduled Check-In</Title>
      </Header>
      
      <DemoBanner>
        A missed check-in opens the SOS screen locally. No contact is messaged,
        and the timer only runs while this app is open.
      </DemoBanner>

      <Body>
        {timeLeft !== null ? (
          <>
            <Description>Check-in required in:</Description>
            <TimerText>{formatTime(timeLeft)}</TimerText>
            <Description style={{fontSize: 12}}>If the timer runs out, Lumo opens the SOS screen on this phone. It does not yet contact anyone for you.</Description>
          </>
        ) : (
          <>
            <IconTimer size={96} color="#3b82f6" style={{marginBottom: 16}}/>
            <Description>Set a timer. If you don't cancel it in time, Lumo opens the SOS screen on this phone.</Description>
            <TimeOptionsGrid>
              {TIME_OPTIONS.map(opt => (
                <TimeOptionButton key={opt.value} onPress={() => handleStartTimer(opt.value)}>
                  <TimeOptionText>{opt.label}</TimeOptionText>
                </TimeOptionButton>
              ))}
            </TimeOptionsGrid>
          </>
        )}
      </Body>

      {timeLeft !== null && (
        <CancelButton onPress={handleCancelTimer}>
          <ButtonText>I'm Safe, Cancel Timer</ButtonText>
        </CancelButton>
      )}
    </Container>
  );
};

export default CheckInScreen;