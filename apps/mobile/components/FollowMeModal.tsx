import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, ImageBackground, Alert, Platform } from 'react-native';
import styled from 'styled-components/native';
import { useNavigation } from '@react-navigation/native';
import { IconArrowLeft, IconShare } from '../constants';
import DemoBanner from './common/DemoBanner';

const Container = styled(View)`
  flex: 1;
  background-color: white;
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

const Body = styled(View)`
  flex: 1;
  gap: 16px;
`;

const Description = styled(Text)`
    color: #4b5563;
    margin-bottom: 8px;
    text-align: center;
`;

const ShareLinkContainer = styled(View)`
    background-color: #f3f4f6;
    padding: 12px;
    border-radius: 8px;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
`;

const ShareLinkText = styled(Text)`
    color: #374151;
    font-family: ${Platform.OS === 'ios' ? 'Menlo' : 'monospace'};
    flex: 1;
`;

const MapContainer = styled(View)`
    flex: 1;
    border-radius: 8px;
    overflow: hidden;
    background-color: #e5e7eb;
`;

const SubmitButton = styled(TouchableOpacity)<{active: boolean}>`
  background-color: ${props => props.active ? '#dc2626' : '#4f46e5'};
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

const FollowMeScreen = () => {
  const navigation = useNavigation();
  const shareLink = `https://lumo.example/follow/jS8fD9kL`;
  const [monitoringActive, setMonitoringActive] = useState(false);
  const onClose = () => navigation.goBack();
  
  const handleShare = () => {
    Alert.alert("Share this link", shareLink, [{ text: "OK" }]);
  };

  const handleToggleMonitoring = () => {
    const wasActive = monitoringActive;
    setMonitoringActive(prev => !prev);
    if (!wasActive) {
      Alert.alert("Not sharing yet", "Lumo cannot share your location yet. This toggle changes nothing outside this screen.");
    } else {
       Alert.alert("Stopped", "Nothing was being shared.");
       onClose();
    }
  }

  return (
    <Container>
      <Header>
        <BackButton onPress={onClose}>
          <IconArrowLeft size={24} color="#1f2937" />
        </BackButton>
        <Title>Follow Me</Title>
      </Header>
      
      <DemoBanner>
        Journey sharing is not built. The link is a placeholder, the map is a
        static image, and your location is not leaving this device.
      </DemoBanner>

      <Body>
        <View>
          <Description>A journey link will let a trusted contact follow you in a browser. The link below is a placeholder and does not resolve to anything.</Description>
          <ShareLinkContainer>
            <ShareLinkText numberOfLines={1}>{shareLink}</ShareLinkText>
            <TouchableOpacity onPress={handleShare} style={{padding: 8}}>
              <IconShare size={20} color="#4f46e5"/>
            </TouchableOpacity>
          </ShareLinkContainer>
        </View>

        <MapContainer>
           <ImageBackground source={require('../assets/images/map_bg.jpg')} style={{width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center'}}>
                <Image source={require('../assets/images/user_avatar.jpg')} style={{width: 56, height: 56, borderRadius: 28, borderWidth: 4, borderColor: 'white'}} />
           </ImageBackground>
           <View style={{position: 'absolute', bottom: 16, left: 16, backgroundColor: 'white', padding: 8, borderRadius: 8}}>
             <Text style={{fontWeight: '600'}}>Status: <Text style={{color: monitoringActive ? '#16a34a' : '#6b7280'}}>{monitoringActive ? 'Active' : 'Inactive'}</Text></Text>
           </View>
        </MapContainer>
      </Body>
      
      <SubmitButton active={monitoringActive} onPress={handleToggleMonitoring}>
        <ButtonText>{monitoringActive ? 'Stop Sharing' : 'Start Sharing'}</ButtonText>
      </SubmitButton>
    </Container>
  );
};

export default FollowMeScreen;