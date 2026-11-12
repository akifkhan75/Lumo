# Architecture

> **Two architectures are described here.** §1–2 is the **target**, which the
> specification suite assumes. §3 onward documents **what exists today**, which is a
> two-app monorepo with no durable queue and no shared domain package.
> Decisions: [ADR-0008](../adr/0008-three-state-machines.md) ·
> [ADR-0009](../adr/0009-shared-safety-domain.md) ·
> [ADR-0014](../adr/0014-modular-monolith.md).

## 1. Target architecture

```
                  LUMO CLIENTS
        mobile (Expo)          web (Next.js)
              │                      │  tokenised journey page
    ┌─────────┴─────────┐            │  (expiring, revocable)
    │  Local Safety     │            │
    │  Engine           │            │
    │  · session state  │            │
    │  · local timers   │            │
    │  · offline queue  │            │
    │  · emergency token│            │
    └─────────┬─────────┘            │
              │   imports            │
      ┌───────▼────────────────┐     │
      │ packages/safety-domain │◄────┤  same pure logic, both sides
      │ 3 state machines       │     │
      │ escalation rules       │     │
      │ decision engine        │     │
      │ idempotency keys       │     │
      └───────┬────────────────┘     │
              │  HTTPS + emergency token
              ▼                      ▼
        ┌──────────────────────────────────┐
        │     NestJS modular monolith      │
        │  safety-sessions · incidents ·   │
        │  escalation · notifications ·    │
        │  location · evidence · ai-safety │
        └───┬───────────────┬──────────────┘
            │               │
      PostgreSQL      Durable queue
            │               ├─ notification attempts + retries
            │               ├─ evidence processing
            │               └─ AI jobs (never on the SOS path)
            │               │
            │        ┌──────┴──────┬─────────────┐
            │     Push          SMS/Voice   Object storage
            │     (FCM/APNs)   (provider)   (encrypted)
            │               │
            └───────────────┴──► Delivery Ledger (per attempt, per channel)
```

### Two rules this diagram enforces

1. **The SOS path never waits** on a queue, an AI job, or an evidence upload.
2. **The local engine never claims remote delivery.** It owns timers and offline
   state; the backend owns alerts, access control and the audit record.

### Why `safety-domain` is shared

The phone must keep timers when offline; the backend must coordinate alerts and own
the audit trail. If each implemented escalation independently they would eventually
**disagree about whether an escalation fired** — and in a safety product that
disagreement is the bug that gets someone hurt. One pure, dependency-free,
100%-branch-covered implementation, imported unchanged by both, makes divergence
impossible (PLAT-7).

## 2. Module growth — incremental, never empty shells

This repo has already shipped three empty packages; that will not repeat.

| Phase | Modules added                                                                                                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | _(no new modules — fixes, specs, `danger-zones` → `hazard-reports`)_                                                                                                                            |
| 1     | `trusted-contacts` `safety-circles` `safety-sessions` `journeys` `emergency-incidents` `escalation` `location` `notifications` `audit` · packages `safety-domain` `region-profiles` · app `web` |
| 2     | `evidence`                                                                                                                                                                                      |
| 3     | `ai-safety` `accident-detection`                                                                                                                                                                |
| 4     | `safety-places` `community` `organizations`                                                                                                                                                     |
| 5     | `wearables` `subscriptions` `admin`                                                                                                                                                             |

`settings` folds into `users`. The empty `config`, `validation` and `eslint-config`
packages are deleted in Phase 0.

### Module boundaries that matter

- **`ai-safety` may not send a notification.** It emits a `SafetySignal` the decision
  engine evaluates ([ADR-0013](../adr/0013-ai-never-decides.md)).
- **`notifications` may not decide** whether a missed check-in is an emergency. It
  delivers what `escalation` asked for and reports the result.

That separation is what makes the system testable and accountable.

### Extraction criteria

A module leaves the monolith only for: materially different scaling · a genuine
fault-isolation requirement · an independent release cadence · a specialised runtime ·
a clear ownership boundary. Likely first candidates: **notification delivery** and
**media processing**. Auth and CRUD do not qualify.

