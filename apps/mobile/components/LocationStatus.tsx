import React, { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { LocationAction, LocationActionText, LocationText } from '../App.styled';
import type { UseLocation } from '../hooks/useLocation';
import { describeFix } from '../services/locationFormat';
import { placeApplies } from '../services/placeTracking';

/**
 * What the dashboard says about the device's position. Honest by construction:
 * every state names what Lumo is doing, and none implies anything is shared.
 * A fix is always shown with its age and precision; a stale one is "last known".
 */
const TICK_MS = 15_000;

export default function LocationStatus({ location, now = Date.now }: { location: UseLocation; now?: () => number }) {
  // Re-render on a timer so an old fix visibly ages even when no new one arrives.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const { permission, fix, geocoded, watchFailed, request } = location;

  const action = (label: string, text: string, onPress: () => void) => (
    <LocationAction accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <LocationActionText>{text}</LocationActionText>
    </LocationAction>
  );

  if (permission === 'checking') {
    return <LocationText accessibilityLiveRegion="polite">Checking location permission…</LocationText>;
  }
  if (permission === 'undetermined') {
    return (
      <>
        <LocationText>Location is off. Lumo reads your position only while the app is open, and shares it with no one.</LocationText>
        {action('Allow Lumo to read your location while the app is open', 'Show my location', request)}
      </>
    );
  }
  if (permission === 'denied') {
    return (
      <>
        <LocationText>Location is off — permission was declined. Nothing is being read.</LocationText>
        {action('Ask again to read your location while the app is open', 'Ask again', request)}
      </>
    );
  }
  if (permission === 'blocked') {
    return (
      <>
        <LocationText>Location is off, and this device will not ask again. Turn it on in Settings.</LocationText>
        {action('Open this app’s settings to turn on location', 'Open Settings', () => {
          Linking.openSettings().catch(() => {});
        })}
      </>
    );
  }

  // Granted.
  if (!fix) {
    return (
      <LocationText accessibilityLiveRegion="polite">
        {watchFailed ? "Couldn't read your position." : 'Looking for your position…'}
      </LocationText>
    );
  }

  const d = describeFix(fix, now());
  const placeLine = !geocoded
    ? null
    : !geocoded.ok
      ? "Couldn't tell which country you are in."
      : placeApplies(geocoded, fix) && geocoded.place.country
        ? `Country: ${geocoded.place.country}`
        : null;

  return (
    <>
      <LocationText accessibilityLiveRegion="polite">{d.text}</LocationText>
      {d.warning && <LocationText>{d.warning}</LocationText>}
      {placeLine && <LocationText>{placeLine}</LocationText>}
    </>
  );
}
