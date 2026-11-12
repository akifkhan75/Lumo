import { useEffect, useRef, useState, useCallback } from 'react';
import { Accelerometer } from 'expo-sensors';

type AccelerometerSubscription = ReturnType<typeof Accelerometer.addListener>;

// Physics-based thresholds (in G-force, 1G = 1.0 in expo-sensors)
const SHAKE_THRESHOLD = 2.5; // G-force
const SHAKE_TIMEOUT = 800; // ms between shake events (prevent rapid triggers)
const UPDATE_INTERVAL = 100; // ms sensor polling interval

export const useShakeDetector = (
  onShake: () => void, 
  enabled: boolean = true,
  options?: {
    threshold?: number;
    timeout?: number;
  }
) => {
  // KI-20: the caller rebuilds onShake whenever user settings change. Keying
  // the subscription on its identity meant every settings save tore down the
  // accelerometer listener and set it up again — a detector that is supposed
  // to be always on, restarted by unrelated state.
  const onShakeRef = useRef(onShake);
  onShakeRef.current = onShake;

  const lastShakeTimeRef = useRef(0);
  const subscriptionRef = useRef<AccelerometerSubscription | null>(null);
  const [hasPermission, setHasPermission] = useState(true);
  const [isActive, setIsActive] = useState(false);

  const threshold = options?.threshold ?? SHAKE_THRESHOLD;
  const timeout = options?.timeout ?? SHAKE_TIMEOUT;

  const checkSensorPermissions = useCallback(async () => {
    try {
      const isAvailable = await Accelerometer.isAvailableAsync();
      if (!isAvailable) {
        setHasPermission(false);
        return false;
      }
      const { status } = await Accelerometer.getPermissionsAsync();
      if (status !== 'granted') {
        const req = await Accelerometer.requestPermissionsAsync();
        const granted = req.status === 'granted';
        setHasPermission(granted);
        return granted;
      }
      setHasPermission(true);
      return true;
    } catch (err) {
      console.warn('Accelerometer permission error:', err);
      // On many devices, accelerometer does not require explicit runtime permissions
      setHasPermission(true);
      return true;
    }
  }, []);

  const stopDetection = useCallback(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
    setIsActive(false);
  }, []);

  const startDetection = useCallback(async () => {
    if (!enabled) return;

    try {
      const hasPerms = await checkSensorPermissions();
      if (!hasPerms) {
        console.log('Shake detection disabled - missing permissions or sensor unavailable');
        return;
      }

      stopDetection();
      Accelerometer.setUpdateInterval(UPDATE_INTERVAL);
      setIsActive(true);

      subscriptionRef.current = Accelerometer.addListener(({ x, y, z }) => {
        // Accelerometer returns acceleration in Gs (where 1G ≈ 1.0)
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        if (magnitude > threshold) {
          const now = Date.now();
          if (now - lastShakeTimeRef.current > timeout) {
            lastShakeTimeRef.current = now;
            console.log(`Shake detected: ${magnitude.toFixed(2)}G`);
            onShakeRef.current();
          }
        }
      });
    } catch (error) {
      console.warn('Failed to start accelerometer:', error);
      setIsActive(false);
    }
  }, [enabled, threshold, timeout, checkSensorPermissions, stopDetection]);

  useEffect(() => {
    if (enabled) {
      startDetection();
    } else {
      stopDetection();
    }

    return () => {
      stopDetection();
    };
  }, [enabled, startDetection, stopDetection]);

  return {
    isActive,
    hasPermission,
    checkPermissions: checkSensorPermissions,
    startDetection,
    stopDetection,
  };
};