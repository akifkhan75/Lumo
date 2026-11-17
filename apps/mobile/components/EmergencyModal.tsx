import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Linking, ScrollView } from 'react-native';
import styled from 'styled-components/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { UserSettings } from '../types';
import { getSelfDefenseTips } from '../services/apiService';
import { IconArrowLeft, IconVolumeUp, IconZap } from '../constants';
import { emergencyNumbersFor, PROFILES, resolveRegion } from '@lumo/region-profiles';
import { useLocation } from '../hooks/useLocation';
import { useSos } from '../hooks/useSos';
import { contactRows, headline, reasonText } from '../services/sosLedger';
import { secondsLeft, type SosTrigger } from '../services/sosCountdown';
import { openOfflineText } from '../services/deviceText';
import { agreedForCache, offlineTextBody, textStatusLine, TEXT_BUTTON, TEXT_BUTTON_LABEL, TEXT_EXPLAINER, type CachedContact } from '../services/offlineText';
import { loadOfflineContacts } from '../services/apiService';

const Container = styled(View)`
  flex: 1;
  justify-content: space-between;
  padding: 16px;
  background-color: #475569; /* slate-600 — deliberately not an "active" colour */
`;

const Header = styled(View)`
  padding-top: 40px;
`;

const BackButton = styled(TouchableOpacity)`
  width: 40px;
  height: 40px;
  justify-content: center;
  align-items: center;
  background-color: rgba(255, 255, 255, 0.2);
  border-radius: 8px;
`;

const TitleContainer = styled(View)`
  margin-top: 16px;
`;

const Subtitle = styled(Text)`
  font-size: 24px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
`;

const Title = styled(Text)`
  font-size: 36px;
  font-weight: bold;
  color: white;
`;

const Description = styled(Text)`
  margin-top: 8px;
  font-size: 16px;
  color: rgba(255, 255, 255, 0.8);
  max-width: 90%;
`;

const MainContent = styled(View)`
  flex: 1;
  align-items: center;
  justify-content: center;
  margin-vertical: 8px;
`;

const Footer = styled(View)`
  gap: 12px;
`;

const BottomButton = styled(TouchableOpacity)`
    width: 100%;
    background-color: black;
    color: white;
    font-weight: bold;
    padding: 16px 24px;
    border-radius: 9999px;
    align-items: center;
`;

const ButtonText = styled(Text)`
    color: white;
    font-size: 18px;
    font-weight: bold;
`;

const CallButton = styled(TouchableOpacity)`
    width: 100%;
    min-height: 56px;
    background-color: #dc2626; /* red-600 */
    padding: 16px 24px;
    border-radius: 9999px;
    align-items: center;
    justify-content: center;
`;

// White on the slate background is about 7.6:1, and the message is bold and bordered,
// so it does not rely on colour to read as a problem.
const DialErrorText = styled(Text)`
    color: white;
    font-size: 16px;
    font-weight: bold;
    text-align: center;
    margin: 12px 0;
    padding: 12px;
    border: 2px solid white;
    border-radius: 12px;
`;

const CancelButton = styled(TouchableOpacity)`
    width: 100%;
    min-height: 56px;
    background-color: white;
    padding: 16px 24px;
    border-radius: 9999px;
    align-items: center;
    justify-content: center;
`;
const CancelText = styled(Text)`
    color: #0f172a;
    font-size: 20px;
    font-weight: bold;
`;
const Big = styled(Text)`
    font-size: 64px;
    font-weight: bold;
    color: white;
    text-align: center;
`;
const Note = styled(Text)`
    color: rgba(255, 255, 255, 0.85);
    font-size: 15px;
    margin-top: 8px;
`;
const RowCard = styled(View)`
    padding: 12px;
    margin-top: 8px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.4);
    background-color: rgba(255, 255, 255, 0.08);
`;
const RowName = styled(Text)`
    color: white;
    font-size: 17px;
    font-weight: bold;
`;
const RowLine = styled(Text)`
    color: white;
    font-size: 15px;
    margin-top: 2px;
`;
const FailedScreen = styled(View)`
    flex: 1;
    padding: 24px;
    justify-content: center;
    background-color: #7f1d1d;
`;

