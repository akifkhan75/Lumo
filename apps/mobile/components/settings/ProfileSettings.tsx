import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ScrollView, SafeAreaView } from 'react-native';
import styled from 'styled-components/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { PersonalInfo, UserSettings } from '../../types';
import { IconUser, IconArrowLeft } from '../../constants';

const Container = styled(SafeAreaView)`
  flex: 1;
  background-color: white;
`;

const Wrapper = styled(KeyboardAvoidingView).attrs({
    behavior: Platform.OS === "ios" ? "padding" : "height"
})`
  flex: 1;
`;

const InnerContainer = styled(ScrollView).attrs({
    contentContainerStyle: { flexGrow: 1, padding: 16 }
})``;

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
  margin-start: 16px;
`;

const Description = styled(Text)`
    color: #6b7280;
    margin: 16px 0;
`;

const InputContainer = styled(View)`
  border-bottom-width: 2px;
  border-color: #e5e7eb;
  margin-bottom: 24px;
  flex-direction: row;
  align-items: center;
  padding-bottom: 8px;
`;

const StyledInput = styled(TextInput)`
  flex: 1;
  font-size: 16px;
  padding-start: 12px;
  color: #1f2937;
`;

const SubmitButton = styled(TouchableOpacity)`
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


const ProfileSettingsScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { currentSettings, onSave } = route.params as { currentSettings: UserSettings; onSave: (settings: UserSettings) => void; };

  const [personalInfo, setPersonalInfo] = useState<PersonalInfo>(currentSettings.personalInfo);
  const [isSaving, setIsSaving] = useState(false);
  const onBack = () => navigation.goBack();

  const handleChange = (name: keyof PersonalInfo, value: string) => {
    setPersonalInfo({ ...personalInfo, [name]: value });
  };

  const handleSave = async () => {
    setIsSaving(true);
    await onSave({ ...currentSettings, personalInfo });
    setIsSaving(false);
    onBack();
  };

  return (
    <Container>
      <Wrapper>
        <InnerContainer>
            <Header>
                <BackButton onPress={onBack}>
                <IconArrowLeft size={24} color="#1f2937" />
                </BackButton>
                <Title>Update Profile</Title>
            </Header>
            <Description>This information can be crucial for first responders in an emergency.</Description>
            <InputContainer>
                <IconUser size={20} color="#9ca3af" />
                <StyledInput
                    placeholder="Full Name"
                    value={personalInfo.fullName}
                    onChangeText={(val) => handleChange('fullName', val)}
                />
            </InputContainer>
            <InputContainer>
                <IconUser size={20} color="#9ca3af" />
                <StyledInput
                    placeholder="Blood Type (e.g., O+)"
                    value={personalInfo.bloodType}
                    onChangeText={(val) => handleChange('bloodType', val)}
                />
            </InputContainer>
            <InputContainer>
                <IconUser size={20} color="#9ca3af" />
                <StyledInput
                    placeholder="Allergies"
                    value={personalInfo.allergies}
                    onChangeText={(val) => handleChange('allergies', val)}
                />
            </InputContainer>
            <View style={{flex: 1}}/>
            <SubmitButton onPress={handleSave} disabled={isSaving}>
                <ButtonText>{isSaving ? 'Saving...' : 'Save & Update'}</ButtonText>
            </SubmitButton>
        </InnerContainer>
      </Wrapper>
    </Container>
  );
};

export default ProfileSettingsScreen;