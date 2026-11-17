import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, StyleSheet, Share, TextInput } from 'react-native';
import styled from 'styled-components/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { SessionKindName } from '@lumo/types';
import { IconArrowLeft } from '../constants';
import { useLocation } from '../hooks/useLocation';
import { useJourney } from '../hooks/useJourney';
import { useJourneyLocation } from '../hooks/useJourneyLocation';
import { useJourneyLinks } from '../hooks/useJourneyLinks';
import * as api from '../services/apiService';
import { cannotShareNoWebAddress, couldNotHandOver, createdNotice, indicatorTitle, linkLine, liveLinks, mayShareAgainNote, shareMessage, shareUrl, webBaseUrl, whatTheyWillSee } from '../services/journeyLinks';
import { alertsMayStartAt, clock, contactsTried, durationLabel, endedText, KIND_OPTIONS, kindOption, phaseOf, planLines, type ContactInfo } from '../services/journeyCopy';

const Container = styled(SafeAreaView)`flex: 1; background-color: white;`;
const Header = styled(View)`flex-direction: row; align-items: center; padding: 16px;`;
const Back = styled(TouchableOpacity)`padding: 8px; min-width: 44px; min-height: 44px; justify-content: center;`;
const Title = styled(Text)`font-size: 24px; font-weight: bold; color: #1f2937; margin-left: 12px;`;
const H2 = styled(Text)`font-size: 18px; font-weight: bold; color: #111827; margin-top: 20px;`;
const Body = styled(Text)`font-size: 15px; color: #374151; margin-top: 8px;`;
const Strong = styled(Text)`font-size: 17px; font-weight: 600; color: #111827; margin-top: 8px;`;
const Chip = styled(TouchableOpacity)<{ on: boolean }>`min-height: 44px; justify-content: center; padding: 8px 14px; margin: 4px 8px 4px 0; border-radius: 9999px; border-width: 2px; border-color: #1e3a8a; background-color: ${p => (p.on ? '#1e3a8a' : 'white')};`;
const ChipText = styled(Text)<{ on: boolean }>`font-size: 15px; font-weight: 600; color: ${p => (p.on ? 'white' : '#1e3a8a')};`;
const Big = styled(TouchableOpacity)`min-height: 56px; justify-content: center; align-items: center; margin-top: 14px; padding: 14px 20px; border-radius: 9999px; background-color: #1e3a8a;`;
const BigText = styled(Text)`font-size: 18px; font-weight: bold; color: white;`;
const Quiet = styled(Big)`background-color: white; border-width: 2px; border-color: #1e3a8a;`;
const QuietText = styled(BigText)`color: #1e3a8a;`;
const Notice = styled(Text)`font-size: 15px; font-weight: 600; color: #111827; margin-top: 12px; padding: 12px; border-width: 2px; border-color: #111827; border-radius: 12px;`;
const Row = styled(View)`flex-direction: row; flex-wrap: wrap;`;
const Ask = styled(View)`margin: 16px; padding: 16px; border-radius: 16px; background-color: #fef3c7; border-width: 2px; border-color: #b45309;`;
const AskTitle = styled(Text)`font-size: 28px; font-weight: bold; color: #451a03;`;

const Sharing = styled(View)`margin-top: 16px; padding: 12px; border-radius: 12px; border-width: 2px; border-color: #1e3a8a; background-color: #eff6ff;`;
const SharingTitle = styled(Text)`font-size: 16px; font-weight: 700; color: #1e3a8a;`;
const PinInput = styled(TextInput)`min-height: 48px; margin-top: 8px; padding: 8px 12px; font-size: 18px; border-width: 2px; border-color: #1e3a8a; border-radius: 12px; color: #111827; background-color: white;`;

const styles = StyleSheet.create({ scroll: { paddingHorizontal: 16, paddingBottom: 32 } });

// Where the page a link opens lives. A build without it cannot make a link anyone could open, and says so.
const webBase = () => webBaseUrl(process.env.EXPO_PUBLIC_WEB_URL, typeof __DEV__ !== 'undefined' && __DEV__);

