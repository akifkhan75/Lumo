# Mobile App Guide

`apps/mobile` — Expo 58 / React Native 0.88 / React 19.3, TypeScript,
`styled-components/native`, React Navigation 7.

---

## File map

```
apps/mobile/
├── index.js                  registerRootComponent entry
├── App.tsx                   root navigator + DashboardScreen
├── App.styled.ts             dashboard styles (the only extracted stylesheet)
├── types.ts                  domain types (duplicated) + navigation param lists
├── constants.tsx             all icon wrappers — the only @expo/vector-icons import
├── app.json                  Expo config: name, slug, permissions, plugins
├── metro.config.js           monorepo resolution (do not simplify)
├── jest.config.js / jest-setup.js
│
├── services/
│   └── apiService.ts         the only network door
├── hooks/
│   ├── useShakeDetector.ts
│   ├── useVoiceActivation.ts
│   └── useAccidentDetector.ts
├── components/
│   ├── auth/                 AuthScreen, Login, Signup
│   ├── common/               Input
│   ├── settings/             SettingsModal, Profile/Contact/AlertSettings, SettingsHeader
│   ├── EmergencyModal.tsx    the SOS screen
│   ├── FakeCallScreen.tsx
│   ├── FollowMeModal.tsx
│   ├── CheckInModal.tsx
│   ├── CommunitySafetyModal.tsx
│   ├── ReportHazardModal.tsx
│   └── SafetyAssistantModal.tsx
├── assets/images/            map_bg.jpg, user_avatar.jpg
└── android/                  the real native project (not /android at the repo root)
```

Files named `*Modal.tsx` are **navigator screens** presented modally, not
`<Modal>` components. The names are a leftover from a pre-navigation version.

---

## Navigation

```
NavigationContainer
└── MainStack  (createNativeStackNavigator, headerShown: false)
    │
    ├── NOT authenticated
    │   └── Auth                    AuthScreen  (onboarding → login/signup tabs)
    │
    └── authenticated
        ├── Dashboard               params: { onLogout }
        │
        ├── Group  presentation: 'modal'
        │   ├── Settings            → SettingsStack (nested native stack)
        │   │     SettingsRoot → ProfileSettings | ContactSettings | AlertSettings
        │   ├── CommunitySafety
        │   ├── FollowMe
        │   ├── CheckIn             params: { onEmergency }
        │   ├── FakeCall
        │   ├── ReportHazard        params: none
        │   └── SafetyAssistant
        │
        └── Group  presentation: 'fullScreenModal'
            └── Emergency           params: { settings }
```

Auth is a **conditional branch of the navigator**, so `handleLogout()` unmounts
every authenticated screen — no manual reset needed, and no authenticated state
can survive a logout in memory except the token itself
([KI-4](../audit/KNOWN_ISSUES.md)).

Param lists are typed in `types.ts` as `RootStackParamList` and
`SettingsStackParamList`. Keep them current — they are the only compile-time check
on navigation.

---

## State: one owner, params as the bus

There is **no Redux, no Zustand, no Context**. `DashboardScreen` owns everything:

```ts
const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
const [isLoading, setIsLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

// mount
const settings = await apiService.getSettings();
```

The dashboard no longer fetches hazard reports. It cannot draw them — the "map" is
a JPEG and reports carry real coordinates, so there is no projection between the
two — so the screen that lists them (`CommunitySafetyModal`) fetches them itself.

and hands state plus mutators to children through route params:

| Screen         | Params                                  |
| -------------- | --------------------------------------- |
| `Settings`     | `{ onLogout, currentSettings, onSave }` |
| `ReportHazard` | none                                    |
| `CheckIn`      | `{ onEmergency }`                       |
| `Emergency`    | `{ settings }`                          |

The settings sub-stack re-passes `currentSettings` / `onSave` to each leaf via
`initialParams`.

**Trade-offs, stated plainly:** functions in params are non-serializable, so React
Navigation warns, state persistence is impossible, and deep links cannot open
these screens. `initialParams` also means a leaf screen holds a _snapshot_ —
`ProfileSettings` will not see a change made in `ContactSettings` without a
remount. It is acceptable at this size.

If you outgrow it, replace it **completely** (one `SettingsContext` + a
`useHazardReports` hook, params reduced to ids). A half-migration with both patterns
live is worse than either. See [ADR-0004](../adr/0004-route-params-as-state-transport.md).

---

## Networking

```
component → services/apiService.ts → ApiClient (@lumo/api-client) → HTTP
```

`apiService.ts` is a thin façade: a module-level `ApiClient` instance, a
module-level `currentToken`, and one wrapper per endpoint. **Never call `fetch`
from a component.**

Two irregularities to be aware of:

- `login` and `signup` use **raw `fetch`** instead of `apiClient.login` /
  `.signup`, duplicating that logic and swallowing the server's error message
  (`throw new Error('HTTP error')`). There is also a leftover
  `console.log('resp', response)`. ([KI-10](../audit/KNOWN_ISSUES.md))
- `setAuthToken` writes both `currentToken` and `apiClient.setToken`, but
  `handleLogout` in `App.tsx` never calls it — the token outlives the session.

---

## Sensor hooks

A shared contract: `(callback, enabled)`, subscribe only while `enabled`, always
clean up.

### `useShakeDetector(onShake, enabled, options?)`

`expo-sensors` Accelerometer at 100 ms. Fires when
`√(x²+y²+z²) > threshold` (default **2.5 G**) with an 800 ms debounce. Checks
availability and permissions first and, on a permission error, assumes granted —
most devices need no runtime permission for the accelerometer. Returns
`{ isActive, hasPermission, checkPermissions, startDetection, stopDetection }`.

