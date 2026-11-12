import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import styled from 'styled-components/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { UserSettings } from '../types';
import { getSelfDefenseTips } from '../services/apiService';
import { IconArrowLeft, IconVolumeUp, IconZap, IconMic } from '../constants';
import DemoBanner from './common/DemoBanner';

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

const ContactsRing = styled(View)`
    width: 256px;
    height: 256px;
    align-items: center;
    justify-content: center;
`;

const LumoLogoContainer = styled(View)`
    position: absolute;
    align-items: center;
`;

const LumoText = styled(Text)`
    font-size: 24px;
    font-weight: bold;
    color: white;
`;

const LumoSubtext = styled(Text)`
    font-size: 14px;
    color: rgba(255, 255, 255, 0.8);
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

const BannerSpacer = styled(View)`
    margin-top: 16px;
`;

const CallButton = styled(TouchableOpacity)`
    width: 100%;
    background-color: #dc2626; /* red-600 */
    padding: 16px 24px;
    border-radius: 9999px;
    align-items: center;
`;

// --- Components --- //

import Feather from '@expo/vector-icons/Feather';

const ContactCircle = ({role, icon, angle}: {role: string, icon: string, angle: number}) => (
    <View style={{ position: 'absolute', top: '50%', left: '50%', marginTop: -32, marginLeft: -32, transform: [{ rotate: `${angle}deg` }, { translateX: 110 }, { rotate: `-${angle}deg` }] }}>
        <View style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            borderWidth: 3,
            borderColor: 'rgba(255,255,255,0.5)',
            backgroundColor: '#64748b', /* slate-500 — placeholder, not a live recipient */
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.35,
            shadowRadius: 6,
            elevation: 8,
        }}>
            <Feather name={icon as any} size={22} color="#ffffff" />
            <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '800', marginTop: 2, letterSpacing: 0.5 }}>{role}</Text>
        </View>
    </View>
);

// Illustration, not data. These are not the user's contacts and none of them
// is contacted. The ring is kept because the layout is the one Phase 1 fills
// with real recipients and real per-channel delivery state; it is rendered
// greyed out and captioned so it cannot be read as "these people know".
const placeholderContacts = [
    { name: "Police", role: "POLICE", icon: "shield" },
    { name: "EMS", role: "EMS", icon: "activity" },
    { name: "Mom", role: "MOM", icon: "heart" },
    { name: "Security", role: "SEC", icon: "lock" },
    { name: "Dad", role: "DAD", icon: "phone" },
    { name: "Guard", role: "GUARD", icon: "users" },
];

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


const EmergencyScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { settings } = route.params as { settings: UserSettings };

  const [showDefenseGuide, setShowDefenseGuide] = useState(false);
  const onClose = () => navigation.goBack();

  return (
    <Container>
      {showDefenseGuide && <DefenseGuide onFinish={() => setShowDefenseGuide(false)}/>}
      <Header>
        <BackButton onPress={onClose}>
          <IconArrowLeft size={24} color="white"/>
        </BackButton>
        <TitleContainer>
            <Subtitle>SOS</Subtitle>
            <Title>Nothing has been sent</Title>
            <Description>
                Lumo cannot yet contact anyone. No message has gone to your
                contacts, no emergency service has been called, and your
                location has not been shared. If you need help now, call your
                local emergency number.
                {settings.personalInfo.bloodType && ` Your saved blood type is ${settings.personalInfo.bloodType}.`}
            </Description>
        </TitleContainer>
        <BannerSpacer>
            <DemoBanner>
                This screen is a demonstration of the SOS layout. Alerting,
                location sharing and recording are not built yet.
            </DemoBanner>
        </BannerSpacer>
      </Header>
      
      <MainContent>
        <ContactsRing>
            {placeholderContacts.map((c, i) => (
                <ContactCircle key={c.name} {...c} angle={(i * 360 / placeholderContacts.length)} />
            ))}
            <LumoLogoContainer>
                <LumoText>Lumo</LumoText>
                <LumoSubtext>Example recipients — not contacted</LumoSubtext>
            </LumoLogoContainer>
        </ContactsRing>
      </MainContent>
      
      <Footer>
        <View style={{flexDirection: 'row', justifyContent: 'center', gap: 16, marginVertical: 8}}>
            <TouchableOpacity onPress={() => setShowDefenseGuide(true)} style={{alignItems: 'center'}}>
                <View style={{width: 64, height: 64, borderRadius: 32, backgroundColor: '#f59e0b', justifyContent: 'center', alignItems: 'center'}}>
                    <IconZap size={32} color="white"/>
                </View>
                <Text style={{color: 'white', fontSize: 12, fontWeight: '600', marginTop: 4}}>Defense</Text>
            </TouchableOpacity>
            <View style={{alignItems: 'center', opacity: 0.45}} accessibilityState={{disabled: true}}>
                <View style={{width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center'}}>
                    <IconMic size={32} color="white"/>
                </View>
                <Text style={{color: 'white', fontSize: 12, fontWeight: '600', marginTop: 4}}>Not available</Text>
            </View>
        </View>
        {/*
          The one thing on this screen that actually works. Opening the dialler
          is user-initiated, which is the only form of emergency dialling the
          platforms permit and the only one Lumo should ever perform. It is
          left empty rather than pre-filled because the correct number depends
          on where the user physically is, and the region profile that resolves
          that is Phase 1.
        */}
        <CallButton onPress={() => Linking.openURL('tel:')} accessibilityRole="button">
          <ButtonText>Open phone dialler</ButtonText>
        </CallButton>
        <BottomButton onPress={onClose}>
          <ButtonText>Close</ButtonText>
        </BottomButton>
      </Footer>
    </Container>
  );
};

export default EmergencyScreen;