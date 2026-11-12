import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, Animated, Easing } from 'react-native';
import { NavigationContainer, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActionButton, BottomNavContainer, Container, DemoMapNotice, ErrorContainer, ErrorText, Header, HeaderActions, HeaderTextContainer, HelloText, LoadingContainer, LocationText, MapImage, MapViewContainer, NavItemContainer, NavItemLabel, SafetyAssistantButton, SOSButton, SOSButtonContainer, SOSText, UserImage, UserImageContainer, UserImagePulse, UserLocationPinContainer, VoiceGuardText } from './App.styled';
import { useShakeDetector } from './hooks/useShakeDetector';
import { useVoiceActivation } from './hooks/useVoiceActivation';
import { useAccidentDetector } from './hooks/useAccidentDetector';
import * as apiService from './services/apiService';
import { IconSettings, IconShield, IconWalk, IconTimer, IconFakeCall, IconSOS, IconAlert, IconMic, IconBot } from './constants';
import { UserSettings, RootStackParamList, SettingsStackParamList } from './types';


// Screen Imports
import AuthScreen from './components/auth/AuthScreen';
import EmergencyScreen from './components/EmergencyModal';
import FakeCallScreen from './components/FakeCallScreen';
import SettingsScreen from './components/settings/SettingsModal';
import ProfileSettingsScreen from './components/settings/ProfileSettings';
import ContactSettingsScreen from './components/settings/ContactSettings';
import AlertSettingsScreen from './components/settings/AlertSettings';
import FollowMeScreen from './components/FollowMeModal';
import CheckInScreen from './components/CheckInModal';
import CommunitySafetyScreen from './components/CommunitySafetyModal';
import ReportHazardScreen from './components/ReportHazardModal';
import SafetyAssistantScreen from './components/SafetyAssistantModal';
import DemoBanner from './components/common/DemoBanner';


const DashboardScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Dashboard'>>();
  const { onLogout } = route.params;

  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const settings = await apiService.getSettings();
      setUserSettings(settings);
    } catch (err) {
      setError('Failed to load application data. Please try again later.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleActivateEmergency = useCallback(() => {
    if (!userSettings) return;
    console.log("SOS Activated!");
    navigation.navigate('Emergency', { settings: userSettings });
  }, [userSettings, navigation]);

  const handleSaveSettings = useCallback(async (newSettings: UserSettings) => {
    try {
        const updatedSettings = await apiService.updateSettings(newSettings);
        setUserSettings(updatedSettings);
    } catch (err) {
        Alert.alert("Error", "Failed to save settings. Please try again.");
        console.error(err);
    }
  }, []);

  const shakeEnabled = userSettings?.security.shakeToSosEnabled ?? false;
  const voiceEnabled = userSettings?.security.voiceActivationEnabled ?? false;
  const accidentEnabled = userSettings?.security.accidentDetectionEnabled ?? false;

  useShakeDetector(handleActivateEmergency, shakeEnabled);
  const { error: voiceError, isListening, clearError: clearVoiceError } = useVoiceActivation(handleActivateEmergency, voiceEnabled);
  useAccidentDetector(handleActivateEmergency, accidentEnabled);

  // Read inside the effect below without making it a dependency. Saving
  // settings replaces this object, and an effect that both depends on it and
  // writes to it re-fires forever — previously one alert and one PUT per
  // render, indefinitely.
  const userSettingsRef = useRef(userSettings);
  userSettingsRef.current = userSettings;
  const handledVoiceErrorRef = useRef<string | null>(null);

  useEffect(() => {
      if (!voiceError) {
          handledVoiceErrorRef.current = null;
          return;
      }
      // One alert per distinct failure, never one per render.
      if (handledVoiceErrorRef.current === voiceError) return;
      handledVoiceErrorRef.current = voiceError;

      Alert.alert(
          "Voice activation stopped",
          `${voiceError}\n\nHands-free SOS is off. The SOS button and shake-to-SOS still work. You can re-enable voice in Settings.`
      );

      const current = userSettingsRef.current;
      if (current?.security.voiceActivationEnabled) {
          handleSaveSettings({
              ...current,
              security: { ...current.security, voiceActivationEnabled: false }
          });
      }
      clearVoiceError();
  }, [voiceError, handleSaveSettings, clearVoiceError]);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
      Animated.loop(
          Animated.sequence([
              Animated.timing(pulseAnim, { toValue: 1.1, duration: 1500, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
              Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          ])
      ).start();
  }, [pulseAnim]);

  if (isLoading) {
    return <LoadingContainer><ActivityIndicator size="large" /></LoadingContainer>;
  }

  if (error || !userSettings) {
    return <ErrorContainer><ErrorText>{error || 'An unexpected error occurred.'}</ErrorText></ErrorContainer>;
  }

  return (
    <Container>
      <MapViewContainer>
         {/* Hazard reports are not drawn here. They carry real coordinates
             now and this is a JPEG, so there is no projection from one to the
             other — a pin placed on this image would be decoration. They are
             listed, with their age and confirmations, in the Community Hub. */}
         <MapImage source={require('./assets/images/map_bg.jpg')} />
         <Header>
            <HeaderTextContainer>
                <HelloText>Hello {userSettings.personalInfo.fullName},</HelloText>
<LocationText>Location unavailable — Lumo does not read your position yet</LocationText>
                {isListening && <VoiceGuardText><IconMic size={12} color="#16a34a" /> Voice Guard Active</VoiceGuardText>}
            </HeaderTextContainer>
            <HeaderActions>
                <ActionButton onPress={() => navigation.navigate('ReportHazard')}>
                    <IconAlert size={24} color="#f97316" />
                </ActionButton>
                 <ActionButton onPress={() => navigation.navigate('Settings', { onLogout: onLogout, currentSettings: userSettings, onSave: handleSaveSettings })}>
                    <IconSettings size={24} color="#4b5563" />
                </ActionButton>
            </HeaderActions>
         </Header>
         <DemoMapNotice>
            <DemoBanner>
              The map is a static picture. The pins are sample reports placed at
              random — they are not positions, and the avatar is not you.
            </DemoBanner>
         </DemoMapNotice>
         <UserLocationPinContainer style={{transform: [{translateX: -32}, {translateY: -32}]}}>
            <UserImagePulse style={{ transform: [{ scale: pulseAnim }] }} />
            <UserImageContainer>
                <UserImage source={require('./assets/images/user_avatar.jpg')} />
            </UserImageContainer>
         </UserLocationPinContainer>
      </MapViewContainer>
      <BottomNavContainer>
            <NavItemContainer onPress={() => navigation.navigate('CommunitySafety')}>
                <IconShield size={28} color="#4b5563" />
                <NavItemLabel>Community</NavItemLabel>
            </NavItemContainer>
            <NavItemContainer onPress={() => navigation.navigate('FollowMe')}>
                <IconWalk size={28} color="#4b5563" />
                <NavItemLabel>Follow Me</NavItemLabel>
            </NavItemContainer>
            <SOSButtonContainer>
                <SOSButton onPress={handleActivateEmergency}>
                    <IconSOS size={32} color="green" />
                    <SOSText>SOS</SOSText>
                </SOSButton>
            </SOSButtonContainer>
            <NavItemContainer onPress={() => navigation.navigate('CheckIn', { onEmergency: handleActivateEmergency })}>
                <IconTimer size={28} color="#4b5563" />
                <NavItemLabel>Check-In</NavItemLabel>
            </NavItemContainer>
            <NavItemContainer onPress={() => navigation.navigate('FakeCall')}>
                <IconFakeCall size={28} color="#4b5563" />
                <NavItemLabel>Fake Call</NavItemLabel>
            </NavItemContainer>
      </BottomNavContainer>
      <SafetyAssistantButton onPress={() => navigation.navigate('SafetyAssistant')}>
          <IconBot size={32} color="white" />
      </SafetyAssistantButton>
    </Container>
  );
};