### `useAccidentDetector(onDetect, enabled)`

Same sensor, threshold **6.0 G** (~crash impact), 1000 ms debounce. Returns nothing.

> Both hooks subscribe to the accelerometer **independently**. With shake _and_
> accident detection on, there are two listeners computing the same magnitude at
> the same rate. Merging them into one subscription with two thresholds is an easy
> battery win.

### `useVoiceActivation(onActivate, enabled)`

`@react-native-voice/voice`. Wake phrases:

```
brand variant  ["lumo", "loomo", "luma", "lou mo", "loom o"]
      +  intent word  ["emergency", "help", "sos"]   in the same utterance
```

- Guards on `NativeModules.Voice` and no-ops in Expo Go (logs, does not throw).
- `require`s the module lazily inside the effect so a missing native module
  surfaces as an error state, not a bundling crash.
- Restarts itself 500 ms after `onSpeechEnd` for continuous listening.
- Returns `{ isListening, error }`. `isListening` drives the "Voice Guard Active"
  badge in the dashboard header.
- On error, `DashboardScreen` alerts the user **and persists
  `voiceActivationEnabled: false`** so a broken sensor cannot loop.

**Why variants, not one phrase:** `Lumo` is a coined word, so speech-to-text
transcribes it inconsistently. A single literal match would silently disable
hands-free SOS for most users. The matcher also scans **every** alternative the
recognizer returns, since a coined word is often ranked second or third.
High-collision homophones (`limo`, `lumen`) are deliberately excluded.

> The variant list is **unvalidated** — a starting point, not a measurement. It must
> be tuned against real on-device transcripts before launch: a wake word that fails
> to fire is a safety defect, and one that over-fires causes alert fatigue. Tracked
> in Phase 4 of [ROADMAP.md](../product/ROADMAP.md).

---

## Styling and icons

Styles are `styled-components/native` declared at the top of the component file
that uses them. The dashboard is the exception (`App.styled.ts`).

The informal palette, as used across the screens:

| Role                      | Hex                             |
| ------------------------- | ------------------------------- |
| Primary action            | `#4f46e5` indigo                |
| Emergency / high severity | `#dc2626` / `#ef4444`           |
| Medium severity, warning  | `#f59e0b`                       |
| Low severity, info        | `#3b82f6`                       |
| Success / active          | `#16a34a`                       |
| Body text                 | `#1f2937`, `#4b5563`, `#374151` |
| Surfaces                  | `#ffffff`, `#f3f4f6`, `#e5e7eb` |

These are Tailwind values, inherited from the web original — there is no design
token file. Extracting one is a prerequisite for the dark mode the roadmap wants
(`userInterfaceStyle` is currently pinned to `light` in `app.json`).

Icons: add to `constants.tsx` as `Icon<Name>` wrappers. Nothing else should import
`@expo/vector-icons`.

---

## Screen notes

| Screen                 | What it really does                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AuthScreen`           | Onboarding → login/signup tabs. **Prefills `josim@example.com` / `password`.** Calls `apiService.login`/`signup`, then `onLoginSuccess()`.                                                                         |
| `DashboardScreen`      | Static JPEG "map" with a demo notice over it and no pins, header with the user's name and a plain statement that Lumo cannot read the user's position, bottom nav, SOS, AI button.                                 |
| `EmergencyModal`       | **UI only — contacts nobody.** Hardcoded contact ring, "Notifying Nearby Volunteers…", a defense-mode overlay that _does_ fetch real AI tips. `isRecording` is a `const false`. ([KI-3](../audit/KNOWN_ISSUES.md)) |
| `FakeCallScreen`       | Real: fetches a script from the AI endpoint and plays it as an incoming call.                                                                                                                                      |
| `SafetyAssistantModal` | Real: chats against `POST /ai/safety-chat` (history is dropped server-side, [KI-14](../audit/KNOWN_ISSUES.md)).                                                                                                    |
| `ReportHazardModal`    | **Unavailable, and says so.** A hazard report needs real coordinates and the device cannot read its position, so the form is gone rather than submitting a guessed point.                                          |
| `CheckInModal`         | Timer works and calls `onEmergency()` at zero — but in-process only, so backgrounding or killing the app cancels the escalation.                                                                                   |
| `FollowMeModal`        | Mock: `shareLink` is a hardcoded constant; nothing is shared.                                                                                                                                                      |
| `CommunitySafetyModal` | Mock: Safe Walk request status is local `useState`.                                                                                                                                                                |
| `settings/*`           | Real: reads `currentSettings`, calls `onSave` → `PUT /settings`.                                                                                                                                                   |

---

## Conventions for new work

1. A new screen goes in `components/`, is registered in the right `MainStack.Group`,
   and gets an entry in `RootStackParamList`.
2. A new endpoint goes into `ApiClient` first, then a wrapper in `apiService.ts`.
3. A new native capability needs: the dependency, a permission in `app.json`, a
   mock in `jest-setup.js`, and a graceful-degradation path for Expo Go.
4. Sensor logic goes in a `hooks/` hook with the `(callback, enabled)` shape and a
   cleanup return — never inline in a component.
5. New icons go in `constants.tsx`.
6. Add `accessibilityLabel` / `accessibilityRole` to anything tappable. Nothing in
   the app has them today ([KI-15](../audit/KNOWN_ISSUES.md)) and this app will be used
   under stress, one-handed, in the dark.
