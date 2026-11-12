import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import styled from 'styled-components/native';
import { useNavigation } from '@react-navigation/native';
import { IconShield, IconUsers, IconWalk, IconCar, IconRoute, IconArrowLeft } from '../constants';
import {
  HAZARD_CONFIRMATION_FLOOR,
  HAZARD_SOURCE_LABELS,
  HAZARD_TYPE_LABELS,
  HazardReport,
} from '../types';
import * as apiService from '../services/apiService';
import DemoBanner from './common/DemoBanner';

const Container = styled(View)`
  flex: 1;
  background-color: #f3f4f6;
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

const ScrollContainer = styled(ScrollView).attrs({
    contentContainerStyle: { paddingBottom: 16, gap: 16 }
})`
    flex: 1;
`;

const CloseButton = styled(TouchableOpacity)`
  background-color: #1f2937;
  padding: 16px;
  border-radius: 9999px;
  align-items: center;
  margin-top: 16px;
`;

const ButtonText = styled(Text)`
  color: white;
  font-size: 18px;
  font-weight: bold;
`;

const FeatureInfoContainer = styled(View)`
    flex-direction: row;
    align-items: flex-start;
    gap: 16px;
    padding: 16px;
    background-color: #ffffff;
    border-radius: 8px;
`;

const FeatureInfoTextContainer = styled(View)`
    flex: 1;
`;

const FeatureTitle = styled(Text)`
    font-weight: 600;
    color: #1f2937;
    font-size: 16px;
`;

const FeatureDescription = styled(Text)`
    color: #4b5563;
    margin-top: 4px;
    margin-bottom: 8px;
`;

const FeatureActionButton = styled(TouchableOpacity)``;

const FeatureActionText = styled(Text)`
    font-weight: 600;
    color: #0891b2; /* cyan-600 */
`;

const ViewContainer = styled(View)`
    padding: 8px;
`;

const Subtitle = styled(Text)`
    font-size: 18px;
    font-weight: bold;
    color: #1f2937;
    margin-bottom: 16px;
`;

const ReportCard = styled(View)`
    background-color: white;
    padding: 12px;
    border-radius: 8px;
    gap: 4px;
`;

const ReportHeaderRow = styled(View)`
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
`;

const ReportType = styled(Text)`
    font-weight: 700;
    color: #1f2937;
    flex: 1;
`;

const SourceTag = styled(Text)<{ verified: boolean }>`
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.3px;
    color: ${props => (props.verified ? '#065f46' : '#475569')};
    background-color: ${props => (props.verified ? '#d1fae5' : '#f1f5f9')};
    padding: 2px 6px;
    border-radius: 4px;
    overflow: hidden;
`;

const ReportBody = styled(Text)`
    color: #374151;
`;

const ReportMeta = styled(Text)`
    color: #6b7280;
    font-size: 12px;
`;

const UnconfirmedNote = styled(Text)`
    color: #92400e;
    font-size: 12px;
    line-height: 17px;
`;

const PlainNote = styled(Text)`
    color: #4b5563;
    line-height: 20px;
