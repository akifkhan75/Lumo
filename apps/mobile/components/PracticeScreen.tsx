import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import styled from 'styled-components/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { UserSettings } from '@lumo/types';
import { IconArrowLeft } from '../constants';
import { useSos } from '../hooks/useSos';
import { contactRows } from '../services/sosLedger';
import { secondsLeft } from '../services/sosCountdown';
import { localPracticeIncident } from '../services/practiceLocal';
import { contactsNote, INTRO, OFFLINE_NOTE, PRACTICE_BANNER, PRACTICE_RESULT_NOTE, practiceHeadline, REAL_HELP_LABEL, SIGNED_OUT_NOTE } from '../services/practiceCopy';

// Deliberately NOT the emergency screen's slate, and with the banner always on top: a rehearsal must not look like the real thing.
const Container = styled(View)`flex: 1; background-color: #312e81;`;
const Banner = styled(View)`background-color: #fde047; padding: 14px 16px; padding-top: 44px; border-bottom-width: 4px; border-bottom-color: #111827;`;
const BannerText = styled(Text)`font-size: 18px; font-weight: 800; color: #111827; text-align: center;`;
const Header = styled(View)`flex-direction: row; align-items: center; padding: 12px 16px;`;
const Back = styled(TouchableOpacity)`width: 44px; height: 44px; justify-content: center; align-items: center; border-radius: 8px; background-color: rgba(255,255,255,0.2);`;
const Title = styled(Text)`flex: 1; font-size: 26px; font-weight: bold; color: white; margin-left: 12px;`;
const Body = styled(Text)`font-size: 16px; color: rgba(255,255,255,0.92); margin-top: 8px;`;
const Strong = styled(Text)`font-size: 20px; font-weight: bold; color: white; margin-top: 12px;`;
const Big = styled(Text)`font-size: 64px; font-weight: bold; color: white; text-align: center; margin-top: 12px;`;
const Primary = styled(TouchableOpacity)`min-height: 56px; justify-content: center; align-items: center; margin-top: 14px; padding: 14px 20px; border-radius: 9999px; background-color: white;`;
const PrimaryText = styled(Text)`font-size: 18px; font-weight: bold; color: #312e81;`;
const Quiet = styled(TouchableOpacity)`min-height: 56px; justify-content: center; align-items: center; margin-top: 12px; padding: 14px 20px; border-radius: 9999px; border-width: 2px; border-color: white;`;
const QuietText = styled(Text)`font-size: 17px; font-weight: bold; color: white;`;
const Real = styled(TouchableOpacity)`min-height: 56px; justify-content: center; align-items: center; margin-top: 12px; padding: 14px 20px; border-radius: 9999px; background-color: #dc2626;`;
const RealText = styled(Text)`font-size: 17px; font-weight: bold; color: white;`;
const Card = styled(View)`padding: 12px; margin-top: 8px; border-radius: 12px; border-width: 1px; border-color: rgba(255,255,255,0.5); background-color: rgba(255,255,255,0.1);`;
const CardName = styled(Text)`color: white; font-size: 17px; font-weight: bold;`;
const CardLine = styled(Text)`color: white; font-size: 15px; margin-top: 2px;`;
const Notice = styled(Text)`font-size: 15px; font-weight: 600; color: white; margin-top: 12px; padding: 12px; border-width: 2px; border-color: white; border-radius: 12px;`;

const styles = StyleSheet.create({ scroll: { paddingHorizontal: 16, paddingBottom: 32 } });

/**
 * Practice (docs/specs/PRACTICE_MODE.md, RES-18): the real SOS path with the sending taken out.
 *
 * Differences from the emergency screen, all deliberate:
 *  - the banner "Practice — nobody will be contacted" is on screen in EVERY state;
 *  - there is NO "call the emergency number" button here, so a rehearsal cannot place a call; instead a plainly labelled way out opens the
 *    real emergency screen, in case the person needs real help;
 *  - it asks the server for a practice run and never writes the saved "SOS in progress" record (`useSos` with `practice`);
 *  - if Lumo cannot be reached it runs on the phone from the saved contacts, and says so.
 */