---

## 3. Current architecture (as built)

### Overview

A three-tier system in a single Turborepo monorepo:

```
┌─────────────────────────────────────────────────────────────┐
│  apps/mobile — Expo 58 / React Native 0.88                  │
│                                                             │
│  Screens (components/*.tsx, styled-components/native)        │
│      │                                                      │
│      ├── hooks/        useShakeDetector, useVoiceActivation, │
│      │                 useAccidentDetector  (expo-sensors,   │
│      │                 @react-native-voice/voice)            │
│      │                                                      │
│      └── services/apiService.ts   ← the only network door    │
│                     │                                       │
└─────────────────────┼───────────────────────────────────────┘
                      │  imports
          ┌───────────▼─────────────┐   ┌──────────────────────┐
          │ @lumo/api-client │──▶│ @lumo/types   │
          │   class ApiClient       │   │  domain types        │
          └───────────┬─────────────┘   └──────────▲───────────┘
                      │ HTTP + Bearer JWT          │
┌─────────────────────▼────────────────────────────┼───────────┐
│  apps/api — NestJS 12                            │           │
│                                                  │ imports   │
│  AppModule                                       │           │
│   ├── AuthModule        /api/v1/auth    ──────────┘          │
│   ├── SettingsModule    /api/v1/settings      (JwtAuthGuard) │
│   ├── DangerZonesModule /api/v1/danger-zones  (JwtAuthGuard) │
│   ├── AiModule          /api/v1/ai            (JwtAuthGuard) │
│   └── PrismaModule      PrismaService (global)               │
└─────────────────────┬───────────────────────────────────────┘
                      │ Prisma 5.22
          ┌───────────▼─────────────┐      ┌─────────────────┐
          │  PostgreSQL 15          │      │ Google Gemini   │
          │  (Docker, host :5434)   │      │ @google/genai   │
          └─────────────────────────┘      └─────────────────┘
```

Both arrows out of the API are optional-by-design on the AI side: every Gemini
call has a local fallback, so the app works with no API key.

---

## 2. Why a monorepo

The mobile app and the API share a domain vocabulary (`UserSettings`,
`DangerZone`, `FakeCallScript`) and a wire contract. Keeping them in one repo with
shared packages means a type change breaks the build at compile time instead of at
runtime on a user's phone.

Turborepo provides the task graph; pnpm workspaces provide the linking.

```
turbo.json
  build     dependsOn ^build   outputs dist/**, .next/**
  lint      dependsOn ^build
  typecheck dependsOn ^build
  test      dependsOn ^build
  dev       cache: false, persistent
```

`^build` means "build my dependencies first", which is what forces
`types → api-client → apps`. `@lumo/api-client` resolves via
`main: "dist/index.js"`, so **the mobile app consumes compiled output, not
source** — a fresh clone needs `pnpm build` before `pnpm --filter mobile start`.

---

## 3. Workspace inventory

| Package               | Purpose                                     | State  |
| --------------------- | ------------------------------------------- | ------ |
| `apps/api`            | NestJS REST API                             | Active |
| `apps/mobile`         | React Native app                            | Active |
| `packages/types`      | Shared domain types, no runtime code        | Active |
| `packages/api-client` | `ApiClient` class — one method per endpoint | Active |
| `packages/tsconfig`   | `base.json` extended by the others          | Active |

`packages/config`, `packages/validation` and `packages/eslint-config` were
empty placeholder directories from the migration plan and were deleted in
Phase 0 (KI-13). New packages are created when something goes in them.

---

## 4. Backend

### Module layout

Domain-sliced, one folder each. Every module gets `*.module.ts`,
`*.controller.ts`, `*.service.ts`, and co-located `*.spec.ts`.

