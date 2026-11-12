import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Accelerometer } from 'expo-sensors';
import { useAccidentDetector } from '../hooks/useAccidentDetector';

function AccidentHookWrapper({
  onDetect,
  enabled = true,
}: {
  onDetect: () => void;
  enabled?: boolean;
}) {
  useAccidentDetector(onDetect, enabled);
  return null;
}

describe('useAccidentDetector', () => {
  let listenerCallback: (data: { x: number; y: number; z: number }) => void;
  const mockRemove = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (Accelerometer.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    (Accelerometer.addListener as jest.Mock).mockImplementation((cb) => {
      listenerCallback = cb;
      return { remove: mockRemove };
    });
  });

  it('triggers onDetect on severe shock (> 6G)', async () => {
    const onDetect = jest.fn();
    let root: any;

    await act(async () => {
      root = renderer.create(<AccidentHookWrapper onDetect={onDetect} enabled={true} />);
      await Promise.resolve();
    });

    expect(Accelerometer.setUpdateInterval).toHaveBeenCalledWith(100);
    expect(Accelerometer.addListener).toHaveBeenCalled();

    // Below threshold: sqrt(3^2 + 3^2) = 4.24 < 6.0
    act(() => {
      listenerCallback({ x: 3.0, y: 3.0, z: 0 });
    });
    expect(onDetect).not.toHaveBeenCalled();

    // Above threshold: sqrt(5^2 + 5^2) = 7.07 > 6.0
    act(() => {
      listenerCallback({ x: 5.0, y: 5.0, z: 0 });
    });
    expect(onDetect).toHaveBeenCalledTimes(1);

    // Debounced within timeout (1000ms)
    act(() => {
      listenerCallback({ x: 5.0, y: 5.0, z: 0 });
    });
    expect(onDetect).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
    expect(mockRemove).toHaveBeenCalled();
  });

  it('does not listen when disabled', async () => {
    const onDetect = jest.fn();
    await act(async () => {
      renderer.create(<AccidentHookWrapper onDetect={onDetect} enabled={false} />);
      await Promise.resolve();
    });

    expect(Accelerometer.addListener).not.toHaveBeenCalled();
  });

  it('does not listen when sensor unavailable', async () => {
    (Accelerometer.isAvailableAsync as jest.Mock).mockResolvedValue(false);
    const onDetect = jest.fn();
    await act(async () => {
      renderer.create(<AccidentHookWrapper onDetect={onDetect} enabled={true} />);
      await Promise.resolve();
    });

    expect(Accelerometer.addListener).not.toHaveBeenCalled();
  });

  // Regression: KI-20. See useShakeDetector — same cause, same consequence.
  it('keeps one subscription when only the callback identity changes', async () => {
    let root: any;

    await act(async () => {
      root = renderer.create(<AccidentHookWrapper onDetect={() => {}} enabled={true} />);
      await Promise.resolve();
    });

    expect(Accelerometer.addListener).toHaveBeenCalledTimes(1);

    const latest = jest.fn();
    await act(async () => {
      root.update(<AccidentHookWrapper onDetect={latest} enabled={true} />);
      await Promise.resolve();
    });

    expect(Accelerometer.addListener).toHaveBeenCalledTimes(1);
    expect(mockRemove).not.toHaveBeenCalled();

    act(() => {
      listenerCallback({ x: 7.0, y: 0, z: 0 });
    });
    expect(latest).toHaveBeenCalledTimes(1);
  });
});