const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();

const SettingsNavigator = ({ route }: { route: RouteProp<RootStackParamList, 'Settings'> }) => {
    const { onLogout, currentSettings, onSave } = route.params;
    return (
        <SettingsStack.Navigator screenOptions={{ headerShown: false }}>
            <SettingsStack.Screen 
                name="SettingsRoot" 
                component={SettingsScreen} 
                initialParams={{ onLogout, currentSettings, onSave }}
            />
            <SettingsStack.Screen 
                name="ProfileSettings" 
                component={ProfileSettingsScreen}
                initialParams={{ currentSettings, onSave }}
            />
            <SettingsStack.Screen 
                name="ContactSettings" 
                component={ContactSettingsScreen} 
                initialParams={{ currentSettings, onSave }}
            />
            <SettingsStack.Screen 
                name="AlertSettings" 
                component={AlertSettingsScreen}
                initialParams={{ currentSettings, onSave }}
            />
        </SettingsStack.Navigator>
    );
};

const MainStack = createNativeStackNavigator<RootStackParamList>();

const App = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    
    const handleLogin = () => setIsAuthenticated(true);
    const handleLogout = () => {
        setIsAuthenticated(false);
    };

    return (
        <NavigationContainer>
            <MainStack.Navigator screenOptions={{ headerShown: false }}>
                {!isAuthenticated ? (
                     <MainStack.Screen name="Auth">
                        {props => <AuthScreen {...props} onLoginSuccess={handleLogin} />}
                    </MainStack.Screen>
                ) : (
                    <>
                        <MainStack.Screen 
                            name="Dashboard"
                            component={DashboardScreen} 
                            initialParams={{ onLogout: handleLogout }}
                        />
                        <MainStack.Group screenOptions={{ presentation: 'modal' }}>
                            <MainStack.Screen name="Settings" component={SettingsNavigator} />
                            <MainStack.Screen name="CommunitySafety" component={CommunitySafetyScreen} />
                            <MainStack.Screen name="FollowMe" component={FollowMeScreen} />
                            <MainStack.Screen name="CheckIn" component={CheckInScreen} />
                            <MainStack.Screen name="FakeCall" component={FakeCallScreen} />
                            <MainStack.Screen name="ReportHazard" component={ReportHazardScreen} />
                            <MainStack.Screen name="SafetyAssistant" component={SafetyAssistantScreen} />
                        </MainStack.Group>
                        <MainStack.Group screenOptions={{ presentation: 'fullScreenModal' }}>
                            <MainStack.Screen name="Emergency" component={EmergencyScreen} />
                        </MainStack.Group>
                    </>
                )}
            </MainStack.Navigator>
        </NavigationContainer>
    );
};


export default App;