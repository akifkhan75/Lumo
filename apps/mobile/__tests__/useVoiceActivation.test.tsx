import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { NativeModules } from 'react-native';
import { useVoiceActivation } from '../hooks/useVoiceActivation';

function VoiceHookWrapper({
  onActivate,
  enabled,
  onState,
}: {
  onActivate: () => void;
  enabled: boolean;
  onState?: (state: {
    isListening: boolean;
    error: string | null;
    clearError: () => void;
  }) => void;
}) {
  const result = useVoiceActivation(onActivate, enabled);
  if (onState) onState(result);
  return null;
}

describe('useVoiceActivation', () => {
  let mockVoice: any;

  beforeEach(() => {
    jest.clearAllMocks();
    const imported = require('@react-native-voice/voice');
    mockVoice = imported.default || imported;
    NativeModules.Voice = {};
  });

  afterEach(() => {
    delete NativeModules.Voice;
  });

  it('handles fallback when NativeModules.Voice is not available', async () => {
    delete NativeModules.Voice;
    const onActivate = jest.fn();
    let state: any;

    await act(async () => {
      renderer.create(
        <VoiceHookWrapper onActivate={onActivate} enabled={true} onState={(s) => (state = s)} />
      );
      await Promise.resolve();
    });

    expect(state.isListening).toBe(false);
  });

  it('starts listening and triggers on wake phrase', async () => {
    const onActivate = jest.fn();
    let root: any;

    await act(async () => {
      root = renderer.create(<VoiceHookWrapper onActivate={onActivate} enabled={true} />);
      await Promise.resolve();
    });

    expect(mockVoice.start).toHaveBeenCalledWith('en-US');

    // Trigger onSpeechResults with non-matching phrase
    act(() => {
      mockVoice.onSpeechResults({ value: ['hello there world'] });
    });
    expect(onActivate).not.toHaveBeenCalled();

    // Trigger onSpeechResults with wake phrase
    act(() => {
      mockVoice.onSpeechResults({ value: ['hey lumo emergency'] });
    });
    expect(onActivate).toHaveBeenCalledTimes(1);

    // Trigger onSpeechError
    act(() => {
      mockVoice.onSpeechError({ error: { message: 'Microphone busy' } });
    });

    // Unmount
    act(() => {
      root.unmount();
    });
    expect(mockVoice.destroy).toHaveBeenCalled();
  });

  it('stops listening when enabled is false', async () => {
    const onActivate = jest.fn();
    await act(async () => {
      renderer.create(<VoiceHookWrapper onActivate={onActivate} enabled={false} />);
      await Promise.resolve();
    });

    expect(mockVoice.stop).toHaveBeenCalled();
  });

  // Regression: KI-16. The caller rebuilds onActivate whenever user settings
  // change. If that identity is a dependency of the hook's effect, every
  // settings save tears the recognizer down and brings it back up, leaving a
  // window with no hands-free trigger at all.
  it('does not restart the recognizer when only the onActivate identity changes', async () => {
    let root: any;

    await act(async () => {
      root = renderer.create(<VoiceHookWrapper onActivate={() => {}} enabled={true} />);
      await Promise.resolve();
    });

    expect(mockVoice.start).toHaveBeenCalledTimes(1);
    const destroysAfterStart = mockVoice.destroy.mock.calls.length;

    await act(async () => {
      root.update(<VoiceHookWrapper onActivate={() => {}} enabled={true} />);
      await Promise.resolve();
    });

    expect(mockVoice.start).toHaveBeenCalledTimes(1);
    expect(mockVoice.destroy).toHaveBeenCalledTimes(destroysAfterStart);

    // The latest callback is still the one that fires.
    const latest = jest.fn();
    await act(async () => {
      root.update(<VoiceHookWrapper onActivate={latest} enabled={true} />);
      await Promise.resolve();
    });
    act(() => {
      mockVoice.onSpeechResults({ value: ['hey lumo emergency'] });
    });
    expect(latest).toHaveBeenCalledTimes(1);
  });

  // Regression: KI-16. A sticky error outlived the feature, so the screen that
  // reacts to it alerted and re-disabled voice on every single render.
  it('clears the error when the feature is turned off', async () => {
    let root: any;
    let state: any;

    await act(async () => {
      root = renderer.create(
        <VoiceHookWrapper onActivate={() => {}} enabled={true} onState={s => (state = s)} />
      );
      await Promise.resolve();
    });

    act(() => {
      mockVoice.onSpeechError({ error: { message: 'Microphone busy' } });
    });
    expect(state.error).toBe('Microphone busy');

    await act(async () => {
      root.update(
        <VoiceHookWrapper onActivate={() => {}} enabled={false} onState={s => (state = s)} />
      );
      await Promise.resolve();
    });

    expect(state.error).toBeNull();
  });

  it('exposes clearError so a handled failure is not re-reported', async () => {
    let state: any;

    await act(async () => {
      renderer.create(
        <VoiceHookWrapper onActivate={() => {}} enabled={true} onState={s => (state = s)} />
      );
      await Promise.resolve();
    });

    act(() => {
      mockVoice.onSpeechError({ error: { message: 'Microphone busy' } });
    });
    expect(state.error).toBe('Microphone busy');

    act(() => {
      state.clearError();
    });
    expect(state.error).toBeNull();
  });
});
