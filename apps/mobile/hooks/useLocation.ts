import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { placeFromGeocode, type ResolvedPlace } from '@lumo/region-profiles';
import type { Fix } from '../services/locationFormat';
import { shouldGeocode, type Geocoded } from '../services/placeTracking';

/**
 * Foreground device location (docs/specs/LOCATION.md).
 *
 * - Permission is READ on mount (never asked); asking happens only in `request()`,
 *   which a user action calls.
 * - Foreground only. Nothing here can read a position while the app is closed.
 * - Watching runs only while `active` (screen focused AND app in the foreground) and the
 *   permission is granted. The subscription is removed on every exit.
 * - A reading with unknown accuracy is dropped — it is not a usable fix, and is never
 *   turned into 0 ("perfectly precise").
 * - The reverse-geocoded place belongs to the fix it was requested for.
 * - Nothing is uploaded, stored or logged: the fix lives in this hook's state only.
 */

export type LocationPermission = 'checking' | 'undetermined' | 'denied' | 'blocked' | 'granted';

export interface UseLocation {
  readonly permission: LocationPermission;
  /** The newest USABLE fix, or null. */
  readonly fix: Fix | null;
  /** Place of `fix`, only while the geocode still applies to it. */
  readonly geocoded: Geocoded | null;
  /** The platform watch failed after permission was granted. */
  readonly watchFailed: boolean;
  /** Ask the OS. Call only from a user action. */
  readonly request: () => Promise<void>;
}

const toPermission = (r: { granted: boolean; canAskAgain: boolean; status: string }): LocationPermission =>
  r.granted ? 'granted' : r.status === 'undetermined' ? 'undetermined' : r.canAskAgain ? 'denied' : 'blocked';

export function useLocation(active: boolean, now: () => number = Date.now): UseLocation {
  const [permission, setPermission] = useState<LocationPermission>('checking');
  const [fix, setFix] = useState<Fix | null>(null);
  const [geocoded, setGeocoded] = useState<Geocoded | null>(null);
  const [watchFailed, setWatchFailed] = useState(false);

  const geocodedRef = useRef<Geocoded | null>(null);
  const inFlight = useRef(false);
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    let cancelled = false;
    Location.getForegroundPermissionsAsync()
      .then((r) => !cancelled && setPermission(toPermission(r)))
      // Unreadable permission state is "not granted"; it never turns tracking on.
      .catch(() => !cancelled && setPermission('undetermined'));
    return () => {
      cancelled = true;
    };
  }, []);

  const request = useCallback(async () => {
    try {
      setPermission(toPermission(await Location.requestForegroundPermissionsAsync()));
    } catch {
      setPermission('denied');
    }
  }, []);

  useEffect(() => {
    if (permission !== 'granted' || !active) return;
    let cancelled = false;
    let subscription: { remove: () => void } | null = null;
    setWatchFailed(false);

    const geocode = (f: Fix) => {
      inFlight.current = true;
      const requestedAt = nowRef.current();
      const done = (ok: boolean, place: ResolvedPlace) => {
        inFlight.current = false;
        const g: Geocoded = { for: { latitude: f.latitude, longitude: f.longitude, capturedAt: f.capturedAt }, requestedAt, ok, place };
        geocodedRef.current = g;
        if (!cancelled) setGeocoded(g);
      };
      Location.reverseGeocodeAsync({ latitude: f.latitude, longitude: f.longitude })
        .then((results) => {
          const place = placeFromGeocode(results?.[0] ?? {});
          done(true, place);
        })
        .catch(() => done(false, { country: null, subdivision: null }));
    };

    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
      (loc) => {
        const accuracy = loc?.coords?.accuracy;
        // Unknown or nonsensical accuracy: not a usable fix. Keep the previous one
        // (it will age and go stale honestly) rather than inventing precision.
        if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0) return;
        const f: Fix = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          accuracyM: accuracy,
          capturedAt: loc.timestamp,
        };
        setFix(f);
        if (shouldGeocode(geocodedRef.current, inFlight.current, f, nowRef.current())) geocode(f);
      },
    )
      .then((sub) => {
        if (cancelled) sub.remove();
        else subscription = sub;
      })
      .catch(() => !cancelled && setWatchFailed(true));

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [permission, active]);

  return { permission, fix, geocoded, watchFailed, request };
}
