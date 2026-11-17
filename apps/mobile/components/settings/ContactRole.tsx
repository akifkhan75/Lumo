import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, SafeAreaView, Linking, ActivityIndicator } from 'react-native';
import styled from 'styled-components/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ApiError } from '@lumo/api-client';
import { IconArrowLeft } from '../../constants';
import * as api from '../../services/apiService';
import { inviteTokenFrom } from '../../services/inviteLink';
import { disablePush, enablePush, readPushStatus, type PushStatus } from '../../services/pushService';

const Container = styled(SafeAreaView)`flex: 1; background-color: white;`;
const Inner = styled(ScrollView)`flex: 1; padding: 16px;`;
const Header = styled(View)`flex-direction: row; align-items: center; margin-bottom: 16px;`;
const Back = styled(TouchableOpacity)`padding: 8px; min-width: 44px; min-height: 44px; justify-content: center;`;
const Title = styled(Text)`font-size: 24px; font-weight: bold; color: #1f2937; margin-left: 16px;`;
const H2 = styled(Text)`font-size: 18px; font-weight: bold; color: #1f2937; margin-top: 20px;`;
const Body = styled(Text)`font-size: 15px; color: #374151; margin-top: 8px;`;
const Status = styled(Text)`font-size: 16px; font-weight: 600; color: #111827; margin-top: 12px;`;
const Button = styled(TouchableOpacity)`min-height: 48px; justify-content: center; align-items: center; margin-top: 12px; padding: 12px 20px; border-radius: 9999px; background-color: #1e3a8a;`;
const Quiet = styled(Button)`background-color: white; border-width: 2px; border-color: #1e3a8a;`;
const ButtonText = styled(Text)`color: white; font-size: 16px; font-weight: bold;`;
const QuietText = styled(ButtonText)`color: #1e3a8a;`;
const Input = styled(TextInput)`min-height: 48px; margin-top: 12px; padding: 8px 12px; border-width: 2px; border-color: #d1d5db; border-radius: 8px; font-size: 16px; color: #111827;`;
const Spinner = styled(ActivityIndicator)`margin-top: 12px;`;
const Result = styled(Text)`font-size: 15px; font-weight: 600; color: #111827; margin-top: 12px; padding: 12px; border-width: 2px; border-color: #111827; border-radius: 12px;`;

const STATUS_TEXT: Record<PushStatus, string> = {
  not_configured: "This build of Lumo can't receive alerts yet (it has no push project set up).",
  off: 'Alerts on this phone are off.',
  denied: 'Alerts are off: permission was declined.',
  blocked: 'Alerts are off, and this phone will not ask again. Turn them on in Settings.',
  on: 'Alerts on this phone are on.',
  failed: "Couldn't turn alerts on just now. Check your connection and try again.",
};

/**
 * Being SOMEONE ELSE's emergency contact, from the app. Two things: joining with the link they sent you (which is what
 * lets Lumo reach this phone for them), and turning on alerts on this phone. Nothing here asks for permission by itself.
 */
export default function ContactRoleScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const prefilled = (route.params as { token?: string } | undefined)?.token;

  const [status, setStatus] = useState<PushStatus | 'checking'>('checking');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(prefilled ?? '');
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => { readPushStatus().then(setStatus).catch(() => setStatus('off')); }, []);

  const turnOn = useCallback(async () => { setBusy(true); setStatus(await enablePush()); setBusy(false); }, []);
  const turnOff = useCallback(async () => {
    setBusy(true);
    try { await disablePush(); setStatus('off'); } catch { setResult("Couldn't turn alerts off just now. Try again."); }
    setBusy(false);
  }, []);

  const join = useCallback(async () => {
    const token = inviteTokenFrom(text);
    if (!token) { setResult("That doesn't look like a Lumo link. Paste the whole link you were sent."); return; }
    setBusy(true);
    setResult(null);
    try {
      await api.claimContactInvite(token);
      setResult("You've joined as their contact. They can now alert this phone while alerts are on. Nothing has been sent to you.");
      setText('');
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'http' && e.status === 404) setResult("That link isn't valid, or it has run out. Ask them for a new one.");
      else if (e instanceof ApiError && e.kind === 'http' && e.status === 409) setResult(e.message);
      else if (e instanceof ApiError && e.kind === 'http' && e.status === 401) setResult('Sign in first, then try the link again.');
      else setResult("Couldn't reach Lumo just now. Check your connection and try again.");
    }
    setBusy(false);
  }, [text]);

  return (
    <Container>
      <Inner>
        <Header>
          <Back onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back"><IconArrowLeft size={24} color="#1f2937" /></Back>
          <Title>Being a contact</Title>
        </Header>

        <H2 accessibilityRole="header">Alerts on this phone</H2>
        <Body>
          If someone has chosen you as an emergency contact and you have joined with their link, Lumo can notify this phone. An alert that
          arrives while Lumo is closed may reach you but cannot be confirmed back to them.
        </Body>
        <Status accessibilityLiveRegion="polite">{status === 'checking' ? 'Checking…' : STATUS_TEXT[status]}</Status>
        {busy ? <Spinner /> : null}
        {!busy && (status === 'off' || status === 'denied' || status === 'failed') ? (
          <Button onPress={turnOn} accessibilityRole="button" accessibilityLabel="Turn on alerts on this phone"><ButtonText>Turn on alerts</ButtonText></Button>
        ) : null}
        {!busy && status === 'blocked' ? (
          <Button onPress={() => { Linking.openSettings().catch(() => undefined); }} accessibilityRole="button" accessibilityLabel="Open this app's settings to turn on notifications"><ButtonText>Open Settings</ButtonText></Button>
        ) : null}
        {!busy && status === 'on' ? (
          <Quiet onPress={turnOff} accessibilityRole="button" accessibilityLabel="Turn off alerts on this phone"><QuietText>Turn off alerts</QuietText></Quiet>
        ) : null}

        <H2 accessibilityRole="header">Join with a link</H2>
        <Body>Someone who wants you as a contact will send you a link. Paste it here to join from this account. Joining is also how you agree to be their contact.</Body>
        <Input
          value={text}
          onChangeText={setText}
          placeholder="Paste the link"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="The link you were sent"
        />
        <Button onPress={join} disabled={busy} accessibilityRole="button" accessibilityLabel="Join as their contact"><ButtonText>Join</ButtonText></Button>
        {result ? <Result accessibilityLiveRegion="polite" accessibilityRole="alert">{result}</Result> : null}
      </Inner>
    </Container>
  );
}
