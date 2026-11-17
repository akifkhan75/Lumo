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
  min-width: 48px;
  min-height: 48px;
  justify-content: center;
  align-items: center;
  padding: 8px;
`;

const Title = styled(Text)`
  font-size: 24px;
  font-weight: bold;
  color: #1f2937;
  margin-start: 16px;
`;

const SettingItemContainer = styled(TouchableOpacity)`
    flex-direction: row;
    align-items: center;
    padding: 12px 4px;
    gap: 16px;
    min-height: 56px;
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
  // One stop for a screen reader and a row-wide target: the whole row is the control, and a switch is one that says whether it is on.
  <SettingItemContainer
    onPress={hasToggle ? () => onToggleChange?.(!isToggleOn) : onPress}
    disabled={!onPress && !hasToggle}
    accessibilityRole={hasToggle ? 'switch' : 'button'}
    accessibilityLabel={`${title}. ${description}`}
    accessibilityState={hasToggle ? { checked: Boolean(isToggleOn) } : undefined}
  >
    <SettingItemIconContainer>
        {icon}
    </SettingItemIconContainer>
    <SettingTextContainer>
        <SettingTitle>{title}</SettingTitle>
        <SettingDescription>{description}</SettingDescription>
    </SettingTextContainer>
    {hasToggle ? (
        <Switch accessibilityElementsHidden importantForAccessibility="no-hide-descendants" value={isToggleOn} onValueChange={onToggleChange} trackColor={{ false: "#767577", true: "#047857" }} thumbColor={"#f4f3f4"} />
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
                    <BackButton onPress={onClose} accessibilityRole="button" accessibilityLabel="Close settings">
                    <IconArrowLeft size={24} color="#1f2937" />
                    </BackButton>
                    <Title>Settings</Title>
                </Header>
                <View>
                <SettingItem icon={<IconProfile size={24} color="#16a34a" />} title="Update Profile" description="View and edit your profile" onPress={() => navigation.navigate('ProfileSettings', { currentSettings, onSave })} />
                <SettingItem icon={<IconContact size={24} color="#16a34a" />} title="Contact" description="Emergency Contact" onPress={() => navigation.navigate('ContactSettings', { currentSettings, onSave })} />
                <SettingItem icon={<IconContact size={24} color="#16a34a" />} title="Being a contact" description="Alerts on this phone, and join someone's link" onPress={() => navigation.navigate('ContactRole', {})} />
                <SettingItem 
                    icon={<IconLocation size={24} color="#16a34a" />} 
                    title="Show My Location" 
                    description="Allow location tracking" 
                    hasToggle 
                    isToggleOn={currentSettings.security.locationSharingEnabled}
                    onToggleChange={handleToggleLocation}
                />
                <SettingItem icon={<IconAlert size={24} color="#16a34a" />} title="Setup Alert" description="Configure alert settings" onPress={() => navigation.navigate('AlertSettings', { currentSettings, onSave })} />
                <SettingItem icon={<IconAlert size={24} color="#16a34a" />} title="Practise an emergency" description="Try the SOS path. Nobody is contacted" onPress={() => (navigation as any).navigate('Practice', { settings: currentSettings })} />
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
