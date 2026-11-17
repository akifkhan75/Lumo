import React, { useState } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView } from 'react-native';
import styled from 'styled-components/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { reportReceived } from '../services/pushService';

const Container = styled(SafeAreaView)`flex: 1; background-color: #1e293b; padding: 24px; justify-content: space-between;`;
const Title = styled(Text)`font-size: 30px; font-weight: bold; color: white;`;
const Body = styled(Text)`font-size: 18px; color: white; margin-top: 12px;`;
const Note = styled(Text)`font-size: 15px; color: rgba(255,255,255,0.85); margin-top: 12px;`;
const Primary = styled(TouchableOpacity)`min-height: 56px; justify-content: center; align-items: center; border-radius: 9999px; background-color: white; padding: 16px;`;
const PrimaryText = styled(Text)`font-size: 20px; font-weight: bold; color: #0f172a;`;
const Quiet = styled(TouchableOpacity)`min-height: 48px; justify-content: center; align-items: center; margin-top: 12px;`;
const QuietText = styled(Text)`font-size: 16px; font-weight: bold; color: white;`;

/**
 * Someone alerted this phone (docs/specs/NOTIFICATIONS.md). One decision: "I'm responding". It is reported to the server,
 * which tells THEM, and the screen says only what the server answered; it never claims they know before it does.
 */
export default function ContactAlertScreen() {
  const navigation = useNavigation();
  const p = (useRoute().params ?? {}) as { attemptId?: string; title?: string; body?: string; responded?: boolean };
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'already' | 'failed'>(p.responded ? 'done' : 'idle');

  const respond = async () => {
    if (!p.attemptId) return;
    setState('sending');
    const r = await reportReceived(p.attemptId, 'acknowledged');
    setState(r === null ? 'failed' : r.recorded ? 'done' : 'already');
  };

  return (
    <Container>
      <View>
        <Title accessibilityRole="header">{p.title ?? 'Lumo alert'}</Title>
        <Body>{p.body ?? 'Someone asked Lumo to alert you.'}</Body>
        <Note>If this looks serious and you cannot reach them, call your local emergency number. Lumo does not contact emergency services.</Note>
        <Note accessibilityLiveRegion="polite">
          {state === 'done' ? "Your answer was sent. They'll see that you are responding." : null}
          {state === 'already' ? "Your answer had already been recorded." : null}
          {state === 'failed' ? "Couldn't send your answer just now. Check your connection and try again." : null}
          {state === 'sending' ? 'Sending…' : null}
        </Note>
      </View>
      <View>
        {state !== 'done' && state !== 'already' ? (
          <Primary onPress={respond} accessibilityRole="button" accessibilityLabel="I'm responding. Tells them you are on it">
            <PrimaryText>I'm responding</PrimaryText>
          </Primary>
        ) : null}
        <Quiet onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Close"><QuietText>Close</QuietText></Quiet>
      </View>
    </Container>
  );
}
