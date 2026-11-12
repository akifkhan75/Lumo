import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, Animated, Easing } from 'react-native';
import { NavigationContainer, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActionButton, BottomNavContainer, Container, DangerZonePinContainer, DemoMapNotice, ErrorContainer, ErrorText, Header, HeaderActions, HeaderTextContainer, HelloText, LoadingContainer, LocationText, MapImage, MapViewContainer, NavItemContainer, NavItemLabel, PinCircleBase, PinPulseCircle, SafetyAssistantButton, SOSButton, SOSButtonContainer, SOSText, UserImage, UserImageContainer, UserImagePulse, UserLocationPinContainer, VoiceGuardText } from './App.styled';
import { useShakeDetector } from './hooks/useShakeDetector';
import { useVoiceActivation } from './hooks/useVoiceActivation';
import { useAccidentDetector } from './hooks/useAccidentDetector';
import * as apiService from './services/apiService';
import { IconSettings, IconShield, IconWalk, IconTimer, IconFakeCall, IconSOS, IconAlert, IconMic, IconBot } from './constants';
import { UserSettings, DangerZone, DangerZoneType, DangerZoneSeverity, RootStackParamList, SettingsStackParamList } from './types';


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
import ReportDangerZoneScreen from './components/ReportDangerZoneModal';
import SafetyAssistantScreen from './components/SafetyAssistantModal';
import DemoBanner from './components/common/DemoBanner';


const DangerZonePin = ({ zone }: { zone: DangerZone }) => {
    const severityStyles = {
        low: { color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.3)' },
        medium: { color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.3)' },
        high: { color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.3)' },
    };
    const { color, bgColor } = severityStyles[zone.severity];
    const pulseAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
                Animated.timing(pulseAnim, { toValue: 0, duration: 1000, useNativeDriver: true }),
            ])
        ).start();
    }, [pulseAnim]);

    const pulseStyle = {
        transform: [{ scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] }) }],
        opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
    };

    const top = zone?.location?.top ?? (zone as any)?.top ?? '50%';
    const left = zone?.location?.left ?? (zone as any)?.left ?? '50%';

    return (
        <DangerZonePinContainer
            style={{ top: top as any, left: left as any }}
            onPress={() => Alert.alert(`Severity: ${zone.severity.toUpperCase()}`, `${zone.type}: ${zone.description}`)}
        >
            <PinPulseCircle style={pulseStyle} pulseColor={color} />
            <PinCircleBase bgColor={bgColor} borderColor={color}>
                <IconAlert color={color} size={14}/>
            </PinCircleBase>
        </DangerZonePinContainer>
    );
};


const DashboardScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Dashboard'>>();
  const { onLogout } = route.params;

  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [dangerZones, setDangerZones] = useState<DangerZone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [settings, zones] = await Promise.all([
        apiService.getSettings(),
        apiService.getDangerZones()
      ]);
      setUserSettings(settings);
      setDangerZones(zones);
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

  const handleAddDangerZone = async (details: { type: DangerZoneType; severity: DangerZoneSeverity; description: string; }) => {
    try {
        const newZone = await apiService.reportDangerZone(details);
        setDangerZones(prev => [...prev, newZone]);
        navigation.goBack();
        setTimeout(() => {
            Alert.alert(`Thank you`, `Your report has been added to the map.`);
        }, 300);
    } catch (err) {
        Alert.alert("Error", "Failed to report danger zone. Please try again.");
        console.error(err);
    }
  };

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
         <MapImage source={require('./assets/images/map_bg.jpg')}>
            {dangerZones.map(zone => <DangerZonePin key={zone.id} zone={zone} />)}
         </MapImage>
         <Header>
            <HeaderTextContainer>
                <HelloText>Hello {userSettings.personalInfo.fullName},</HelloText>
<LocationText>Location unavailable — Lumo does not read your position yet</LocationText>
                {isListening && <VoiceGuardText><IconMic size={12} color="#16a34a" /> Voice Guard Active</VoiceGuardText>}
            </HeaderTextContainer>
            <HeaderActions>
                <ActionButton onPress={() => navigation.navigate('ReportDangerZone', { onReport: handleAddDangerZone })}>
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
                            <MainStack.Screen name="ReportDangerZone" component={ReportDangerZoneScreen} />
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