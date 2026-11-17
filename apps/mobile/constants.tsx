import React from 'react';
import Feather from '@expo/vector-icons/Feather';
import { I18nManager, StyleProp, TextStyle } from 'react-native';

const Icon = Feather as any;

interface IconProps {
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
  className?: string;
}

export const IconTrash: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="trash-2" size={size} color={color} style={style} />;
/**
 * A "back" arrow points toward where you came from, which is the other way in a right-to-left language. Direction-bearing icons are mirrored
 * when the layout is RTL (docs/specs/REGION_PROFILES.md: a mirrored SOS button or a wrong-way arrow is a functional failure).
 */
const mirrored = (style?: StyleProp<TextStyle>): StyleProp<TextStyle> => (I18nManager.isRTL ? [style, { transform: [{ scaleX: -1 }] }] : style);
export const IconArrowLeft: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="arrow-left" size={size} color={color} style={mirrored(style)} />;
export const IconSettings: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="settings" size={size} color={color} style={style} />;
export const IconShield: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="shield" size={size} color={color} style={style} />;
export const IconFakeCall: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="phone-off" size={size} color={color} style={style} />;
export const IconWalk: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="map" size={size} color={color} style={style} />;
export const IconTimer: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="clock" size={size} color={color} style={style} />;
export const IconSOS: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="alert-octagon" size={size} color={color} style={style} />;
export const IconProfile: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="user" size={size} color={color} style={style} />;
export const IconContact: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="users" size={size} color={color} style={style} />;
export const IconLocation: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="map-pin" size={size} color={color} style={style} />;
export const IconAlert: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="alert-circle" size={size} color={color} style={style} />;
export const IconLogout: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="log-out" size={size} color={color} style={style} />;
export const IconChevronRight: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="chevron-right" size={size} color={color} style={mirrored(style)} />;
export const IconMail: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="mail" size={size} color={color} style={style} />;
export const IconLock: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="lock" size={size} color={color} style={style} />;
export const IconUser: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="user" size={size} color={color} style={style} />;
export const IconUsers: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="users" size={size} color={color} style={style} />;
export const IconPhoneCall: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="phone" size={size} color={color} style={style} />;
export const IconVolumeUp: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="volume-2" size={size} color={color} style={style} />;
export const IconZap: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="zap" size={size} color={color} style={style} />;
export const IconMic: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="mic" size={size} color={color} style={style} />;
export const IconShare: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="share-2" size={size} color={color} style={style} />;
export const IconCar: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="truck" size={size} color={color} style={style} />;
export const IconRoute: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="git-branch" size={size} color={color} style={style} />;
export const IconBot: React.FC<IconProps> = ({ size = 24, color = "currentColor", style }) => <Icon name="message-circle" size={size} color={color} style={style} />;