| Module              | Routes                                                                          | Guarded         | Notes                                                                |
| ------------------- | ------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------- |
| `AuthModule`        | `POST /api/v1/auth/login`, `/signup`                                            | No (public)     | argon2 + `@nestjs/jwt`, 7-day expiry                                 |
| `SettingsModule`    | `GET`/`PUT /api/v1/settings`                                                    | Yes             | Assembles a composite settings object from `User` + `TrustedContact` |
| `DangerZonesModule` | `GET`/`POST /api/v1/danger-zones`                                               | Yes             | Maps enum ↔ display strings, synthesises coordinates                 |
| `AiModule`          | `GET /ai/fake-call-script`, `GET /ai/self-defense-tips`, `POST /ai/safety-chat` | Yes (per-route) | Gemini with local fallbacks                                          |
| `PrismaModule`      | —                                                                               | —               | Exports a `@Global()` `PrismaService`                                |

`AppController` serves `GET /` as a health/hello string.

### Cross-cutting setup

All of it lives in `apps/api/src/main.ts` — there is no interceptor, filter or
middleware layer yet:

```ts
app.enableCors(); // wide open
app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
await app.listen(process.env.API_PORT || 3001, "0.0.0.0");
```

`whitelist: true` **strips any body property without a validation decorator**.
That is the most common cause of "my field disappeared" in this codebase.

There is deliberately **no** global route prefix: each controller spells out
`api/v1/...` itself. Keep doing that, or change all four at once.

### Auth chain

```
POST /auth/login
  → AuthService.login: findUnique by email → argon2.verify
  → jwtService.sign({ email, sub: user.id })   // secret from env, 7d
  → { token, user: { id, email, fullName } }

Protected request
  → JwtAuthGuard (passport 'jwt')
  → JwtStrategy: Bearer header → verify → validate(payload)
  → req.user = { id: payload.sub, email: payload.email }
```

Services take `userId` as their first argument and scope every query by it.
There are no roles and no per-resource authorization beyond that.

### Design decisions worth knowing

- **Services return API shapes, not Prisma rows.** `DangerZonesService.findAll`
  folds `top`/`left` into `{ location: { top, left } }` and converts the enum to
  its display string. `SettingsService.getSettings` composes
  `{ personalInfo, trustedContacts, security }` out of one flat `User` row. The
  response shape is a deliberate contract, not an ORM leak.
- **AI never fails hard.** Each method defines its fallback _first_, returns it if
  `aiClient` is null, and returns it again on a parse error or exception.
  `parseJsonResponse` strips markdown code fences before parsing. Keep this
  property — a safety feature must not depend on a reachable LLM.
- **Settings are flat in the database, nested in the API.** The six security
  booleans are columns on `User`, not a separate table.

---

## 5. Mobile

### Navigation

Two native stacks, no tab navigator. Authentication is a **conditional branch of
the root navigator**, so logging out unmounts the entire authenticated tree.

```
NavigationContainer
└── MainStack (headerShown: false)
    ├── isAuthenticated === false
    │   └── Auth                     AuthScreen (onboarding → login/signup)
    └── isAuthenticated === true
        ├── Dashboard                map + header + bottom nav + SOS
        ├── Group { presentation: 'modal' }
        │   ├── Settings             → SettingsStack
        │   │   ├── SettingsRoot
        │   │   ├── ProfileSettings
        │   │   ├── ContactSettings
        │   │   └── AlertSettings
        │   ├── CommunitySafety
        │   ├── FollowMe
        │   ├── CheckIn
        │   ├── FakeCall
        │   ├── ReportDangerZone
        │   └── SafetyAssistant
        └── Group { presentation: 'fullScreenModal' }
            └── Emergency            the SOS screen
```

### State model

**There is no state manager.** `DashboardScreen` is the single owner of
`userSettings` and `dangerZones`; it fetches both in parallel on mount and passes
state _and mutators_ down through route params:

```ts
navigation.navigate("Settings", {
  onLogout,
  currentSettings: userSettings,
  onSave: handleSaveSettings,
});
navigation.navigate("ReportDangerZone", { onReport: handleAddDangerZone });
navigation.navigate("CheckIn", { onEmergency: handleActivateEmergency });
```

