import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeModules } from 'react-native';

// "Lumo" is a coined word, so speech-to-text transcribes it inconsistently
// ("loomo", "luma", "lou mo"). Matching a single literal phrase would silently
// disable hands-free SOS for most users, so we look for any brand variant AND an
// intent word in the same utterance.
//
// UNVALIDATED: this list is a starting point, not a measurement. It must be tuned
// against real on-device transcripts before launch — a wake word that fails to
// fire is a safety defect, and one that over-fires causes alert fatigue.
// High-collision homophones ("limo", "lumen") are deliberately excluded.
const BRAND_VARIANTS = ['lumo', 'loomo', 'luma', 'lou mo', 'loom o'];
const INTENT_WORDS = ['emergency', 'help', 'sos'];

const RESTART_DELAY_MS = 500;

const isWakeUtterance = (transcript: string): boolean => {
    const t = transcript.toLowerCase();
    return BRAND_VARIANTS.some(brand => t.includes(brand)) && INTENT_WORDS.some(intent => t.includes(intent));
};

export const useVoiceActivation = (onActivate: () => void, enabled: boolean) => {
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Held in a ref so a change of callback identity does not tear down and
    // restart the recognizer. The caller's onActivate is rebuilt whenever user
    // settings change, and destroying the recognizer on every settings save
    // left a window with no hands-free trigger at all.
    const onActivateRef = useRef(onActivate);
    onActivateRef.current = onActivate;

    const clearError = useCallback(() => setError(null), []);

    useEffect(() => {
        // Voice module is only available in custom dev clients / native builds, not standard Expo Go
        const isVoiceAvailable = !!NativeModules.Voice;
        if (!isVoiceAvailable) {
            if (enabled) {
                console.log('Voice activation is not supported in Expo Go (requires a custom development build).');
            }
            setIsListening(false);
            return;
        }

        let Voice: any;
        try {
            Voice = require('@react-native-voice/voice').default;
        } catch (e: any) {
            if (enabled) {
                setError('Voice recognition module failed to load: ' + e?.message);
            }
            return;
        }

        if (!Voice) return;

        // Guards every async continuation below: once the effect is cleaned up,
        // nothing may restart the recognizer or write state.
        let disposed = false;
        let restartTimer: ReturnType<typeof setTimeout> | null = null;

        const onSpeechResults = (e: any) => {
            // Check every alternative the recognizer returns, not just the top one:
            // a coined wake word is often ranked second or third.
            if (e.value?.some((alternative: string) => isWakeUtterance(alternative))) {
                onActivateRef.current();
            }
        };

        const onSpeechError = (e: any) => {
            if (disposed) return;
            setError(e.error?.message || 'An unknown voice error occurred');
            setIsListening(false);
        };

        const onSpeechEnd = () => {
            if (disposed) return;
            setIsListening(false);
            if (enabled) {
                restartTimer = setTimeout(startListening, RESTART_DELAY_MS);
            }
        };

        Voice.onSpeechResults = onSpeechResults;
        Voice.onSpeechError = onSpeechError;
        Voice.onSpeechEnd = onSpeechEnd;
        Voice.onSpeechStart = () => {
            if (!disposed) setIsListening(true);
        };

        const startListening = async () => {
            if (disposed || !enabled) return;
            try {
                await Voice.start('en-US');
                if (disposed) return;
                setIsListening(true);
                setError(null);
            } catch (e: any) {
                if (!disposed) setError(e.toString());
            }
        };

        const stopListening = async () => {
            try {
                await Voice.stop();
                await Voice.destroy();
                if (!disposed) setIsListening(false);
            } catch (e: any) {
                console.error('Error stopping voice recognition:', e);
            }
        };

        if (enabled) {
            startListening();
        } else {
            // Turning the feature off clears any stale failure. Without this the
            // error outlives the feature and the UI keeps reporting a fault for
            // something that is no longer running.
            setError(null);
            stopListening();
        }

        return () => {
            disposed = true;
            if (restartTimer) clearTimeout(restartTimer);
            try {
                Voice.destroy().then(Voice.removeAllListeners).catch((e: any) => console.error("Error destroying voice listener", e));
            } catch (e) {
                // ignore
            }
        };
    }, [enabled]);

    return { isListening, error, clearError };
};
