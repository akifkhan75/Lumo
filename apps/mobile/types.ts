// Shared domain types live in @lumo/types and are re-exported here so that
// mobile code can keep importing from a single local module. They were
// previously duplicated verbatim in this file (KI-6): two copies of the same
// contract that the compiler had no way to keep in step, so the client and the
// server could drift apart silently.
//
// Only types that are genuinely mobile-specific — the navigation parameter
// lists — are declared here.
export * from '@lumo/types';

import type { UserSettings } from '@lumo/types';

export type RootStackParamList = {
  Auth: undefined;
  Dashboard: { onLogout: () => void; };
  Settings: { onLogout: () => void; currentSettings: UserSettings; onSave: (settings: UserSettings) => Promise<void>; };
  CommunitySafety: undefined;
  FollowMe: undefined;
  CheckIn: { onEmergency: () => void; };
  FakeCall: undefined;
  // Takes no callback: reporting a hazard needs a real position and Lumo
  // cannot read one yet, so the screen explains that instead of submitting.
  ReportHazard: undefined;
  SafetyAssistant: undefined;
  Emergency: { settings: UserSettings; };
};

export type SettingsStackParamList = {
    SettingsRoot: { onLogout: () => void; currentSettings: UserSettings; onSave: (settings: UserSettings) => Promise<void>; };
    ProfileSettings: { currentSettings: UserSettings; onSave: (settings: UserSettings) => Promise<void>; };
    ContactSettings: { currentSettings: UserSettings; onSave: (settings: UserSettings) => Promise<void>; };
    AlertSettings: { currentSettings: UserSettings; onSave: (settings: UserSettings) => Promise<void>; };
};