const DefenseGuide = ({ onFinish }: { onFinish: () => void }) => {
    const [tips, setTips] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        getSelfDefenseTips().then(setTips).catch(() => setTips(["Yell 'FIRE!' for attention."])).finally(() => setIsLoading(false));
    }, []);

    return (
        <View style={StyleSheet.absoluteFill}>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 20, alignItems: 'center', justifyContent: 'center', padding: 32 }]}>
                <Text style={{fontSize: 28, fontWeight: 'bold', color: 'white', marginBottom: 16, textAlign: 'center'}}>SELF-DEFENSE MODE</Text>
                 <IconVolumeUp size={48} color="#fbbF04" />
                 <Text style={{fontWeight: '600', color: '#fbbF04', marginBottom: 24, marginTop: 16}}>Alarm not implemented — no sound is playing</Text>
                {isLoading ? <ActivityIndicator color="white" /> : <Text style={{fontSize: 18, color: 'white', textAlign: 'center', minHeight: 60}}>{tips[0] || ''}</Text>}
                <TouchableOpacity onPress={onFinish} style={{marginTop: 32, backgroundColor: 'white', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 999}}>
                    <Text style={{color: 'black', fontWeight: 'bold'}}>End Defense Mode</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};



const styles = StyleSheet.create({
  possible: { minHeight: 44, justifyContent: 'center' },
  failedList: { marginVertical: 12 },
  ledger: { alignSelf: 'stretch' },
  defenseRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginVertical: 8 },
  defenseItem: { alignItems: 'center' },
  defenseBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#f59e0b', justifyContent: 'center', alignItems: 'center' },
  defenseLabel: { color: 'white', fontSize: 12, fontWeight: '600', marginTop: 4 },
});

const dial = (number: string) => Linking.openURL(`tel:${number}`);

