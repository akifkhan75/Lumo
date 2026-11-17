import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, SafeAreaView, Share } from 'react-native';
import styled from 'styled-components/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ConsentStatus, TrustedContact, UserSettings } from '../../types';
import * as apiService from '../../services/apiService';
import { consentLabel, inviteMessage } from '../../services/consentStatus';
import { IconUser, IconPhoneCall, IconArrowLeft, IconTrash } from '../../constants';

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

const ContactCard = styled(View)`
  padding: 16px;
  border-radius: 8px;
  background-color: #f9fafb; /* gray-50 */
  border-width: 1px;
  border-color: #e5e7eb;
  margin-bottom: 16px;
  position: relative;
`;

const RemoveButton = styled(TouchableOpacity)`
    position: absolute;
    top: 0;
    end: 0;
    min-width: 48px;
    min-height: 48px;
    justify-content: center;
    align-items: center;
    z-index: 2;
`;

const InputContainer = styled(View)`
  border-bottom-width: 2px;
  border-color: #e5e7eb;
  margin-top: 16px;
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

const AddButton = styled(TouchableOpacity)`
    border-style: dashed;
    border-width: 2px;
    border-color: #d1d5db;
    padding: 16px;
    border-radius: 8px;
    min-height: 56px;
    justify-content: center;
    align-items: center;
`;

const AddButtonText = styled(Text)`
    color: #047857;
    font-weight: 600;
`;

const StatusText = styled(Text)`
  color: #374151;
  font-size: 15px;
  margin-top: 12px;
`;

const InviteButton = styled(TouchableOpacity)`
  min-height: 44px;
  justify-content: center;
  align-self: flex-start;
  margin-top: 8px;
  padding: 8px 16px;
  border-radius: 9999px;
  background-color: #1e3a8a;
`;

const InviteButtonText = styled(Text)`
  color: white;
  font-size: 16px;
  font-weight: bold;
`;

const Note = styled(Text)`
  color: #6b7280;
  font-size: 14px;
  margin-top: 8px;
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

const ContactSettingsScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { currentSettings, onSave } = route.params as { currentSettings: UserSettings; onSave: (settings: UserSettings) => void; };

  const [contacts, setContacts] = useState<TrustedContact[]>(currentSettings.trustedContacts);
  const [isSaving, setIsSaving] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ConsentStatus>>({});
  const onBack = () => navigation.goBack();

  const handleContactChange = (index: number, field: 'name' | 'phone', value: string) => {
    const newContacts = [...contacts];
    newContacts[index] = { ...newContacts[index], [field]: value };
    setContacts(newContacts);
  };

  const addContact = () => {
    setContacts([...contacts, { id: Date.now().toString(), name: '', phone: '' }]);
  };

  const removeContact = (id: string) => {
    setContacts(contacts.filter(c => c.id !== id));
  };
  
  // A link is made for what is SAVED. Editing a number and then asking would invite the
  // old one, so asking waits until the edit is saved.
  const saved = new Map(currentSettings.trustedContacts.map(c => [c.id, c]));
  const isDirty = (c: TrustedContact) => {
    const original = saved.get(c.id);
    return !original || original.name !== c.name || original.phone !== c.phone;
  };

  const handleInvite = async (contact: TrustedContact) => {
    setInviteError(null);
    try {
      const { url } = await apiService.createContactInvite(contact.id);
      // The user sends it, through their own messaging app. Lumo sends nothing.
      setStatuses(s => ({ ...s, [contact.id]: 'waiting' }));
      await Share.share({ message: inviteMessage(currentSettings.personalInfo.fullName, url) });
    } catch {
      setInviteError("Couldn't make a link just now. Check your connection and try again.");
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    const validContacts = contacts.filter(c => c.name && c.phone);
    // consentStatus is read-only; the client strips it again on the wire, and it is
    // dropped here so a stale value is never sent back as if the user had set it.
    await onSave({ ...currentSettings, trustedContacts: validContacts.map(({ consentStatus: _s, ...c }) => c) });
    setIsSaving(false);
    onBack();
  };

  const renderConsent = (contact: TrustedContact) => {
    const label = consentLabel(statuses[contact.id] ?? contact.consentStatus);
    if (!label) return <StatusText>Save to be able to ask them to agree.</StatusText>;
    const dirty = isDirty(contact);
    return (
      <>
        <StatusText accessibilityLiveRegion="polite">{label.text}</StatusText>
        {label.action && !dirty && (
          <InviteButton
            accessibilityRole="button"
            accessibilityLabel={`${label.action}: ${contact.name}. Opens your share sheet; Lumo does not send it.`}
            onPress={() => handleInvite(contact)}
          >
            <InviteButtonText>{label.action}</InviteButtonText>
          </InviteButton>
        )}
        {label.action && dirty && <Note>Save your changes before asking them.</Note>}
      </>
    );
  };

  return (
    <Container>
        <InnerContainer>
            <Header>
                <BackButton onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back to settings">
                <IconArrowLeft size={24} color="#1f2937" />
                </BackButton>
                <Title>Trusted contacts</Title>
            </Header>
            <ScrollView>
                {contacts.map((contact, index) => (
                <ContactCard key={contact.id}>
                    <RemoveButton onPress={() => removeContact(contact.id)} accessibilityRole="button" accessibilityLabel={`Remove ${contact.name.trim() || 'this contact'} from your trusted contacts`}>
                        <IconTrash size={20} color="#ef4444" />
                    </RemoveButton>
                    <InputContainer>
                        <IconUser size={20} color="#9ca3af" />
                        <StyledInput 
                            placeholder="Contact Name"
                            accessibilityLabel="Contact name"
                            value={contact.name}
                            onChangeText={(val) => handleContactChange(index, 'name', val)}
                        />
                    </InputContainer>
                    <InputContainer>
                        <IconPhoneCall size={20} color="#9ca3af" />
                        <StyledInput
                            placeholder="Phone Number"
                            accessibilityLabel="Contact phone number"
                            keyboardType="phone-pad"
                            value={contact.phone}
                            onChangeText={(val) => handleContactChange(index, 'phone', val)}
                        />
                    </InputContainer>
                    {renderConsent(contact)}
                </ContactCard>
                ))}
                {inviteError && <Note accessibilityLiveRegion="polite">{inviteError}</Note>}
                <Note>
                  A contact is only ever alerted if they agree. Lumo does not message them:
                  you send them a link yourself. Lumo does not send alerts to contacts yet.
                </Note>
                <AddButton onPress={addContact} accessibilityRole="button" accessibilityLabel="Add another trusted contact">
                    <AddButtonText>+ Add Another Contact</AddButtonText>
                </AddButton>
            </ScrollView>
            <SubmitButton onPress={handleSave} disabled={isSaving} accessibilityRole="button" accessibilityLabel={isSaving ? 'Saving your contacts' : 'Save your contacts'} accessibilityState={{ busy: isSaving, disabled: isSaving }}>
                <ButtonText>{isSaving ? 'Saving...' : 'Save & Update'}</ButtonText>
            </SubmitButton>
        </InnerContainer>
    </Container>
  );
};

export default ContactSettingsScreen;