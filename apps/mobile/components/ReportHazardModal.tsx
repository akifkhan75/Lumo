import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import styled from 'styled-components/native';
import { IconArrowLeft } from '../constants';

/**
 * Reporting a hazard is unavailable, and this screen says so.
 *
 * It used to be a working form: pick a type, pick a severity, write a
 * description, submit. What it never had was a position. The server generated
 * one with Math.random() over a background image, so every report described a
 * place nobody had visited, and the map was a picture.
 *
 * A hazard report is now an observation anchored to real coordinates
 * (ADR-0010), and Lumo cannot read the device's location yet. The options were
 * to keep inventing positions or to stop accepting reports until the location
 * provider lands in Phase 1. A form that cannot tell the truth about where
 * something is does not belong in a safety app, so this screen replaces it —
 * rather than a submit button that quietly fabricates a coordinate.
 */

const Container = styled(View)`
  flex: 1;
  background-color: white;
`;

const Header = styled(View)`
  flex-direction: row;
  align-items: center;
  padding: 32px 16px 0;
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

const Body = styled(ScrollView).attrs({
  contentContainerStyle: { padding: 16, gap: 16 },
})``;

const Notice = styled(View)`
  background-color: #f1f5f9; /* slate-100 */
  border-left-width: 4px;
  border-left-color: #475569; /* slate-600 */
  border-radius: 8px;
  padding: 16px;
  gap: 8px;
`;

const NoticeLabel = styled(Text)`
  color: #334155; /* slate-700 */
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.5px;
`;

const NoticeTitle = styled(Text)`
  color: #0f172a;
  font-size: 18px;
  font-weight: 700;
`;

const Paragraph = styled(Text)`
  color: #334155;
  font-size: 14px;
  line-height: 21px;
`;

const SectionTitle = styled(Text)`
  color: #1f2937;
  font-size: 15px;
  font-weight: 700;
  margin-top: 8px;
`;

const Bullet = styled(Text)`
  color: #4b5563;
  font-size: 14px;
  line-height: 21px;
`;

const CloseButton = styled(TouchableOpacity)`
  background-color: #1f2937;
  padding: 16px;
  border-radius: 9999px;
  align-items: center;
  margin: 16px;
`;

const ButtonText = styled(Text)`
  color: white;
  font-size: 18px;
  font-weight: bold;
`;

const ReportHazardScreen = () => {
  const navigation = useNavigation();
  const onClose = () => navigation.goBack();

  return (
    <Container>
      <Header>
        <BackButton onPress={onClose} accessibilityRole="button" accessibilityLabel="Go back">
          <IconArrowLeft size={24} color="#1f2937" />
        </BackButton>
        <Title>Report a hazard</Title>
      </Header>

      <Body>
        <Notice accessible accessibilityRole="alert">
          <NoticeLabel>NOT AVAILABLE YET</NoticeLabel>
          <NoticeTitle>Lumo cannot read your location</NoticeTitle>
          <Paragraph>
            A hazard report has to say where the condition is. Lumo does not have
            access to your position yet, so it cannot place a report, and it will
            not guess one. Nothing you could enter here would reach anybody.
          </Paragraph>
        </Notice>

        <Paragraph>
          The previous version of this screen accepted reports and the server
          placed them at a random point near the middle of a picture of a map.
          Those reports have been removed.
        </Paragraph>

        <SectionTitle>What a report will be</SectionTitle>
        <Bullet>
          • An observation about a condition — lighting out, a path blocked,
          broken steps — not a rating of an area.
        </Bullet>
        <Bullet>
          • Anchored to real coordinates, with how accurate that position was.
        </Bullet>
        <Bullet>
          • Dated, and expiring on its own. A report from months ago is not
          evidence about tonight.
        </Bullet>
        <Bullet>
          • Counted, not scored. Other people confirm the same condition; there
          is no severity and no danger grade for a place.
        </Bullet>

        <SectionTitle>What has to come first</SectionTitle>
        <Bullet>
          • Location permission and a real position with an accuracy figure.
        </Bullet>
        <Bullet>• A map that is a map, so you can see and correct the point.</Bullet>
        <Bullet>• Moderation, before a report is shown to anyone else.</Bullet>
      </Body>

      <CloseButton onPress={onClose} accessibilityRole="button">
        <ButtonText>Close</ButtonText>
      </CloseButton>
    </Container>
  );
};

export default ReportHazardScreen;
