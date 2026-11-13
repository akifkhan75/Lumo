import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import { isStale, type Fix } from '../services/locationFormat';

/**
 * The dashboard map. It draws ONE thing: the device's own position, and only when there
 * is a real, usable fix. With no fix it shows a neutral world view and says so; it never
 * centres on a made-up place or draws a marker "for show".
 *
 * Not drawn here, on purpose: hazard reports (Phase 4 — a deliberate change, with its own
 * confidence-and-age rules) and journeys (milestone 1.10).
 *
 * A map is not operable by a screen reader. The position is also stated as text by
 * LocationStatus, which is the accessible equivalent.
 */

const WORLD = { latitude: 20, longitude: 0, latitudeDelta: 100, longitudeDelta: 100 };
/** Zoom to roughly the fix's own error radius, never tighter than a street. */
const regionFor = (fix: Fix) => {
  const delta = Math.max(0.005, (fix.accuracyM * 4) / 111_000);
  return { latitude: fix.latitude, longitude: fix.longitude, latitudeDelta: delta, longitudeDelta: delta };
};

export default function MapSurface({ fix, now = Date.now }: { fix: Fix | null; now?: () => number }) {
  const ref = useRef<MapView>(null);
  useEffect(() => {
    if (fix) ref.current?.animateToRegion(regionFor(fix), 400);
  }, [fix]);

  const stale = fix ? isStale(fix, now()) : false;

  return (
    <View
      style={StyleSheet.absoluteFill}
      accessible
      accessibilityLabel="Map. Your position, if known, is also written as text at the top of the screen."
    >
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        initialRegion={fix ? regionFor(fix) : WORLD}
        // Lumo draws its own marker; the platform's blue dot would be a second, unlabelled claim.
        showsUserLocation={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        {fix && (
          <>
            <Circle
              center={fix}
              radius={fix.accuracyM}
              strokeColor={stale ? 'rgba(107,114,128,0.8)' : 'rgba(37,99,235,0.8)'}
              fillColor={stale ? 'rgba(107,114,128,0.15)' : 'rgba(37,99,235,0.15)'}
            />
            <Marker
              coordinate={fix}
              title={stale ? 'Last known position' : 'Your position'}
              pinColor={stale ? 'gray' : 'blue'}
            />
          </>
        )}
      </MapView>
      {!fix && (
        <View style={styles.note} pointerEvents="none">
          <Text style={styles.noteText}>Your position isn't known, so the map isn't centred on you.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  note: { position: 'absolute', bottom: 12, left: 16, right: 16, backgroundColor: 'rgba(255,255,255,0.92)', padding: 8, borderRadius: 8 },
  noteText: { color: '#1f2937', fontSize: 14 },
});
