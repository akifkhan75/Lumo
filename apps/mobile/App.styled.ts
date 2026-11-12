import { Animated, Image, ImageBackground, Text, TouchableOpacity, View } from 'react-native';
import styled from 'styled-components/native';


export const Container = styled(View)`
  flex: 1;
  background-color: #ffffff;
`;

export const LoadingContainer = styled(View)`
    flex: 1;
    justify-content: center;
    align-items: center;
`;

export const ErrorContainer = styled(View)`
    flex: 1;
    justify-content: center;
    align-items: center;
    padding: 32px;
`;

export const ErrorText = styled(Text)`
    color: red;
    text-align: center;
`;

export const MapViewContainer = styled(View)`
  flex: 1;
  background-color: #e5e7eb;
`;

export const MapImage = styled(ImageBackground)`
    width: 100%;
    height: 100%;
`;

export const Header = styled(View)`
    position: absolute;
    top: 40px;
    left: 16px;
    right: 16px;
    flex-direction: row;
    justify-content: space-between;
    align-items: flex-start;
    z-index: 10;
`;

export const HeaderTextContainer = styled(View)`
    flex: 1;
`;

export const HelloText = styled(Text)`
    font-size: 22px;
    font-weight: 700;
    color: #ffffff;
    text-shadow: 0px 1px 4px rgba(0, 0, 0, 0.7);
`;

export const LocationText = styled(Text)`
    font-size: 14px;
    color: #94a3b8;
    margin-top: 4px;
    font-weight: 500;
    text-shadow: 0px 1px 3px rgba(0, 0, 0, 0.7);
`;


export const VoiceGuardText = styled(Text)`
    font-size: 12px;
    color: #16a34a;
    font-weight: 600;
    margin-top: 4px;
    flex-direction: row;
    align-items: center;
`;

export const HeaderActions = styled(View)`
    flex-direction: row;
`;

export const ActionButton = styled(TouchableOpacity)`
    background-color: white;
    padding: 8px;
    border-radius: 9999px;
    margin-left: 8px;
    shadow-color: #000;
    shadow-offset: 0px 2px;
    shadow-opacity: 0.25;
    shadow-radius: 3.84px;
    elevation: 5;
`;

export const UserLocationPinContainer = styled(View)`
    position: absolute;
    top: 50%;
    left: 50%;
`;

export const UserImagePulse = styled(Animated.View)`
    position: absolute;
    background-color: rgba(52, 211, 153, 0.3);
    width: 64px;
    height: 64px;
    border-radius: 32px;
`;

export const UserImageContainer = styled(View)`
    width: 64px;
    height: 64px;
    border-radius: 32px;
    background-color: #fbbF04;
    border-width: 4px;
    border-color: white;
    shadow-color: #000;
    shadow-offset: 0px 2px;
    shadow-opacity: 0.25;
    shadow-radius: 3.84px;
    elevation: 5;
    justify-content: center;
    align-items: center;
`;

export const UserImage = styled(Image)`
    width: 56px;
    height: 56px;
    border-radius: 28px;
`;

export const BottomNavContainer = styled(View)`
    height: 96px;
    background-color: rgba(255, 255, 255, 0.9);
    flex-direction: row;
    justify-content: space-around;
    align-items: flex-start;
    padding-top: 16px;
    border-top-width: 1px;
    border-top-color: #e5e7eb;
`;

export const NavItemContainer = styled(TouchableOpacity)`
    align-items: center;
    width: 64px;
`;

export const NavItemLabel = styled(Text)`
    font-size: 12px;
    font-weight: 500;
    color: #4b5563;
    text-align: center;
    margin-top: 2px;
`;

export const SOSButtonContainer = styled(View)`
    position: relative;
    top: -40px;
`;

export const SOSButton = styled(TouchableOpacity)`
    width: 80px;
    height: 80px;
    background-color: #dc2626;
    border-radius: 40px;
    justify-content: center;
    align-items: center;
    shadow-color: #000;
    shadow-offset: 0px 4px;
    shadow-opacity: 0.30;
    shadow-radius: 4.65px;
    elevation: 8;
    border-width: 4px;
    border-color: white;
`;

export const SOSText = styled(Text)`
    font-size: 12px;
    font-weight: bold;
    color: white;
`;

export const SafetyAssistantButton = styled(TouchableOpacity)`
    position: absolute;
    bottom: 112px; /* Above BottomNav */
    right: 16px;
    width: 64px;
    height: 64px;
    border-radius: 32px;
    background-color: #4f46e5; /* indigo-600 */
    justify-content: center;
    align-items: center;
    shadow-color: #000;
    shadow-offset: 0px 4px;
    shadow-opacity: 0.30;
    shadow-radius: 4.65px;
    elevation: 8;
    z-index: 20;
`;

// Sits under the dashboard header, over the placeholder map. Removed with the
// placeholder map.
export const DemoMapNotice = styled.View`
  position: absolute;
  top: 110px;
  left: 16px;
  right: 16px;
`;