`;

// --- Components --- //

const FeatureInfo: React.FC<{
    icon: React.ReactNode;
    title: string;
    description: string;
    onAction?: () => void;
    actionText?: string;
}> = ({ icon, title, description, onAction, actionText }) => (
  <FeatureInfoContainer>
    <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
        {icon}
    </View>
    <FeatureInfoTextContainer>
      <FeatureTitle>{title}</FeatureTitle>
      <FeatureDescription>{description}</FeatureDescription>
      {onAction && actionText && (
        <FeatureActionButton onPress={onAction}>
          <FeatureActionText>{actionText} &rarr;</FeatureActionText>
        </FeatureActionButton>
      )}
    </FeatureInfoTextContainer>
  </FeatureInfoContainer>
);

const SafeWalkView = () => {
  const [requestStatus, setRequestStatus] = useState<'idle' | 'pending' | 'accepted'>('idle');
  
  if (requestStatus === 'pending') {
    return <ViewContainer><ActivityIndicator /><Text style={{textAlign: 'center', marginTop: 8}}>Contacting volunteers...</Text></ViewContainer>;
  }
  if (requestStatus === 'accepted') {
    return <ViewContainer><Text style={{textAlign: 'center', color: '#059669'}}>Sarah V. has accepted your request!</Text></ViewContainer>;
  }

  return (
    <ViewContainer>
       <Subtitle>Available Volunteers</Subtitle>
       <TouchableOpacity onPress={() => {
           setRequestStatus('pending');
           setTimeout(() => setRequestStatus('accepted'), 2000);
       }} style={{backgroundColor: 'white', padding: 12, borderRadius: 8}}>
            <Text style={{fontWeight: '600'}}>Sarah V. (0.2 miles away) - Tap to Request</Text>
       </TouchableOpacity>
    </ViewContainer>
  )
};

/** "2 days ago" — an observation's age is as important as its content. */
const describeAge = (iso: string): string => {
    const ms = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(ms)) return 'reported at an unknown time';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'reported just now';
    if (minutes < 60) return `reported ${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `reported ${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `reported ${days} day${days === 1 ? '' : 's'} ago`;
};

const HazardReportCard = ({ report }: { report: HazardReport }) => {
    const verified = report.source !== 'COMMUNITY';
    return (
        <ReportCard>
            <ReportHeaderRow>
                <ReportType>{HAZARD_TYPE_LABELS[report.type] ?? report.type}</ReportType>
                <SourceTag verified={verified}>
                    {HAZARD_SOURCE_LABELS[report.source] ?? report.source}
                </SourceTag>
            </ReportHeaderRow>
            <ReportBody>{report.description}</ReportBody>
            <ReportMeta>
                {describeAge(report.reportedAt)} ·{' '}
                {report.confirmationCount === 0
                    ? 'no confirmations'
                    : `${report.confirmationCount} confirmation${report.confirmationCount === 1 ? '' : 's'}`}
            </ReportMeta>
            {/* The floor is the server's decision and arrives as
                influencesRouting; this only renders it. A single report is one
                person's observation, and saying so is the whole point of
                replacing severity with confirmations. */}
            {!report.influencesRouting && (
                <UnconfirmedNote>
                    Unconfirmed — fewer than {HAZARD_CONFIRMATION_FLOOR} people have
                    reported this condition, so Lumo does not act on it.
                </UnconfirmedNote>
            )}
        </ReportCard>
    );
};

/**
 * Real data. These rows come from the API, and if nothing is there the screen
 * says nothing is there — it used to show two invented reports ("Elm Street
 * Park", "Downtown Station") styled exactly as real ones would be.
 *
 * There is no Confirm button yet on purpose. Confirming a condition means
 * standing in front of it, and Lumo cannot tell where you are, so a confirm
 * control here would just be a way to inflate a count remotely. The endpoint
 * exists; the control arrives with location and moderation.
 */
const HazardReportsView = () => {
    const [reports, setReports] = useState<HazardReport[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            const data = await apiService.getHazardReports();
            // An empty list and a malformed response both render as "no
            // reports", never as a crash on a screen someone opened because
            // they wanted to know what was out there.
            setReports(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error(err);
            setError('Could not load reports.');
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <ViewContainer>
            <Subtitle>Reported conditions</Subtitle>
            {error !== null && (
                <ReportCard>
                    <ReportBody>{error}</ReportBody>
                    <TouchableOpacity onPress={load} accessibilityRole="button">
                        <FeatureActionText>Try again &rarr;</FeatureActionText>
                    </TouchableOpacity>
                </ReportCard>
            )}
            {error === null && reports === null && <ActivityIndicator />}
            {error === null && reports !== null && reports.length === 0 && (
                <ReportCard>
                    <ReportBody>No reports.</ReportBody>
                    <PlainNote>
                        Nobody has reported a condition that is still current. Lumo
                        cannot read your location yet, so it also cannot tell you
                        what has been reported near you — only what has been
                        reported.
                    </PlainNote>
                </ReportCard>
            )}
            {error === null && reports !== null && reports.length > 0 && (
                <View style={{ gap: 8 }}>
                    {reports.map(report => (
                        <HazardReportCard key={report.id} report={report} />
                    ))}
                </View>
            )}
        </ViewContainer>
    );
};


const CommunitySafetyScreen = () => {
  const navigation = useNavigation();
  const [view, setView] = useState<'main' | 'safeWalk' | 'hazardReports'>('main');
  const onClose = () => navigation.goBack();

  const renderContent = () => {
    switch(view) {
      case 'safeWalk': return <SafeWalkView />;
      case 'hazardReports': return <HazardReportsView />;
      default:
        return (
          <>
            <FeatureInfo icon={<IconWalk size={32} color="#0891b2" />} title="Safe Walk" description="Planned: request a volunteer to virtually accompany you." actionText="Preview" onAction={() => setView('safeWalk')} />
            <FeatureInfo icon={<IconRoute size={32} color="#0891b2" />} title="Path Deviation Alerts" description="Planned. Lumo does not track a route or notice a deviation yet." />
            <FeatureInfo icon={<IconShield size={32} color="#0891b2" />} title="Hazard reports" description="Conditions people have reported — lighting out, a path blocked. Reports expire on their own. Submitting one needs your location, which Lumo cannot read yet." actionText="View reports" onAction={() => setView('hazardReports')} />
            <FeatureInfo icon={<IconUsers size={32} color="#0891b2" />} title="Nearby Volunteers" description="Planned. No volunteer network exists and nobody is notified." />
            <FeatureInfo icon={<IconCar size={32} color="#0891b2" />} title="Impact Detection" description="Detects a large impact and opens the SOS screen. It cannot tell a crash from a dropped phone, and it alerts nobody. Enable in Settings." />
          </>
        );
    }
  }

  return (
    <Container>
      <Header>
        <BackButton onPress={view === 'main' ? onClose : () => setView('main')}>
          <IconArrowLeft size={24} color="#1f2937" />
        </BackButton>
        <Title>Community Hub</Title>
      </Header>
      
      <ScrollContainer>
        <DemoBanner>
          Safe Walk and Nearby Volunteers are not connected to anybody — no
          volunteer network exists. Hazard reports are real data from the
          server, but submitting one needs your location, which Lumo cannot
          read yet.
        </DemoBanner>
        {renderContent()}
      </ScrollContainer>
      
      <CloseButton onPress={onClose}>
        <ButtonText>{view === 'main' ? 'Got It' : 'Close'}</ButtonText>
      </CloseButton>
    </Container>
  );
};

export default CommunitySafetyScreen;