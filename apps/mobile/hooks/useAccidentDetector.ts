import { useEffect, useRef } from 'react';
import { Accelerometer } from 'expo-sensors';

type AccelerometerSubscription = ReturnType<typeof Accelerometer.addListener>;

const ACCIDENT_THRESHOLD = 6.0; // High G-force (~60 m/s²) for crash detection
const ACCIDENT_TIMEOUT = 1000; // ms to prevent multiple triggers

export const useAccidentDetector = (onDetect: () => void, enabled: boolean = true) => {
  // KI-20: held in a ref so a change of callback identity does not tear the
  // subscription down. See useShakeDetector.
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  const lastDetectionTimeRef = useRef(0);
  const subscriptionRef = useRef<AccelerometerSubscription | null>(null);

  useEffect(() => {
    let isMounted = true;

    const start = async () => {
      try {
        const available = await Accelerometer.isAvailableAsync();
        if (!available || !isMounted || !enabled) return;

        Accelerometer.setUpdateInterval(100);
        subscriptionRef.current = Accelerometer.addListener(({ x, y, z }) => {
          const force = Math.sqrt(x * x + y * y + z * z);
          if (force > ACCIDENT_THRESHOLD) {
            const now = Date.now();
            if (now - lastDetectionTimeRef.current > ACCIDENT_TIMEOUT) {
              lastDetectionTimeRef.current = now;
              console.log('Accident detected with force:', force);
              onDetectRef.current();
            }
          }
        });
      } catch (err) {
        console.warn('Accident detector sensor error:', err);
      }
    };

    if (enabled) {
      start();
    } else if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }

    return () => {
      isMounted = false;
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
    };
  }, [enabled]);
};