const clockOf = (ms: number | null) => (ms ? new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

const EmergencyScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const params = route.params as { settings?: UserSettings; trigger?: SosTrigger; resume?: boolean; incidentId?: string } | undefined;
  const settings = params?.settings;

  const [showDefenseGuide, setShowDefenseGuide] = useState(false);
  const [dialError, setDialError] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const onClose = () => navigation.goBack();

  // Position is READ here, never asked for: permission is requested on the dashboard, on a tap. A position helps
  // the alert and picks the right emergency number; the screen works without one.
  const location = useLocation(true);
  const shareLocation = settings?.security?.shareLocationOnSos !== false;

  const buildInput = useCallback(() => {
    const fix = location.fix;
    if (!fix || !shareLocation) return {};
    const place = location.geocoded?.ok && location.geocoded.place.country
      ? { country: location.geocoded.place.country, subdivision: location.geocoded.place.subdivision ?? null }
      : undefined;
    return { location: { latitude: fix.latitude, longitude: fix.longitude, accuracyM: fix.accuracyM, capturedAt: fix.capturedAt }, ...(place ? { place } : {}) };
  }, [location.fix, location.geocoded, shareLocation]);

  const sos = useSos({ buildInput });
  const { state } = sos;

  // The number comes from WHERE THE DEVICE IS, not from the account.
  const numbers = useMemo(() => {
    const fix = location.fix;
    const place = location.geocoded?.ok ? location.geocoded.place : null;
    const resolution = resolveRegion(
      { now: tick, fix: fix && place?.country ? { country: place.country, subdivision: place.subdivision, capturedAt: fix.capturedAt, accuracyM: fix.accuracyM } : fix ? { country: '', capturedAt: fix.capturedAt, accuracyM: fix.accuracyM } : null },
      PROFILES,
    );
    return emergencyNumbersFor(resolution);
  }, [location.fix, location.geocoded, tick]);
  const primary = numbers.numbers[0];

  // The press registers at once and does not wait on anything. A screen opened to LOOK (resume) does not start a new one.
  useEffect(() => {
    if (params?.incidentId) { sos.watch(params.incidentId).catch(() => undefined); return; }
    if (params?.resume) { sos.resume().catch(() => undefined); return; }
    if (params?.trigger) sos.start(params.trigger);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A clock for the countdown only while there is one.
  useEffect(() => {
    if (state.phase !== 'counting' && state.phase !== 'unreachable' && state.phase !== 'cancelling') return;
    const h = setInterval(() => setTick(Date.now()), 250);
    return () => clearInterval(h);
  }, [state.phase]);

  const openDialler = () => {
    setDialError(false);
    dial(primary?.number ?? '').catch(() => setDialError(true));
  };

  const dialLabel = primary ? primary.number : 'your local emergency number';
  const DialButtons = (
    <>
      <CallButton onPress={openDialler} accessibilityRole="button" accessibilityLabel={`Open the phone dialler to call ${dialLabel}`}>
        <ButtonText>{primary ? `Call ${primary.number}` : 'Open phone dialler'}</ButtonText>
      </CallButton>
      {numbers.possibleNumbers.map(n => (
        <TouchableOpacity key={n.number} onPress={() => dial(n.number).catch(() => setDialError(true))} accessibilityRole="button"
          accessibilityLabel={`Possible local number ${n.number}, ${n.label}. Open the phone dialler`} style={styles.possible}>
          <Note>Might work where you are: {n.label} {n.number}</Note>
        </TouchableOpacity>
      ))}
      {!numbers.verified ? <Note>This number has not been verified for where you are. Check it before relying on it.</Note> : null}
      {dialError ? (
        <DialErrorText accessibilityRole="alert" accessibilityLiveRegion="assertive">
          Could not open the phone dialler. Open your phone app and dial your local emergency number.
        </DialErrorText>
      ) : null}
    </>
  );

  const incident = state.incident;

  // ----- The pre-filled text (docs/specs/OFFLINE_SOS.md): offered exactly when Lumo does not have the alert, so there is something the person can
  // do with no signal. Lumo writes and addresses it; the PERSON presses send, from their own phone. It is never described as Lumo sending.
  const [cached, setCached] = useState<CachedContact[]>([]);
  const [textNote, setTextNote] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    Promise.resolve(loadOfflineContacts()).then(c => { if (!off && Array.isArray(c)) setCached(c); }).catch(() => undefined);
    return () => { off = true; };
  }, []);
  const textContacts = cached.length > 0 ? cached : agreedForCache(settings?.trustedContacts);
  const offerText = state.phase === 'unreachable' || state.phase === 'cannot' || incident?.state === 'ALL_CHANNELS_FAILED';
  const composeText = async () => {
    const fix = location.fix ? { latitude: location.fix.latitude, longitude: location.fix.longitude, accuracyM: location.fix.accuracyM, capturedAt: location.fix.capturedAt } : null;
    const status = await openOfflineText(textContacts, offlineTextBody(fix, Date.now()));
    setTextNote(textStatusLine(status, textContacts.map(c => c.name)));
  };
  const TextBlock = offerText ? (
    <>
      <BottomButton onPress={composeText} accessibilityRole="button" accessibilityLabel={TEXT_BUTTON_LABEL}>
        <ButtonText>{TEXT_BUTTON}</ButtonText>
      </BottomButton>
      <Note>{TEXT_EXPLAINER}</Note>
      {/* Who it will be addressed to, BEFORE it opens: the person can see it, and a contact they know has withdrawn is not a surprise. */}
      {textContacts.length > 0 ? <Note accessibilityLiveRegion="polite">{`It will be addressed to: ${textContacts.map(c => c.name).join(', ')}.`}</Note> : null}
      {textNote ? <Note accessibilityLiveRegion="polite">{textNote}</Note> : null}
    </>
  ) : null;

  // ----- Nothing got out: a full screen, with the next action, never a toast.
  if (incident?.state === 'ALL_CHANNELS_FAILED') {
    return (
      <FailedScreen>
        <Title accessibilityRole="header">Nobody was reached</Title>
        <Description>Your alert did not get through to any of your contacts. Call for help now.</Description>
        <ScrollView style={styles.failedList}>
          {contactRows(incident).map(r => (
            <RowCard key={r.recipientId}>
              <RowName>{r.name}</RowName>
              {r.lines.map(l => <RowLine key={l}>{l}</RowLine>)}
            </RowCard>
          ))}
          {incident.attempts.length === 0 ? <Note>You have no contact who has agreed to be alerted.</Note> : null}
        </ScrollView>
        {TextBlock}
        {DialButtons}
        <BottomButton onPress={onClose} accessibilityRole="button" accessibilityLabel="Close the emergency screen"><ButtonText>Close</ButtonText></BottomButton>
      </FailedScreen>
    );
  }

  let title = 'Nothing has been sent';
  let description = settings?.personalInfo?.bloodType ? `Your saved blood type is ${settings.personalInfo.bloodType}. ` : '';
  const left = secondsLeft(state.countdownEndsAt, tick);

  if (state.phase === 'idle') {
    description += 'No alert has been started. If you need help now, call your local emergency number.';
  } else if (state.phase === 'requesting') {
    description += 'Starting your alert. Nothing has been sent yet.';
  } else if (state.phase === 'counting') {
    title = left !== null ? `Alerting your contacts in ${left}` : 'Alerting your contacts soon';
    description += 'Nothing has been sent yet. Cancel now to stop it.';
  } else if (state.phase === 'unreachable') {
    // The press is saved on this phone and Lumo keeps trying. Nothing has gone: say so, say what Lumo will try, and what it needs from them.
    const retryIn = state.retryAt ? Math.max(0, Math.ceil((state.retryAt - tick) / 1000)) : null;
    description += `No signal, or Lumo can't be reached. ${state.error ? `${state.error} ` : ''}Lumo will keep trying, and will try to alert your contacts as soon as it can, as long as Lumo stays open. To get help now, call ${dialLabel}.`;
    if (left !== null && left > 0) description += ` Your alert is set to start in ${left} seconds. Cancel to stop it.`;
    if (retryIn !== null) description += ` Trying again in ${retryIn} s.`;
  } else if (state.phase === 'tooLate') {
    title = 'Too long ago to send';
    description += 'This was triggered too long ago to alert your contacts, so nothing was sent. Call your local emergency number now.';
  } else if (state.phase === 'cancelling') {
    title = 'Cancelled on this phone';
    description += "Lumo couldn't be reached to confirm, so it will keep trying. If your request had already reached Lumo, your contacts may still be told. If you need help, call your local emergency number.";
  } else if (state.phase === 'cannot') {
    description += "You're not signed in here, so Lumo cannot alert your contacts. Call your local emergency number now.";
  } else if (incident) {
    title = headline(incident);
    description += incident.locationAvailable ? 'Your last known location was included.' : "Your location was not included.";
    // A press Lumo could only send later says so, in the same terms it told the contacts.
    const late = incident.lateBySeconds ?? 0;
    if (late >= 120) description += ` Lumo could only reach its server about ${Math.round(late / 60)} minutes after you pressed it. Contacts it tries are told how late it is.`;
  }

  const rows = incident ? contactRows(incident) : [];
  // The plan, in plain words: if nobody answers, who is tried next and roughly when. "Will try", never a promise.
  const esc = incident?.escalation;
  const nextStep = esc && esc.phase === 'RUNNING' && esc.stepOrder !== null && esc.stepOrder < esc.steps && esc.nextStepAt
    ? `If nobody responds, Lumo will try the next contact at about ${clockOf(esc.nextStepAt)}.`
    : null;
  const live = state.phase === 'live' && incident;
  const ended = incident?.state === 'CLOSED' || incident?.state === 'CANCELLED';

  return (
    <Container>
      {showDefenseGuide && <DefenseGuide onFinish={() => setShowDefenseGuide(false)} />}
      <Header>
        <BackButton onPress={onClose} accessibilityRole="button" accessibilityLabel="Close the emergency screen">
          <IconArrowLeft size={24} color="white" />
        </BackButton>
        <TitleContainer>
          <Subtitle>SOS</Subtitle>
          <Title accessibilityRole="header" accessibilityLiveRegion="polite">{title}</Title>
          <Description accessibilityLiveRegion="polite">{description}</Description>
        </TitleContainer>
      </Header>

      <MainContent>
        {state.phase === 'requesting' ? <ActivityIndicator color="white" size="large" /> : null}
        {state.phase === 'counting' && left !== null ? <Big accessibilityLabel={`${left} seconds`}>{left}</Big> : null}
        {live ? (
          <ScrollView style={styles.ledger}>
            {state.stale ? <Note accessibilityLiveRegion="polite">Can't refresh right now. This was last updated {clockOf(state.lastUpdatedAt)}.</Note> : null}
            {incident.capped.length > 0 ? (
              <DialErrorText accessibilityRole="alert">
                {`Today's limit was reached, so ${incident.capped.length === 1 ? 'one contact was' : `${incident.capped.length} contacts were`} not alerted.`}
              </DialErrorText>
            ) : null}
            {rows.map(r => (
              <RowCard key={r.recipientId}>
                <RowName>{r.name}</RowName>
                {r.lines.map(l => <RowLine key={l}>{l}</RowLine>)}
              </RowCard>
            ))}
            {nextStep ? <Note accessibilityLiveRegion="polite">{nextStep}</Note> : null}
            {rows.length === 0 ? <Note>{reasonText('NO_ADDRESS')}.</Note> : null}
          </ScrollView>
        ) : null}
        {state.tooLateToCancel ? <Note accessibilityLiveRegion="polite">It is too late to cancel: the alert has gone out. End it instead.</Note> : null}
        {state.error && state.phase === 'live' ? <Note accessibilityLiveRegion="polite">{state.error}</Note> : null}
      </MainContent>

      <Footer>
        {state.phase === 'counting' ? (
          <CancelButton onPress={sos.cancel} accessibilityRole="button" accessibilityLabel="Cancel the alert. Nothing has been sent yet">
            <CancelText>Cancel</CancelText>
          </CancelButton>
        ) : null}
        {/* While a request is in flight Lumo has not answered, so nothing is confirmed sent and the person must be able to stop it. With no signal a
            request can hang for its whole timeout: Cancel must not disappear for that long. */}
        {state.phase === 'requesting' ? (
          <CancelButton onPress={sos.cancel} accessibilityRole="button" accessibilityLabel="Cancel the alert. Nothing has been sent">
            <CancelText>Cancel</CancelText>
          </CancelButton>
        ) : null}
        {state.phase === 'unreachable' ? (
          <>
            <BottomButton onPress={sos.retry} accessibilityRole="button" accessibilityLabel="Try to start the alert again">
              <ButtonText>Try now</ButtonText>
            </BottomButton>
            {/* Nothing has been confirmed sent, so cancelling is always on offer while Lumo cannot be reached. */}
            <CancelButton onPress={sos.cancel} accessibilityRole="button" accessibilityLabel="Cancel the alert. Nothing has been sent">
              <CancelText>Cancel</CancelText>
            </CancelButton>
          </>
        ) : null}
        {live && !ended ? (
          <BottomButton onPress={sos.resolve} accessibilityRole="button" accessibilityLabel="End the alert. Contacts who were alerted will be told it ended">
            <ButtonText>I'm safe — end the alert</ButtonText>
          </BottomButton>
        ) : null}
        <View style={styles.defenseRow}>
          <TouchableOpacity onPress={() => setShowDefenseGuide(true)} style={styles.defenseItem} accessibilityRole="button" accessibilityLabel="Open defense mode">
            <View style={styles.defenseBadge}>
              <IconZap size={32} color="white" />
            </View>
            <Text style={styles.defenseLabel}>Defense</Text>
          </TouchableOpacity>
        </View>
        {TextBlock}
        {DialButtons}
        <BottomButton onPress={onClose} accessibilityRole="button" accessibilityLabel="Close the emergency screen">
          <ButtonText>Close</ButtonText>
        </BottomButton>
      </Footer>
    </Container>
  );
};

export default EmergencyScreen;
