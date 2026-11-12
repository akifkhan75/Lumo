import React from 'react';
import { View, Text, TouchableOpacity, Switch, SafeAreaView } from 'react-native';
import styled from 'styled-components/native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { SettingsStackParamList } from '../../types';
import { IconProfile, IconContact, IconLocation, IconAlert, IconLogout, IconChevronRight, IconArrowLeft } from '../../constants';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

const Container = styled(SafeAreaView)`
  flex: 1;
  background-color: white;
`;

const InnerContainer = styled(View)`
    flex: 1;
    padding: 16px;
`;

const Header = styled(View)`
  flex-direction: row;
  align-items: center;
  margin-bottom: 16px;
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

const SettingItemContainer = styled(TouchableOpacity)`
    flex-direction: row;
    align-items: center;
    padding: 12px 4px;
    gap: 16px;
    border-radius: 8px;
`;

const SettingItemIconContainer = styled(View)`
    background-color: #dcfce7; /* green-100 */
    padding: 12px;
    border-radius: 9999px;
`;

const SettingTextContainer = styled(View)`
    flex: 1;
`;

const SettingTitle = styled(Text)`
    font-size: 16px;
    font-weight: 600;
    color: #1f2937;
`;

const SettingDescription = styled(Text)`
    font-size: 14px;
    color: #6b7280;
    margin-top: 2px;
`;


const SettingItem: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  onPress?: () => void;
  hasToggle?: boolean;
  isToggleOn?: boolean;
  onToggleChange?: (isOn: boolean) => void;
}> = ({ icon, title, description, onPress, hasToggle, isToggleOn, onToggleChange }) => (
  <SettingItemContainer onPress={onPress} disabled={!onPress && !hasToggle}>
    <SettingItemIconContainer>
        {icon}
    </SettingItemIconContainer>
    <SettingTextContainer>
        <SettingTitle>{title}</SettingTitle>
        <SettingDescription>{description}</SettingDescription>
    </SettingTextContainer>
    {hasToggle ? (
        <Switch value={isToggleOn} onValueChange={onToggleChange} trackColor={{ false: "#767577", true: "#10b981" }} thumbColor={"#f4f3f4"} />
      ) : <IconChevronRight size={24} color="#9ca3af" />}
  </SettingItemContainer>
);

const SettingsScreen = () => {
    const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
    const route = useRoute<RouteProp<SettingsStackParamList, 'SettingsRoot'>>();
    const { onLogout, currentSettings, onSave } = route.params;

    const onClose = () => navigation.goBack();

    const handleToggleLocation = (isOn: boolean) => {
        onSave({
            ...currentSettings,
            security: {
                ...currentSettings.security,
                locationSharingEnabled: isOn,
            }
        });
    };
  
    return (
        <Container>
            <InnerContainer>
                <Header>
                    <BackButton onPress={onClose}>
                    <IconArrowLeft size={24} color="#1f2937" />
                    </BackButton>
                    <Title>Settings</Title>
                </Header>
                <View>
                <SettingItem icon={<IconProfile size={24} color="#16a34a" />} title="Update Profile" description="View and edit your profile" onPress={() => navigation.navigate('ProfileSettings', { currentSettings, onSave })} />
                <SettingItem icon={<IconContact size={24} color="#16a34a" />} title="Contact" description="Emergency Contact" onPress={() => navigation.navigate('ContactSettings', { currentSettings, onSave })} />
                <SettingItem 
                    icon={<IconLocation size={24} color="#16a34a" />} 
                    title="Show My Location" 
                    description="Allow location tracking" 
                    hasToggle 
                    isToggleOn={currentSettings.security.locationSharingEnabled}
                    onToggleChange={handleToggleLocation}
                />
                <SettingItem icon={<IconAlert size={24} color="#16a34a" />} title="Setup Alert" description="Configure alert settings" onPress={() => navigation.navigate('AlertSettings', { currentSettings, onSave })} />
                <View style={{marginTop: 16, borderTopWidth: 1, borderColor: '#e5e7eb', paddingTop: 8}} />
                <SettingItem icon={<IconLogout size={24} color="#16a34a" />} title="Logout" description="Click here to logout" onPress={() => {
                    onClose();
                    onLogout();
                }} />
                </View>
            </InnerContainer>
        </Container>
    );
};

export default SettingsScreen;
