import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, StyleSheet, Share } from 'react-native';
import styled from 'styled-components/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { IncidentTimeline } from '@lumo/types';
import { IconArrowLeft } from '../constants';
import * as api from '../services/apiService';
import { clock, entryText, lateText, outcomeText, PRACTICE_NOTE, timelineShareText, triggerLabel, whenLabel } from '../services/historyCopy';

const Container = styled(SafeAreaView)`flex: 1; background-color: white;`;
const Banner = styled(View)`background-color: #fde047; padding: 12px 16px; border-bottom-width: 4px; border-bottom-color: #111827;`;
const BannerText = styled(Text)`font-size: 16px; font-weight: 800; color: #111827; text-align: center;`;
const Header = styled(View)`flex-direction: row; align-items: center; padding: 16px;`;
const Back = styled(TouchableOpacity)`min-width: 48px; min-height: 48px; justify-content: center; align-items: center;`;
const Title = styled(Text)`flex: 1; font-size: 22px; font-weight: bold; color: #1f2937; margin-start: 12px;`;
const Body = styled(Text)`font-size: 15px; color: #374151; margin-top: 8px;`;
const Strong = styled(Text)`font-size: 18px; font-weight: bold; color: #111827; margin-top: 12px;`;
const Entry = styled(View)`flex-direction: row; padding: 10px 0; border-bottom-width: 1px; border-bottom-color: #e5e7eb;`;
const Time = styled(Text)`width: 84px; font-size: 13px; color: #4b5563;`;
const What = styled(Text)`flex: 1; font-size: 15px; color: #111827;`;
const Big = styled(TouchableOpacity)`min-height: 56px; justify-content: center; align-items: center; margin-top: 16px; padding: 14px 20px; border-radius: 9999px; background-color: #1e3a8a;`;
const BigText = styled(Text)`font-size: 17px; font-weight: bold; color: white;`;
const Notice = styled(Text)`font-size: 15px; font-weight: 600; color: #111827; margin-top: 12px; padding: 12px; border-width: 2px; border-color: #111827; border-radius: 12px;`;
const styles = StyleSheet.create({ scroll: { paddingHorizontal: 16, paddingBottom: 32 } });

/**
 * One incident, in order (docs/specs/INCIDENT_HISTORY.md, PRO-9). Sharing asks the server for the EXPORT form, which writes the audit log:
 * the share is the act that leaves the app, so that is what is recorded. Viewing is not. The shared text has names and times, and no
 * position or number, because the export has none.
 */
export default function IncidentTimelineScreen() {
  const navigation = useNavigation<any>();
  const id = ((useRoute().params as { id?: string } | undefined)?.id) ?? '';
  const [t, setT] = useState<IncidentTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    api.getIncidentTimeline(id).then(r => { if (!off) setT(r); }).catch(() => { if (!off) setError("Couldn't load this timeline. Check your connection and try again."); });
    return () => { off = true; };
  }, [id]);

  const share = useCallback(async () => {
    setBusy(true); setNote(null);
    try {
      const exported = await api.getIncidentTimeline(id, true); // this is the audited call
      await Share.share({ message: timelineShareText(exported) });
      setNote('Opened your share sheet. Lumo does not send it anywhere: you choose where it goes.');
    } catch { setNote("Couldn't prepare the timeline to share. Nothing was shared."); }
    finally { setBusy(false); }
  }, [id]);

  const practice = t?.incident.mode === 'practice';
  return (
    <Container>
      {practice ? <Banner accessibilityRole="header"><BannerText>Practice: nobody was contacted</BannerText></Banner> : null}
      <Header>
        <Back onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back to past alerts"><IconArrowLeft size={24} color="#1f2937" /></Back>
        <Title accessibilityRole="header">{t ? (practice ? 'Practice run' : triggerLabel(t.incident.triggerType)) : 'Timeline'}</Title>
      </Header>
      <ScrollView contentContainerStyle={styles.scroll}>
        {!t && !error ? <ActivityIndicator accessibilityLabel="Loading" /> : null}
        {error ? <Notice accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Notice> : null}
        {t ? (
          <>
            <Body>{whenLabel(t.incident.triggeredAt)}</Body>
            <Strong>{practice ? PRACTICE_NOTE : outcomeText(t.incident)}</Strong>
            {!practice && lateText(t.incident) ? <Body>{lateText(t.incident)}</Body> : null}
            <Strong accessibilityRole="header">What happened, in order</Strong>
            {t.entries.map((e, i) => (
              <Entry key={`${e.at}-${i}`} accessible accessibilityLabel={`${clock(e.at)}. ${entryText(e)}`}>
                <Time>{clock(e.at)}</Time>
                <What>{entryText(e)}</What>
              </Entry>
            ))}
            <Body>This shows names and times. It never includes a position or a phone number.</Body>
            <Big disabled={busy} onPress={share} accessibilityRole="button" accessibilityLabel="Share this timeline. Each share is recorded in your audit log">
              <BigText>{busy ? 'Preparing…' : 'Share this timeline'}</BigText>
            </Big>
            {note ? <Notice accessibilityLiveRegion="polite">{note}</Notice> : null}
          </>
        ) : null}
      </ScrollView>
    </Container>
  );
}
