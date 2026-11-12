import appJson from '../app.json';

/** docs/specs/LOCATION.md: foreground only. A background permission is a different promise and review. */
describe('app.json location config', () => {
  const entry = (appJson.expo.plugins as any[]).find((p) => Array.isArray(p) && p[0] === 'expo-location');
  it('configures expo-location with every background option off', () => {
    expect(entry).toBeDefined();
    const o = entry[1];
    expect(o.isIosBackgroundLocationEnabled).toBe(false);
    expect(o.isAndroidBackgroundLocationEnabled).toBe(false);
    expect(o.isAndroidForegroundServiceEnabled).toBe(false);
  });
  it('declares no background location permission or mode', () => {
    const text = JSON.stringify(appJson);
    expect(text).not.toMatch(/ACCESS_BACKGROUND_LOCATION|FOREGROUND_SERVICE_LOCATION|NSLocationAlways(?!AndWhenInUse)|UIBackgroundModes/);
  });
  it('the permission text says nothing is shared', () => {
    expect(entry[1].locationAlwaysAndWhenInUsePermission).toMatch(/Nothing is shared/);
  });
});
