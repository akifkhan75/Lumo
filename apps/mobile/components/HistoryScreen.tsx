import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, StyleSheet } from 'react-native';
import styled from 'styled-components/native';
import { useNavigation } from '@react-navigation/native';
import type { IncidentSummary } from '@lumo/types';
import { IconArrowLeft, IconChevronRight } from '../constants';
import * as api from '../services/apiService';
import { PRACTICE_NOTE, rowLabel, rowParts } from '../services/historyCopy';

const Container = styled(SafeAreaView)`flex: 1; background-color: white;`;
const Header = styled(View)`flex-direction: row; align-items: center; padding: 16px;`;
const Back = styled(TouchableOpacity)`min-width: 48px; min-height: 48px; justify-content: center; align-items: center;`;
const Title = styled(Text)`font-size: 24px; font-weight: bold; color: #1f2937; margin-start: 12px;`;
const Body = styled(Text)`font-size: 15px; color: #374151; margin-top: 8px;`;
const Row = styled(TouchableOpacity)`min-height: 72px; flex-direction: row; align-items: center; padding: 12px 4px; border-bottom-width: 1px; border-bottom-color: #e5e7eb;`;
const RowText = styled(View)`flex: 1; margin-end: 8px;`;
const RowTitle = styled(Text)`font-size: 16px; font-weight: 700; color: #111827;`;
const RowLine = styled(Text)`font-size: 14px; color: #374151; margin-top: 2px;`;
const Chip = styled(TouchableOpacity)<{ on: boolean }>`min-height: 44px; justify-content: center; padding: 8px 16px; margin-end: 8px; border-radius: 9999px; border-width: 2px; border-color: #1e3a8a; background-color: ${p => (p.on ? '#1e3a8a' : 'white')};`;
const ChipText = styled(Text)<{ on: boolean }>`font-size: 15px; font-weight: 600; color: ${p => (p.on ? 'white' : '#1e3a8a')};`;
const More = styled(TouchableOpacity)`min-height: 56px; justify-content: center; align-items: center; margin-top: 12px; border-radius: 9999px; border-width: 2px; border-color: #1e3a8a;`;
const MoreText = styled(Text)`font-size: 17px; font-weight: bold; color: #1e3a8a;`;
const Notice = styled(Text)`font-size: 15px; font-weight: 600; color: #111827; margin-top: 12px; padding: 12px; border-width: 2px; border-color: #111827; border-radius: 12px;`;
const ChipRow = styled(View)`flex-direction: row; flex-wrap: wrap; padding: 0 16px;`;
const styles = StyleSheet.create({ scroll: { paddingHorizontal: 16, paddingBottom: 32 } });

/**
 * Past alerts (docs/specs/INCIDENT_HISTORY.md). Real alerts by default; "Practice runs" is a separate list, so a rehearsal is never mixed in
 * and never mistaken for one. Counts only here: who was reached is behind a tap, in the timeline.
 */
export default function HistoryScreen() {
  const navigation = useNavigation<any>();
  const [mode, setMode] = useState<'real' | 'practice'>('real');
  const [rows, setRows] = useState<IncidentSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (m: 'real' | 'practice', after: string | null) => {
    setLoading(true); setFailed(false);
    try {
      const page = await api.listIncidents({ limit: 20, cursor: after, mode: m });
      setRows(prev => (after ? [...prev, ...page.incidents] : page.incidents));
      setCursor(page.nextCursor);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { setRows([]); setCursor(null); load(mode, null); }, [mode, load]);

  return (
    <Container>
      <Header>
        <Back onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Close past alerts"><IconArrowLeft size={24} color="#1f2937" /></Back>
        <Title accessibilityRole="header">Past alerts</Title>
      </Header>
      <ChipRow>
        <Chip on={mode === 'real'} onPress={() => setMode('real')} accessibilityRole="button" accessibilityState={{ selected: mode === 'real' }} accessibilityLabel="Show your alerts"><ChipText on={mode === 'real'}>Alerts</ChipText></Chip>
        <Chip on={mode === 'practice'} onPress={() => setMode('practice')} accessibilityRole="button" accessibilityState={{ selected: mode === 'practice' }} accessibilityLabel="Show your practice runs"><ChipText on={mode === 'practice'}>Practice runs</ChipText></Chip>
      </ChipRow>
      <ScrollView contentContainerStyle={styles.scroll}>
        {mode === 'practice' ? <Notice>{PRACTICE_NOTE} These are rehearsals, kept apart from your real alerts.</Notice> : null}
        {failed ? <Notice accessibilityRole="alert" accessibilityLiveRegion="assertive">Couldn't load your past alerts. Check your connection and try again.</Notice> : null}
        {rows.map(s => (
          <Row key={s.id} onPress={() => navigation.navigate('IncidentTimeline', { id: s.id })} accessibilityRole="button" accessibilityLabel={`${rowLabel(s)}. Open the timeline`}>
            <RowText>
              <RowTitle>{rowParts(s).title}</RowTitle>
              {rowParts(s).details.map(d => <RowLine key={d}>{d}</RowLine>)}
            </RowText>
            <IconChevronRight size={22} color="#6b7280" />
          </Row>
        ))}
        {loading ? <ActivityIndicator accessibilityLabel="Loading" style={{ marginTop: 16 }} /> : null}
        {!loading && !failed && rows.length === 0 ? <Body>{mode === 'real' ? "You haven't raised an alert. When you do, it will be listed here." : "You haven't done a practice run. You can start one from Settings."}</Body> : null}
        {cursor && !loading ? <More onPress={() => load(mode, cursor)} accessibilityRole="button" accessibilityLabel="Show older alerts"><MoreText>Show older</MoreText></More> : null}
        {failed ? <More onPress={() => load(mode, rows.length > 0 ? cursor : null)} accessibilityRole="button" accessibilityLabel="Try loading your past alerts again"><MoreText>Try again</MoreText></More> : null}
      </ScrollView>
    </Container>
  );
}