/**
 * A journey: set it up (with the plan shown BEFORE it runs), keep it, answer it, end it (docs/specs/JOURNEYS.md).
 *
 * The SERVER keeps the deadline. This screen shows it and answers it; closing the app, or the phone dying, does not stop it. Contacts are
 * not told a journey started (KI-102); they hear only if a check-in goes unanswered, and the screen says so. Position is saved ONLY while
 * Lumo is open, with the state and a way to stop in plain view.
 */
export default function JourneyScreen() {
  const navigation = useNavigation<any>();
  const { state, start, checkIn, arrive, cancel, dismiss } = useJourney();
  const { journey } = state;
  const initial = ((useRoute().params as { kind?: SessionKindName } | undefined)?.kind) ?? 'walk_home';
  const [kind, setKind] = useState<SessionKindName>(initial);
  const [minutes, setMinutes] = useState<number>(kindOption(initial).minutes[0]);
  const [share, setShare] = useState(true);
  const [contacts, setContacts] = useState<ContactInfo[] | null>(null);
  const [tick, setTick] = useState(Date.now());

  useEffect(() => {
    let off = false;
    api.getSettings().then(s => { if (!off) setContacts(s.trustedContacts.map(c => ({ name: c.name, agreed: c.consentStatus === 'agreed' }))); }).catch(() => { if (!off) setContacts([]); });
    return () => { off = true; };
  }, []);
  useEffect(() => { const h = setInterval(() => setTick(Date.now()), 15_000); return () => clearInterval(h); }, []);

  // Position: read only while a journey that wants it is running; saved only with the person's own switch on.
  const phase = journey ? phaseOf(journey) : null;
  const running = phase === 'running' || phase === 'asking' || phase === 'alerted';
  const location = useLocation(running || journey === null);
  const [paused, setPaused] = useState(false);
  const saveOn = Boolean(journey?.shareLocation) && running && !paused && location.permission === 'granted';
  const saving = useJourneyLocation(journey?.id ?? null, location.fix, saveOn, r => { if (r.arrived || r.atDestination) { /* the next refresh shows it */ } });

  // Sharing: the live links are the SERVER's list, polled while the journey runs, so the indicator is what is true, not what we remember.
  const WEB_BASE = webBase();
  const links = useJourneyLinks(journey?.id ?? null, running);
  const live = liveLinks(links.state.links);
  const [pin, setPin] = useState('');
  const [madeNotice, setMadeNotice] = useState<string | null>(null);
  const pinOk = pin === '' || /^\d{4,8}$/.test(pin);

  const shareJourney = useCallback(async () => {
    if (!journey) return;
    setMadeNotice(null);
    const made = await links.create(pin ? { pin } : {});
    if (!made) return;
    setPin('');
    const url = shareUrl(WEB_BASE, made.path);
    if (!url) {
      // The link exists on the server but cannot be handed over: turn it off rather than leave one nobody can use and nobody can see.
      await links.revoke([made.id]);
      setMadeNotice(couldNotHandOver);
      return;
    }
    setMadeNotice(createdNotice);
    try { await Share.share({ message: shareMessage(url, null, made.hasPin) }); } catch { /* the link exists either way; the indicator shows it */ }
  }, [journey, links, pin, WEB_BASE]);

  const pick = (k: SessionKindName) => { setKind(k); setMinutes(kindOption(k).minutes[0]); };
  const arriveAt = useMemo(() => tick + minutes * 60_000, [tick, minutes]);
  const agreedCount = contacts?.filter(c => c.agreed).length ?? 0;

  const begin = useCallback(async () => { await start({ kind, expectedArrivalAt: new Date(Date.now() + minutes * 60_000).toISOString(), shareLocation: share }); }, [start, kind, minutes, share]);
  const more = (m: number) => checkIn(Date.now() + m * 60_000);

  const close = () => navigation.goBack();

  // The indicator: visible for as long as any link works, with the way to stop it beside it (invariant 4).
  const indicator = live.length > 0 ? (
    <Sharing accessibilityLiveRegion="polite">
      <SharingTitle accessibilityRole="header">{indicatorTitle(live)}</SharingTitle>
      {live.map(l => <Body key={l.id}>{linkLine(l)}</Body>)}
      {links.state.stale ? <Body>Can't refresh this right now, so it may be out of date.</Body> : null}
      <Quiet disabled={links.state.busy} onPress={() => links.revoke(live.map(l => l.id))} accessibilityRole="button" accessibilityLabel="Stop sharing. Turn off every link to this journey">
        <QuietText>Stop sharing</QuietText>
      </Quiet>
      {live.length > 1 ? live.map((l, i) => (
        <Quiet key={l.id} disabled={links.state.busy} onPress={() => links.revoke([l.id])} accessibilityRole="button" accessibilityLabel={`Turn off link ${i + 1} of ${live.length}`}>
          <QuietText>{`Turn off link ${i + 1}`}</QuietText>
        </Quiet>
      )) : null}
    </Sharing>
  ) : null;

  const shareControl = journey ? (
    <>
      <H2 accessibilityRole="header">Share this journey</H2>
      {WEB_BASE ? (
        <>
          <Body>{whatTheyWillSee(journey.shareLocation)}</Body>
          <Body>Lumo does not send the link. You choose who gets it, and it works for whoever has it until you turn it off.</Body>
          <PinInput value={pin} onChangeText={t => setPin(t.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad" secureTextEntry maxLength={8} placeholder="Optional PIN, 4 to 8 digits" accessibilityLabel="Optional PIN for the link, 4 to 8 digits. You give it to them separately" />
          {!pinOk ? <Body accessibilityLiveRegion="polite">A PIN is 4 to 8 digits.</Body> : null}
          <Big disabled={links.state.busy || !pinOk} onPress={shareJourney} accessibilityRole="button" accessibilityLabel="Make a link and choose who to share it with"><BigText>{links.state.busy ? 'Working…' : 'Share a link'}</BigText></Big>
          <Body>{mayShareAgainNote}</Body>
        </>
      ) : <Notice>{cannotShareNoWebAddress}</Notice>}
      {madeNotice ? <Notice accessibilityLiveRegion="polite">{madeNotice}</Notice> : null}
      {links.state.error ? <Notice accessibilityRole="alert" accessibilityLiveRegion="assertive">{links.state.error}</Notice> : null}
    </>
  ) : null;
  const errorLine = state.error ? <Notice accessibilityRole="alert" accessibilityLiveRegion="assertive">{state.error}</Notice> : null;

  // ------------------------------------------------------------ the question
  if (journey && phase === 'asking') {
    const mayStart = alertsMayStartAt(journey);
    return (
      <Container>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Ask accessibilityLiveRegion="assertive">
            <AskTitle accessibilityRole="header">Are you OK?</AskTitle>
            <Body>Your check-in is due. Only you have been asked so far.</Body>
            {mayStart ? <Strong>If you do not answer, Lumo may start trying to alert your contacts at about {clock(mayStart)}.</Strong> : null}
          </Ask>
          {errorLine}
          {indicator}
          <Big disabled={state.busy} onPress={() => more(15)} accessibilityRole="button" accessibilityLabel="I'm OK. Give me 15 more minutes"><BigText>I'm OK — 15 more minutes</BigText></Big>
          <Quiet disabled={state.busy} onPress={() => more(60)} accessibilityRole="button" accessibilityLabel="I'm OK. Give me an hour"><QuietText>I'm OK — an hour</QuietText></Quiet>
          <Quiet disabled={state.busy} onPress={arrive} accessibilityRole="button" accessibilityLabel="I've arrived. End the journey"><QuietText>I've arrived</QuietText></Quiet>
          {state.stale ? <Notice accessibilityLiveRegion="polite">Can't reach Lumo right now. Your answer will not count until it does. Try again.</Notice> : null}
        </ScrollView>
      </Container>
    );
  }

  // --------------------------------------------------------------- the rest
  return (
    <Container>
      <Header>
        <Back onPress={close} accessibilityRole="button" accessibilityLabel="Close"><IconArrowLeft size={24} color="#1f2937" /></Back>
        <Title accessibilityRole="header">Journey</Title>
      </Header>
      <ScrollView contentContainerStyle={styles.scroll}>
        {state.loading ? <ActivityIndicator accessibilityLabel="Loading" /> : null}
        {errorLine}
        {state.stale && !state.loading ? <Notice accessibilityLiveRegion="polite">Can't refresh right now. This was last updated {state.lastUpdatedAt ? clock(state.lastUpdatedAt) : 'a while ago'}. Your journey is still being kept by Lumo.</Notice> : null}

        {/* ---- none: set one up, with the plan shown before it runs */}
        {!state.loading && !journey ? (
          <>
            <Body>Tell Lumo where you are going and when you should be there. If you do not check in, Lumo asks you first, and only then tries your contacts.</Body>
            <H2 accessibilityRole="header">What kind of journey</H2>
            <Row>
              {KIND_OPTIONS.map(o => (
                <Chip key={o.kind} on={o.kind === kind} onPress={() => pick(o.kind)} accessibilityRole="button" accessibilityState={{ selected: o.kind === kind }} accessibilityLabel={`${o.label}. ${o.blurb}`}>
                  <ChipText on={o.kind === kind}>{o.label}</ChipText>
                </Chip>
              ))}
            </Row>
            <H2 accessibilityRole="header">How long</H2>
            <Row>
              {kindOption(kind).minutes.map(m => (
                <Chip key={m} on={m === minutes} onPress={() => setMinutes(m)} accessibilityRole="button" accessibilityState={{ selected: m === minutes }} accessibilityLabel={durationLabel(m)}>
                  <ChipText on={m === minutes}>{durationLabel(m)}</ChipText>
                </Chip>
              ))}
            </Row>
            <H2 accessibilityRole="header">What will happen</H2>
            {contacts === null ? <Body>Checking your contacts…</Body> : planLines(kind, arriveAt, contacts).map(l => <Body key={l}>{l}</Body>)}
            <H2 accessibilityRole="header">Your position</H2>
            <Row>
              <Chip on={share} onPress={() => setShare(true)} accessibilityRole="button" accessibilityState={{ selected: share }} accessibilityLabel="Save my position for this journey"><ChipText on={share}>Save it</ChipText></Chip>
              <Chip on={!share} onPress={() => setShare(false)} accessibilityRole="button" accessibilityState={{ selected: !share }} accessibilityLabel="Do not save my position"><ChipText on={!share}>Don't save it</ChipText></Chip>
            </Row>
            <Body>{share ? 'While Lumo is open, your position is saved for this journey. It is used only if a check-in goes unanswered, and no contact can see it otherwise.' : 'Your position is not saved. An alert, if it comes to that, would not include where you are.'}</Body>
            {share && location.permission === 'undetermined' ? (
              <Quiet onPress={location.request} accessibilityRole="button" accessibilityLabel="Allow Lumo to read your location while the app is open"><QuietText>Allow location</QuietText></Quiet>
            ) : null}
            {share && (location.permission === 'denied' || location.permission === 'blocked') ? <Notice>Location is off, so your position cannot be saved. You can still go.</Notice> : null}
            <Body>With no destination set, you end the journey yourself with "I've arrived". Lumo will not decide you have arrived from a timer.</Body>
            <Big disabled={state.busy || agreedCount === 0} onPress={begin} accessibilityRole="button" accessibilityLabel={`Start the ${kindOption(kind).label.toLowerCase()} journey for ${durationLabel(minutes)}`}>
              <BigText>{state.busy ? 'Starting…' : 'Start journey'}</BigText>
            </Big>
            {contacts !== null && agreedCount === 0 ? <Notice accessibilityLiveRegion="polite">None of your contacts has agreed to be alerted, so a journey cannot start. Ask someone to agree in Settings → Contact.</Notice> : null}
          </>
        ) : null}

        {/* ---- running */}
        {journey && phase === 'running' ? (
          <>
            <Strong>{`${kindOption(journey.kind).label} in progress`}</Strong>
            {journey.checkInDueAt ? <Body>You should arrive by {clock(new Date(journey.checkInDueAt).getTime())}.</Body> : null}
            <Body>{`If you have not checked in by then, Lumo will ask you first. If you do not answer within ${Math.round(journey.plan.graceSeconds / 60)} minutes, it will try to alert ${journey.plan.contacts.slice(0, contactsTried(journey.kind)).join(', then ') || 'your contacts'}.`}</Body>
            <Body>Lumo's server keeps this deadline even if your phone dies or the app is closed. Your contacts are not told about the journey itself.</Body>
            <H2 accessibilityRole="header">Your position</H2>
            <Body accessibilityLiveRegion="polite">
              {!journey.shareLocation ? 'Not saved: you chose not to.'
                : paused ? 'Not being saved: you stopped it.'
                : location.permission !== 'granted' ? 'Not being saved: location is off.'
                : saving.failing ? `Saving, but can't reach Lumo right now (${saving.pending} waiting).`
                : saving.lastSavedAt ? `Saved while Lumo is open. Last saved ${clock(saving.lastSavedAt)}.`
                : 'Saving while Lumo is open. Nothing saved yet.'}
            </Body>
            {journey.shareLocation && !paused && location.permission === 'granted' ? (
              <Quiet onPress={() => setPaused(true)} accessibilityRole="button" accessibilityLabel="Stop saving my position for this journey"><QuietText>Stop saving my position</QuietText></Quiet>
            ) : null}
            {indicator}
            <Big disabled={state.busy} onPress={arrive} accessibilityRole="button" accessibilityLabel="I've arrived. End the journey"><BigText>I've arrived</BigText></Big>
            <Quiet disabled={state.busy} onPress={() => more(15)} accessibilityRole="button" accessibilityLabel="I need 15 more minutes"><QuietText>I need 15 more minutes</QuietText></Quiet>
            <Quiet disabled={state.busy} onPress={cancel} accessibilityRole="button" accessibilityLabel="Cancel the journey. Nobody is told"><QuietText>Cancel the journey</QuietText></Quiet>
            {shareControl}
          </>
        ) : null}

        {/* ---- an alert went out */}
        {journey && phase === 'alerted' ? (
          <>
            <Notice accessibilityRole="alert">A check-in went unanswered, so Lumo is trying to alert your contacts.</Notice>
            {journey.incidentId ? (
              <Big onPress={() => navigation.navigate('Emergency', { incidentId: journey.incidentId })} accessibilityRole="button" accessibilityLabel="See who was alerted and call for help"><BigText>See who was alerted</BigText></Big>
            ) : null}
            <Quiet disabled={state.busy} onPress={arrive} accessibilityRole="button" accessibilityLabel="I'm safe. I've arrived. This ends the alert and tells the contacts who were alerted"><QuietText>I'm safe — I've arrived</QuietText></Quiet>
            {indicator}
          </>
        ) : null}

        {/* ---- over */}
        {journey && phase === 'ended' ? (
          <>
            <Strong accessibilityLiveRegion="polite">{endedText(journey.state)}</Strong>
            <Big onPress={dismiss} accessibilityRole="button" accessibilityLabel="Start another journey"><BigText>Start another</BigText></Big>
            <Quiet onPress={close} accessibilityRole="button" accessibilityLabel="Close"><QuietText>Close</QuietText></Quiet>
          </>
        ) : null}

        {journey && phase === 'other' ? <Body>This journey is paused. Open it again once you are back online.</Body> : null}
      </ScrollView>
    </Container>
  );
}
