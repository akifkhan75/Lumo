import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, Easing } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, useIsFocused, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActionButton, BottomNavContainer, Container, DemoMapNotice, Header, HeaderActions, HeaderTextContainer, HelloText, MapImage, MapViewContainer, NavItemContainer, NavItemLabel, RetryButton, RetryButtonText, SafetyAssistantButton, SettingsStatusRow, SettingsStatusStrip, SettingsStatusText, SOSButton, SOSButtonContainer, SOSText, UserImage, UserImageContainer, UserImagePulse, UserLocationPinContainer, VoiceGuardText } from './App.styled';
import { useShakeDetector } from './hooks/useShakeDetector';
import { useVoiceActivation } from './hooks/useVoiceActivation';
import { useAccidentDetector } from './hooks/useAccidentDetector';
import { ApiError } from '@lumo/api-client';
import * as apiService from './services/apiService';
import { IconSettings, IconShield, IconWalk, IconTimer, IconFakeCall, IconSOS, IconAlert, IconMic, IconBot } from './constants';
import { UserSettings, RootStackParamList, SettingsStackParamList } from './types';


// Screen Imports
import AuthScreen from './components/auth/AuthScreen';
import BootScreen from './components/BootScreen';
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
import LocationStatus from './components/LocationStatus';
import { useLocation } from './hooks/useLocation';


const DashboardScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Dashboard'>>();
  const { onLogout } = route.params;

  // Settings are NOT a precondition for anything on this screen. The SOS
  // control, the dialler and every navigation item render from the first frame;
  // settings only add the greeting, the profile and the hands-free triggers.
  // Gating the whole screen on this fetch meant a slow or failed request left
  // someone with a spinner or an error and no way to reach help (KI-27).
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
      // Only the server explicitly rejecting the token ends the session. A
      // timeout, a dropped connection or a 5xx says nothing about the token, and
      // signing someone out because their signal dropped would put a login in
      // front of the one situation where they can least afford it.
      if (err instanceof ApiError && err.isUnauthorized) {
        onLogout();
        return;
      }
      setError("Couldn't load your settings.");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [onLogout]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Works with or without settings. It used to return early when they had not
  // loaded, which made the button and every automatic trigger do nothing.
  const handleActivateEmergency = useCallback(() => {
    navigation.navigate('Emergency', { settings: userSettings ?? undefined });
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

  // Position is read only while this screen is focused AND the app is in the
  // foreground (docs/specs/LOCATION.md). Nothing is uploaded or shared.
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);
  const location = useLocation(focused && appActive);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
      Animated.loop(
          Animated.sequence([
              Animated.timing(pulseAnim, { toValue: 1.1, duration: 1500, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
              Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          ])
      ).start();
  }, [pulseAnim]);

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
                <HelloText>{userSettings ? `Hello ${userSettings.personalInfo.fullName},` : 'Hello,'}</HelloText>
<LocationStatus location={location} />
                {isListening && <VoiceGuardText><IconMic size={12} color="#16a34a" /> Voice Guard Active</VoiceGuardText>}
            </HeaderTextContainer>
            <HeaderActions>
                <ActionButton onPress={() => navigation.navigate('ReportHazard')}>
                    <IconAlert size={24} color="#f97316" />
                </ActionButton>
                 <ActionButton
                    // Settings need the loaded settings to edit; without them there is nothing to open.
                    disabled={!userSettings}
                    onPress={() => userSettings && navigation.navigate('Settings', { onLogout: onLogout, currentSettings: userSettings, onSave: handleSaveSettings })}
                >
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
      {!userSettings && (
        <SettingsStatusStrip>
          <SettingsStatusRow>
            {isLoading && <ActivityIndicator size="small" color="#78350f" />}
            <SettingsStatusText accessibilityLiveRegion="polite">
              {isLoading ? 'Loading your settings…' : (error ?? "Couldn't load your settings.")}
            </SettingsStatusText>
          </SettingsStatusRow>
          <SettingsStatusText>
            Shake, voice and crash triggers are off until your settings load.
            The SOS button still opens the emergency screen and phone dialler.
          </SettingsStatusText>
          {!isLoading && (
            <RetryButton
              onPress={fetchData}
              accessibilityRole="button"
              accessibilityLabel="Try loading your settings again"
            >
              <RetryButtonText>Try again</RetryButtonText>
            </RetryButton>
          )}
        </SettingsStatusStrip>
      )}
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
                <SOSButton
                    onPress={handleActivateEmergency}
                    accessibilityRole="button"
                    accessibilityLabel="Emergency. Opens the emergency screen and phone dialler"
                >
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
const navigationRef = createNavigationContainerRef<RootStackParamList>();

type AuthState = 'restoring' | 'signedIn' | 'signedOut';

const App = () => {
    // The stored session is read once on launch (KI-4). Until that finishes the
    // app shows a boot screen that carries its own emergency control, and any
    // fault reading it means signed out, never a crash.
    const [authState, setAuthState] = useState<AuthState>('restoring');

    useEffect(() => {
        let cancelled = false;
        apiService
            .restoreSession()
            .then((restored) => { if (!cancelled) setAuthState(restored ? 'signedIn' : 'signedOut'); })
            .catch(() => { if (!cancelled) setAuthState('signedOut'); });
        return () => { cancelled = true; };
    }, []);

    const handleLogin = useCallback(() => setAuthState('signedIn'), []);
    // Stable identity: it is handed to screens through route params and read in
    // an effect dependency, so a new function each render would refetch forever.
    const handleLogout = useCallback(() => {
        // Clears the in-memory token and the stored one. Logout used to clear
        // neither, so the next launch restored a session the user had ended.
        // Not awaited: the in-memory token is cleared synchronously inside, and
        // the storage delete cannot reject (tokenStorage swallows its own faults).
        apiService.signOut();
        setAuthState('signedOut');
    }, []);

    // The emergency screen is registered outside the auth conditional, so it
    // survives the session changing underneath it — a stored session finishing
    // its restore, or a 401 landing — and the user is not moved off it. But the
    // screens that were beneath it are removed by that change, which leaves a
    // stack of one route: Close then has nowhere to go and silently does
    // nothing. Put the correct root back underneath, keeping them where they are.
    useEffect(() => {
        if (authState === 'restoring' || !navigationRef.isReady()) return;
        const state = navigationRef.getRootState();
        const only = state?.routes.length === 1 ? state.routes[0] : undefined;
        if (!only || only.name !== 'Emergency') return;
        const root = authState === 'signedIn'
            ? { name: 'Dashboard' as const, params: { onLogout: handleLogout } }
            : { name: 'Auth' as const };
        navigationRef.resetRoot({
            index: 1,
            routes: [root, { name: 'Emergency', key: only.key, params: only.params as RootStackParamList['Emergency'] }],
        });
    }, [authState, handleLogout]);

    return (
        <NavigationContainer ref={navigationRef}>
            <MainStack.Navigator screenOptions={{ headerShown: false }}>
                {authState === 'restoring' ? (
                    <MainStack.Screen name="Boot">
                        {props => <BootScreen onEmergency={() => props.navigation.navigate('Emergency')} />}
                    </MainStack.Screen>
                ) : authState === 'signedOut' ? (
                     <MainStack.Screen name="Auth">
                        {props => (
                            <AuthScreen
                                {...props}
                                onLoginSuccess={handleLogin}
                                onEmergency={() => props.navigation.navigate('Emergency')}
                            />
                        )}
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
                    </>
                )}
                {/* Outside the auth conditional on purpose: the emergency screen
                    must exist whether or not anyone is signed in. */}
                <MainStack.Group screenOptions={{ presentation: 'fullScreenModal' }}>
                    <MainStack.Screen name="Emergency" component={EmergencyScreen} />
                </MainStack.Group>
            </MainStack.Navigator>
        </NavigationContainer>
    );
};


export default App;