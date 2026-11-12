import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Accelerometer } from 'expo-sensors';
import { useShakeDetector } from '../hooks/useShakeDetector';

function HookWrapper({
  onShake,
  enabled = true,
  options,
}: {
  onShake: () => void;
  enabled?: boolean;
  options?: { threshold?: number; timeout?: number };
}) {
  useShakeDetector(onShake, enabled, options);
  return null;
}

describe('useShakeDetector', () => {
  let listenerCallback: (data: { x: number; y: number; z: number }) => void;
  const mockRemove = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (Accelerometer.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    (Accelerometer.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Accelerometer.addListener as jest.Mock).mockImplementation((cb) => {
      listenerCallback = cb;
      return { remove: mockRemove };
    });
  });

  it('subscribes to Accelerometer and handles shake event above threshold', async () => {
    const onShake = jest.fn();
    let root: any;

    await act(async () => {
      root = renderer.create(
        <HookWrapper onShake={onShake} enabled={true} options={{ threshold: 2.0, timeout: 500 }} />
      );
      await Promise.resolve();
    });

    expect(Accelerometer.setUpdateInterval).toHaveBeenCalledWith(100);
    expect(Accelerometer.addListener).toHaveBeenCalled();

    // Trigger below threshold: magnitude = sqrt(1^2 + 0 + 0) = 1.0 < 2.0
    act(() => {
      listenerCallback({ x: 1.0, y: 0, z: 0 });
    });
    expect(onShake).not.toHaveBeenCalled();

    // Trigger above threshold: magnitude = sqrt(2^2 + 2^2 + 0) = 2.82 > 2.0
    act(() => {
      listenerCallback({ x: 2.0, y: 2.0, z: 0 });
    });
    expect(onShake).toHaveBeenCalledTimes(1);

    // Trigger within timeout period (500ms): should be debounced
    act(() => {
      listenerCallback({ x: 2.0, y: 2.0, z: 0 });
    });
    expect(onShake).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
    expect(mockRemove).toHaveBeenCalled();
  });

  it('does not subscribe when enabled is false', async () => {
    const onShake = jest.fn();
    await act(async () => {
      renderer.create(<HookWrapper onShake={onShake} enabled={false} />);
      await Promise.resolve();
    });

    expect(Accelerometer.addListener).not.toHaveBeenCalled();
  });

  it('handles sensor unavailable gracefully', async () => {
    (Accelerometer.isAvailableAsync as jest.Mock).mockResolvedValue(false);
    const onShake = jest.fn();
    await act(async () => {
      renderer.create(<HookWrapper onShake={onShake} enabled={true} />);
      await Promise.resolve();
    });

    expect(Accelerometer.addListener).not.toHaveBeenCalled();
  });

  it('requests permission if not granted', async () => {
    (Accelerometer.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
    (Accelerometer.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    const onShake = jest.fn();
    await act(async () => {
      renderer.create(<HookWrapper onShake={onShake} enabled={true} />);
      await Promise.resolve();
    });

    expect(Accelerometer.requestPermissionsAsync).toHaveBeenCalled();
    expect(Accelerometer.addListener).toHaveBeenCalled();
  });

  // Regression: KI-20. handleActivateEmergency is rebuilt on every settings
  // save. If the subscription is keyed on its identity, a detector that is
  // meant to be always on gets torn down and restarted by unrelated state.
  it('keeps one subscription when only the callback identity changes', async () => {
    let root: any;

    await act(async () => {
      root = renderer.create(<HookWrapper onShake={() => {}} enabled={true} />);
      await Promise.resolve();
    });

    expect(Accelerometer.addListener).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.update(<HookWrapper onShake={() => {}} enabled={true} />);
      await Promise.resolve();
    });

    expect(Accelerometer.addListener).toHaveBeenCalledTimes(1);
    expect(mockRemove).not.toHaveBeenCalled();

    // The newest callback is still the one that fires.
    const latest = jest.fn();
    await act(async () => {
      root.update(<HookWrapper onShake={latest} enabled={true} />);
      await Promise.resolve();
    });
    act(() => {
      listenerCallback({ x: 3.0, y: 3.0, z: 0 });
    });
    expect(latest).toHaveBeenCalledTimes(1);
  });
});
