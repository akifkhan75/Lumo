import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Switch, Alert, ScrollView, SafeAreaView } from 'react-native';
import styled from 'styled-components/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { SecuritySettings, UserSettings } from '../../types';
import { IconArrowLeft } from '../../constants';

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

const ToggleItemContainer = styled(TouchableOpacity)`
    flex-direction: row;
    align-items: center;
    padding: 12px 4px;
    gap: 16px;
    min-height: 56px;
`;

const ToggleTextContainer = styled(View)`
    flex: 1;
`;

const ToggleTitle = styled(Text)`
    font-size: 16px;
    font-weight: 600;
    color: #1f2937;
`;

const ToggleDescription = styled(Text)`
    font-size: 14px;
    color: #6b7280;
    margin-top: 2px;
`;

const SubmitButton = styled(TouchableOpacity)`
  background-color: #1f2937;
  min-height: 56px;
  justify-content: center;
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

const ToggleOption: React.FC<{label: string, description: string, isEnabled: boolean, onToggle: (value: boolean) => void}> = ({label, description, isEnabled, onToggle}) => (
    <ToggleItemContainer onPress={() => onToggle(!isEnabled)} accessibilityRole="switch" accessibilityLabel={`${label}. ${description}`} accessibilityState={{ checked: isEnabled }}>
        <ToggleTextContainer>
            <ToggleTitle>{label}</ToggleTitle>
            <ToggleDescription>{description}</ToggleDescription>
        </ToggleTextContainer>
        <Switch accessibilityElementsHidden importantForAccessibility="no-hide-descendants" value={isEnabled} onValueChange={onToggle} trackColor={{ false: "#767577", true: "#047857" }} thumbColor={"#f4f3f4"} />
    </ToggleItemContainer>
);

const AlertSettingsScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { currentSettings, onSave } = route.params as { currentSettings: UserSettings; onSave: (settings: UserSettings) => void; };

  const [security, setSecurity] = useState<SecuritySettings>(currentSettings.security);
  const [isSaving, setIsSaving] = useState(false);
  const onBack = () => navigation.goBack();

  const handleToggle = (key: keyof SecuritySettings) => {
    setSecurity(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    await onSave({ ...currentSettings, security });
    setIsSaving(false);
    Alert.alert("Success", "Alert settings updated!");
    onBack();
  };

  return (
    <Container>
        <InnerContainer>
            <Header>
                <BackButton onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back to settings">
                    <IconArrowLeft size={24} color="#1f2937" />
                </BackButton>
                <Title>Setup Alert</Title>
            </Header>
            <ScrollView>
                <ToggleOption 
                    label="Shake to activate SOS"
                    description="Quickly shake your phone to trigger an emergency alert."
                    isEnabled={security.shakeToSosEnabled}
                    onToggle={() => handleToggle('shakeToSosEnabled')}
                />
                <ToggleOption 
                    label="Voice Activation"
                    description="Say 'Hey Lumo, emergency!' to trigger an alert."
                    isEnabled={security.voiceActivationEnabled}
                    onToggle={() => handleToggle('voiceActivationEnabled')}
                />
                <ToggleOption 
                    label="Accident Detection"
                    description="Uses phone sensors to detect car crashes and auto-trigger SOS."
                    isEnabled={security.accidentDetectionEnabled}
                    onToggle={() => handleToggle('accidentDetectionEnabled')}
                />
                <View style={{height: 1, backgroundColor: '#e5e7eb', marginVertical: 8}} />
                <ToggleOption 
                    label="Share Location in SOS"
                    description="Automatically share your live location with contacts."
                    isEnabled={security.shareLocationOnSos}
                    onToggle={() => handleToggle('shareLocationOnSos')}
                />
                <ToggleOption 
                    label="Send SMS during SOS"
                    description="Send an emergency text message to your contacts."
                    isEnabled={security.sendSmsOnSos}
                    onToggle={() => handleToggle('sendSmsOnSos')}
                />
            </ScrollView>
            <SubmitButton onPress={handleSave} disabled={isSaving} accessibilityRole="button" accessibilityLabel={isSaving ? 'Saving your alert settings' : 'Save your alert settings'} accessibilityState={{ busy: isSaving, disabled: isSaving }}>
                <ButtonText>{isSaving ? 'Saving...' : 'Save & Update'}</ButtonText>
            </SubmitButton>
        </InnerContainer>
    </Container>
  );
};

export default AlertSettingsScreen;