Passing functions as params is non-serializable and trips React Navigation's
warnings, and it means deep links cannot reach these screens. It is accepted here
for a small app. **Either preserve it or replace it wholesale** — a half-migration
to Context with params still in place is the worst outcome. See ADR
[0004](../adr/0004-route-params-as-state-transport.md).

### Sensor hooks

All three share a contract: `(callback, enabled) => …`, subscribe only when
`enabled`, and remove the subscription on unmount or when disabled.

| Hook                  | Source                               | Trigger                                                                                                             |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `useShakeDetector`    | `expo-sensors` Accelerometer, 100 ms | magnitude > **2.5 G**, 800 ms debounce                                                                              |
| `useAccidentDetector` | same sensor, 100 ms                  | magnitude > **6.0 G**, 1000 ms debounce                                                                             |
| `useVoiceActivation`  | `@react-native-voice/voice`          | utterance contains a brand variant (`lumo`, `loomo`, `luma`, …) **and** an intent word (`emergency`, `help`, `sos`) |

Notes:

- Both accelerometer hooks subscribe **independently** to the same sensor when
  both settings are on — two listeners, two magnitude computations. Worth merging.
- `useVoiceActivation` checks `NativeModules.Voice` and no-ops in Expo Go rather
  than crashing, then restarts itself on `onSpeechEnd` for continuous listening.
  Errors bubble up to `DashboardScreen`, which alerts the user **and writes the
  setting back to `false`**.
- The wake word is **"Hey Lumo"**. Because `Lumo` is a coined word, the matcher
  accepts phonetic variants across _all_ recognizer alternatives rather than one
  literal phrase — see [MOBILE.md](MOBILE.md) and [ADR-0007](../adr/0007-name-the-product-lumo.md).

### Styling

`styled-components/native`, declared at the top of each component file. The
dashboard's styles are the exception, extracted to `App.styled.ts`. Icons are
wrapped in `constants.tsx` so `@expo/vector-icons` is imported in exactly one
place.

---

## 6. Data flow: reporting a danger zone

Traced end to end, because it shows every layer and every quirk:

```
1. User taps the alert icon in the dashboard header
2. navigate('ReportDangerZone', { onReport: handleAddDangerZone })
3. ReportDangerZoneModal collects { type, severity, description }
4. onReport(details) → apiService.reportDangerZone
5. ApiClient.reportDangerZone → POST /api/v1/danger-zones, Bearer JWT
6. JwtAuthGuard → req.user = { id, email }
7. Controller INVENTS coordinates:  top = `${48 + Math.random()*4}%`
8. Service mapInputType('Suspicious Activity') → enum Suspicious_Activity
9. Prisma INSERT; Postgres stores the @map'd value "Suspicious Activity"
10. Service maps back out to { id, location: { top, left }, type: 'Suspicious Activity', … }
11. Dashboard appends to dangerZones; a DangerZonePin renders at that %
12. navigation.goBack(), then a thank-you Alert after 300 ms
```

Step 7 is [KI-2](../audit/KNOWN_ISSUES.md) — the report is not placed where the user is.

---

## 7. Known architectural gaps

Summarized here, detailed in [KNOWN_ISSUES.md](../audit/KNOWN_ISSUES.md):

| Gap                                                | Impact                                          |
| -------------------------------------------------- | ----------------------------------------------- |
| No real geospatial model (percentages over a JPEG) | Blocks maps, proximity alerts, nearby-help      |
| SOS performs no outbound notification              | The core promise is unimplemented               |
| No session persistence                             | Logged out on every cold start                  |
| Hardcoded LAN IP as the API base                   | Not shippable                                   |
| No migrations, no CI, no API container             | Not deployable                                  |
| No real-time transport (no WebSocket/push)         | Follow Me and community features cannot be real |
| No offline queue                                   | An emergency in a dead zone is lost             |

The last two are the architectural work that the roadmap's Phase 2 depends on —
see [ROADMAP.md](../product/ROADMAP.md).