export default function PracticeScreen() {
  const navigation = useNavigation<any>();
  const settings = (useRoute().params as { settings?: UserSettings } | undefined)?.settings;
  const [tick, setTick] = useState(Date.now());
  const [started, setStarted] = useState(false);
  const buildInput = useCallback(() => ({}), []);
  const sos = useSos({ buildInput, practice: true });
  const { state } = sos;

  useEffect(() => {
    if (state.phase !== 'counting') return;
    const h = setInterval(() => setTick(Date.now()), 250);
    return () => clearInterval(h);
  }, [state.phase]);

  const begin = () => { setStarted(true); sos.start('manual'); };
  const openReal = () => navigation.navigate('Emergency', { settings });
  const close = () => navigation.goBack();

  // The same run, on the phone, only when Lumo could not be reached. Built once per failure.
  const local = useMemo(() => (state.phase === 'unreachable' ? localPracticeIncident(settings, Date.now()) : null), [state.phase, settings]);
  const incident = local ?? state.incident;
  const left = secondsLeft(state.countdownEndsAt, tick);
  const ended = incident?.state === 'CLOSED' || incident?.state === 'CANCELLED';
  const live = incident && (state.phase === 'live' || local);

  return (
    <Container>
      <Banner accessibilityRole="header" accessibilityLiveRegion="polite"><BannerText>{PRACTICE_BANNER}</BannerText></Banner>
      <Header>
        <Back onPress={close} accessibilityRole="button" accessibilityLabel="Close practice"><IconArrowLeft size={24} color="white" /></Back>
        <Title accessibilityRole="header">Practise an emergency</Title>
      </Header>
      <ScrollView contentContainerStyle={styles.scroll}>
        {!started ? (
          <>
            {INTRO.map(l => <Body key={l}>{l}</Body>)}
            <Notice>{contactsNote(settings)}</Notice>
            <Primary onPress={begin} accessibilityRole="button" accessibilityLabel="Start a practice run. Nobody will be contacted"><PrimaryText>Start practice</PrimaryText></Primary>
          </>
        ) : null}

        {state.phase === 'requesting' ? <ActivityIndicator color="white" size="large" accessibilityLabel="Starting practice" /> : null}

        {state.phase === 'counting' ? (
          <>
            <Strong accessibilityLiveRegion="polite">{left !== null ? `Practice alert in ${left}` : 'Practice alert soon'}</Strong>
            <Body>This is how long you have to cancel a real one. Nothing is sent either way.</Body>
            {left !== null ? <Big accessibilityLabel={`${left} seconds`}>{left}</Big> : null}
            <Quiet onPress={sos.cancel} accessibilityRole="button" accessibilityLabel="Cancel the practice run"><QuietText>Cancel</QuietText></Quiet>
          </>
        ) : null}

        {state.phase === 'cannot' ? <Notice accessibilityRole="alert">{SIGNED_OUT_NOTE}</Notice> : null}
        {local ? <Notice accessibilityLiveRegion="polite">{OFFLINE_NOTE}</Notice> : null}

        {live && incident ? (
          <>
            <Strong accessibilityRole="header" accessibilityLiveRegion="polite">{ended ? (incident.state === 'CANCELLED' ? 'Practice cancelled' : 'Practice finished') : practiceHeadline(incident)}</Strong>
            <Body>{PRACTICE_RESULT_NOTE}</Body>
            {state.stale && !local ? <Body accessibilityLiveRegion="polite">Can't refresh right now.</Body> : null}
            {incident.state !== 'CANCELLED'
              ? contactRows(incident).map(r => (
                <Card key={r.recipientId}>
                  <CardName>{r.name}</CardName>
                  {r.lines.map(l => <CardLine key={l}>{l}</CardLine>)}
                </Card>
              ))
              : null}
            {incident.attempts.length === 0 && incident.state !== 'CANCELLED' ? <Body>There is nobody to try: no contact has agreed. A real SOS would tell you this, and offer the phone dialler.</Body> : null}
            {!ended && !local ? <Primary onPress={sos.resolve} accessibilityRole="button" accessibilityLabel="End the practice run"><PrimaryText>End practice</PrimaryText></Primary> : null}
            {ended || local ? <Primary onPress={close} accessibilityRole="button" accessibilityLabel="Close practice"><PrimaryText>Done</PrimaryText></Primary> : null}
          </>
        ) : null}

        {state.error && state.phase !== 'unreachable' ? <Notice accessibilityLiveRegion="polite">{state.error}</Notice> : null}

        {/* A rehearsal has no dialler. This is the way out, and it opens the REAL screen (which starts nothing by itself). */}
        <Real onPress={openReal} accessibilityRole="button" accessibilityLabel="This is practice. Open the real emergency screen if you need help now"><RealText>{REAL_HELP_LABEL}</RealText></Real>
      </ScrollView>
    </Container>
  );
}
