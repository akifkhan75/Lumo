# Known Issues, Gaps & Technical Debt

**Verified against the code on 2026-10-26.** Every entry below was confirmed by
reading the file named, not inferred. This file supersedes any conflicting claim
in [`archive/PRODUCTION_AUDIT.md`](../archive/PRODUCTION_AUDIT.md).

Agents: read this before planning a feature. It is the difference between
building on something real and building on a prototype.

---

## Severity key

|                | Meaning                                                           |
| -------------- | ----------------------------------------------------------------- |
| 🔴 **Blocker** | A user could be harmed, or the feature is fake while looking real |
| 🟠 **High**    | Blocks a release or a whole feature area                          |
| 🟡 **Medium**  | Real debt; costs time on every change                             |
| ⚪ **Low**     | Cleanup                                                           |

---

## 🔴 KI-3 — SOS notifies nobody

> **Partially addressed — 2026-10-27.** Not fixed. The screen no longer claims otherwise — it says "Nothing has been sent" in those words and offers the phone dialler. `scripts/check-no-fake-success.mjs` fails the build if the old copy returns.

**`apps/mobile/components/EmergencyModal.tsx`**

The emergency screen renders "Emergency Calling…", "Notifying your contacts,
emergency services, and sharing your location", a ring of six contacts and
"Notifying Nearby Volunteers…". None of it happens. There is no phone call, no
SMS, no push, no server call, and no location upload. The contacts in the ring
are a hardcoded array (`Police`, `EMS`, `Mom`, `Security`, `Dad`, `Guard`) — not
the user's `trustedContacts`.

`shareLocationOnSos` and `sendSmsOnSos` are stored in Postgres and read by
`SettingsService`, then **never used by anything**.

This is the highest-stakes item in the repo: a user in danger could believe help
is coming. Until it is implemented, the screen should say it is a demo.

**To fix:** a `POST /api/v1/sos` endpoint that records an incident and fans out to
trusted contacts (SMS via a provider, push, and a shareable live-location link),
plus `expo-location` on the client. The geo model it needed is done (KI-2); the
location provider is not.

---

## 🟡 KI-2 — Real coordinates, still no map and no device location

> **Largely resolved — 2026-10-27.** The data model is fixed; two capabilities it
> depends on are not built, and both are now stated in the UI instead of faked.

**`apps/api/prisma/schema.prisma`, `hazard-reports.service.ts`, `App.tsx`**

`DangerZone` is gone, replaced by `HazardReport`
([ADR-0010](../adr/0010-hazard-reports-replace-danger-zones.md)). It stores
`latitude Float` / `longitude Float` with a nullable `accuracyMetres`, a `source`,
an `expiresAt` from a per-type TTL, and confirmations as one uniquely-constrained
row per person — so `confirmationCount` is derived and cannot drift, and a report
below `HAZARD_CONFIRMATION_FLOOR` is marked as influencing nothing. **`severity` is
removed and must not return.** The migration drops the old table and every row in
it, because a CSS percentage the server generated with `Math.random()` carries no
location and cannot be backfilled.

`DangerZonesController.create` used to fabricate the position of every report:

```ts
const top = `${48 + Math.random() * 4}%`;
const left = `${48 + Math.random() * 4}%`;
```

Coordinates are now required, validated and taken from the request.

**What is still missing, and how it reads in the app:**

- **No map SDK.** The dashboard is still `map_bg.jpg` with a demo notice, and
  there is no projection from a coordinate to a pixel on it, so reports are
  **listed** in the Community Hub rather than pinned. Needs `react-native-maps`.
- **No device location**, so submitting a report is **unavailable**: the screen
  says Lumo cannot read the user's position and offers no submit control. Needs
  `expo-location`, which is Phase 1 and also unblocks KI-3.
- **No proximity query.** `GET` is bounded (`take` ≤ 200) but returns reports
  globally, because filtering by distance needs the device's own position too.
- **No moderation.** A report is visible as soon as it is written.

---

## 🔴 KI-1 — The API address is a hardcoded LAN IP

> **Resolved — 2026-10-27.** The base URL comes from `EXPO_PUBLIC_API_URL`, falling back in development to the host serving the JS bundle. The API default port is 3005, matching `.env.example`.

**`apps/mobile/services/apiService.ts:5-6`**

```ts
const LAN_IP = "192.168.100.81";
export const API_BASE_URL = `http://${LAN_IP}:3005`;
```

`EXPO_PUBLIC_API_URL` is defined in `.env.example` and read by nothing. Any new
machine, network or build needs a source edit, and a shipped build points at
someone's home router over plain HTTP.

Compounding it: `apps/api/src/main.ts` defaults `API_PORT` to **3001** while the
client assumes **3005**.

**To fix:** `process.env.EXPO_PUBLIC_API_URL ?? <dev default>`, align the port
default to 3005, and require HTTPS for any non-dev build.

---

## 🟠 KI-4 — Auth state is in memory only

**`apps/mobile/services/apiService.ts`, `apps/mobile/App.tsx`**

The JWT lives in a module-level `let currentToken` and `isAuthenticated` is
`useState(false)` in `App.tsx`. Consequences:

- Every app restart logs the user out — unacceptable for an app you open mid-crisis.
- `handleLogout` flips the boolean but **never calls `setAuthToken(null)`**, so the
  token stays in memory and in the `ApiClient` instance.
- Tokens expire after 7 days (`auth.module.ts`) with no refresh flow and no 401
  handling, so expiry surfaces as a generic "Failed to load application data".
- `AuthScreen.tsx` ships prefilled credentials: `josim@example.com` / `password`.

**To fix:** `expo-secure-store` for the token, a real auth context or restored
session on boot, clear-on-logout, a refresh token, and a 401 interceptor in
`ApiClient`.

---

## 🟠 KI-5 — No Prisma migrations exist

> **Resolved — 2026-10-27.** Baseline migration at `apps/api/prisma/migrations/20261027000000_baseline`, verified against a clean postgres:15 with no drift. CI fails if `schema.prisma` and the migration history disagree.

`apps/api/prisma/` contains only `schema.prisma` and `seed.ts`. There is **no
`migrations/` directory**. The schema has only ever been applied with `db push`,
which means no reviewable history and no safe production deploy path.

`archive/PRODUCTION_AUDIT.md` claims "Database migrations are tracked". It is
wrong.

**To fix:** `prisma migrate dev --name init` against a clean database to baseline,
then migrations only.

---

## 🟠 KI-7 — Settings updates are unvalidated

> **Resolved — 2026-10-27.** `UpdateSettingsDto` validates the body; the contact set is replaced inside one transaction. Omitting `trustedContacts` leaves them alone, `[]` clears them.

**`apps/api/src/settings/settings.controller.ts`**

```ts
async updateSettings(@Request() req: any, @Body() body: any)
```

`body: any` opts out of the global `ValidationPipe` — its own source comment admits
"In a real app we'd validate this with DTOs". Every other endpoint has a DTO.

The service also replaces trusted contacts by **deleting all of them and
recreating** (`deleteMany` then `createMany`), which churns primary keys on every
save and is not transactional — a failure between the two leaves the user with
**zero emergency contacts**. For a safety app that is a real hazard.

**To fix:** `UpdateSettingsDto` with nested validation, and an upsert-by-id inside
`prisma.$transaction`.

---

## 🟠 KI-8 — Three features are UI-only mocks

> **Partially addressed — 2026-10-27.** Not fixed. All three carry a `DemoBanner` saying what does not work.

| Feature               | File                       | What is fake                                                                                                                                                                  |
| --------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Follow Me             | `FollowMeModal.tsx`        | `shareLink` is the constant `https://lumo.example/follow/jS8fD9kL`. No session is created, no location streamed. "Start Sharing" sets local state.                            |
| Community / Safe Walk | `CommunitySafetyModal.tsx` | `requestStatus` is `useState<'idle'\|'pending'\|'accepted'>`; no backend, no other users.                                                                                     |
| Check-In              | `CheckInModal.tsx`         | The countdown is real and _does_ call `onEmergency()` at zero — but that lands on the mock SOS screen (KI-3), and the timer dies with the screen since it is in-process only. |

Fake Call (`FakeCallScreen.tsx`) and the AI assistant are genuinely wired to the
API and are **not** in this list.

---

## 🟡 KI-6 — `packages/types` is duplicated in the mobile app

> **Resolved — 2026-10-27.** `apps/mobile/types.ts` re-exports `@lumo/types` and declares only the navigation parameter lists.

`apps/mobile/types.ts` is a byte-for-byte copy of `packages/types/src/index.ts`
plus `RootStackParamList` / `SettingsStackParamList`. Both are imported across the
app — `apiService.ts` imports from `@lumo/types`, `EmergencyModal.tsx` from
`../types`. They will drift silently.

**To fix:** re-export from the package and keep only the navigation param lists
locally:

```ts
export * from "@lumo/types";
export type RootStackParamList = {/* … */};
```

---

## 🟡 KI-9 — Insecure secret fallbacks

> **Resolved — 2026-10-27.** `getJwtSecret()` is the only accessor and throws when the variable is missing, under 32 characters, or still an example value. `bootstrap()` calls it before the server binds. Verified against the built container.

`JWT_SECRET` falls back to `'super-secret-default-key'` in **two** places
(`auth.module.ts`, `jwt.strategy.ts`). A deploy that forgets the env var ships a
publicly known signing key and every token is forgeable.

`.env.example` also commits a real-looking placeholder,
`"lumo-super-secret-jwt-key-change-in-production"`.

**To fix:** fail fast at boot via `@nestjs/config` with a validated schema; no
fallback.

---

## 🟡 KI-10 — `login`/`signup` bypass the shared client

`apiService.login` and `.signup` use raw `fetch` and duplicate logic that already
exists in `ApiClient.login` / `.signup`. The duplicate also throws a bare
`new Error('HTTP error')`, discarding the server's message (so "User with this
email already exists" never reaches the user), and leaves a
`console.log('resp', response)` in the hot path.

**To fix:** delete both and call `apiClient.login` / `.signup`.

---

## 🟡 KI-11 — No CI, no API container

> **Resolved — 2026-10-27.** Three CI jobs (verify · no-fake-success · migrations) and `apps/api/Dockerfile`, built and smoke-tested.

No `.github/` directory. `docker/` is an empty directory and there is no
`Dockerfile` for the API, despite a `.dockerignore` at the root.
`docs/archive/PROJECT_AUDIT.md` lists "DevOps: Docker, Docker Compose, GitHub
Actions" as delivered; only `docker-compose.yml` (Postgres only) exists.

**To fix:** a GitHub Actions workflow running `pnpm lint typecheck test` on PRs,
and a multi-stage `Dockerfile` for `apps/api`.

---

## 🟡 KI-12 — Dated Gemini model string

`ai.service.ts` pins `gemini-1.5-flash` in three calls. Worth moving to a current
model and lifting the string into config rather than repeating it.

---

## ⚪ KI-13 — Dead files and directories

> **Resolved — 2026-10-27.** `packages/config`, `packages/validation` and `packages/eslint-config` deleted.

| Path                                                               | Status                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `packages/config`, `packages/validation`, `packages/eslint-config` | Empty directories. `ARCHITECTURE.md` claimed `packages/config` was real. |
| `docker/`                                                          | Empty                                                                    |
| `/android/` (repo root)                                            | Stray Gradle output; the real project is `apps/mobile/android/`          |
| `metadata.json`                                                    | Leftover AI Studio scaffold, unreferenced                                |
| `apps/mobile/components/settings/SettingsModal.tsx` et al.         | Named `*Modal` but registered as navigator screens — misleading names    |

---

## ⚪ KI-14 — Unreachable AI chat history

`ApiClient.safetyChat(message, history)` and `AiService.safetyChat` both accept a
`history` array, but the service never puts it into the Gemini `contents` — the
prompt is built from `message` alone. Multi-turn context is silently dropped.

---

## ⚪ KI-15 — No accessibility pass

No `accessibilityLabel` / `accessibilityRole` anywhere in `apps/mobile`. For an
app used under stress — and sometimes one-handed, in the dark, or by users with
impairments — this matters more than average. Add labels to the SOS button, the
bottom nav and every icon-only control.

---

## New findings — 2026-10-27

Found while writing the specification suite. Full detail and severity rationale in
[`TECHNICAL_AUDIT.md`](TECHNICAL_AUDIT.md).

### 🔴 KI-16 — Unbounded alert and request loop

> **Resolved — 2026-10-27.** The hook clears its error when the feature is turned off and exposes `clearError`; the screen handles each distinct failure once, reading settings through a ref so the effect no longer depends on what it writes.

**`apps/mobile/App.tsx:140-151`.** The effect depends on `userSettings`, and its body
calls `handleSaveSettings`, which calls `setUserSettings(...)` — a new object identity,
so the effect re-runs. `voiceError` never clears (`useVoiceActivation` sets it on error
and only resets inside `startListening`, which is now disabled). Result: an **infinite
`Alert.alert` queue and infinite `PUT /settings`**, triggered by any voice-recognition
error — i.e. in the hands-free safety path.

**Fix:** clear the error after handling it, or gate on a ref. Enable
`react-hooks/exhaustive-deps` as an error so this class is lint-visible (KI-19).

### 🟠 KI-17 — `pnpm typecheck` is a silent no-op

> **Resolved — 2026-10-27.** Every package defines `tsc --noEmit`, both test suites are inside the checked set, and it is a CI gate.

`turbo run typecheck --dry=json` resolves **all 8 tasks to `<NONEXISTENT>`** — no
package defines the script. It exits 0 having checked nothing, while the repo's own
docs instructed using it as a quality gate.

**Fix:** add `"typecheck": "tsc --noEmit"` to every package; make it a CI gate.

### 🟠 KI-18 — `pnpm lint` fails, so it cannot gate CI

> **Resolved — 2026-10-27.** 0 errors. Generated output is no longer linted, and a warning ratchet at 46 stops the count growing.

27 pre-existing errors: unused imports plus 20 × `jest is not defined` in
`jest-setup.js` (missing ESLint jest env). Must be green before CI can enforce it.

### 🟡 KI-19 — `exhaustive-deps` not enforced

> **Resolved — 2026-10-27.** The one `exhaustive-deps` error is fixed. The rule is already an error under `@react-native`; what hid KI-16 was that lint never ran clean enough to read.

Which is why KI-16 was invisible. Enable as an error on the mobile app.

### 🟠 KI-20 — Sensor re-subscription churn

> **Resolved — 2026-10-27.** All three hooks hold their callback in a ref and key their subscription on `enabled` alone. Regression tests assert one subscription across a callback identity change.

`handleActivateEmergency` is keyed on `userSettings` and passed to all three hooks, so
**every settings save** tears down the accelerometer listeners and destroys/restarts
speech recognition — a continuous-listening feature restarted by unrelated state.

### 🟡 KI-21 — Two independent accelerometer subscriptions

`useShakeDetector` and `useAccidentDetector` each sample at 100 Hz and compute the same
magnitude. Battery doubled for no benefit; merge into one subscription, two thresholds.

### 🟠 KI-22 — No API hardening

> **Resolved — 2026-10-27.** helmet, an explicit CORS allowlist (empty by default) and a throttler at 10/s and 120/min. Verified against the running container.

No `helmet`, no `compression`, no `@nestjs/throttler`. `/auth/login` is openly
brute-forceable; `/ai/*` is an uncapped cost vector.

### 🟠 KI-23 — No global exception filter

> **Resolved — 2026-10-27.** `AllExceptionsFilter` returns one shape with a reference id, keeps validation detail, and never returns internals.

Validation returns `message` as an **array**, plain exceptions as a **string**, so
arrays reach the UI stringified. Stack traces may leak.

### ✅ KI-24 — No pagination, no indexes

> **Resolved — 2026-10-27.** Indexes on `TrustedContact(userId)`,
> `HazardReport(userId)`, `HazardReport(expiresAt)`, `HazardReport(reportedAt)`,
> `HazardConfirmation(userId)` and a unique `(reportId, userId)`.
> `GET /hazard-reports` takes `take`, defaulting to 50 and **capped at 200**, so
> the endpoint can no longer return the whole table.

`GET /danger-zones` was an unbounded `findMany` over every row ever created, and the
schema had **no explicit indexes at all** — not even on `reportedAt`, its sole sort key.

### 🟡 KI-25 — No observability

No request logging, no correlation ID, no real health endpoint (`GET /` returns a hello
string), no dashboards. A delivery regression would be invisible.

### 🟡 KI-26 — PII stored in plaintext

Email, full name, blood type, allergies and contact phone numbers. No field-level
encryption.

---

## 🔴 KI-27 — SOS is unavailable whenever the settings fetch fails

**`apps/mobile/App.tsx`**

`DashboardScreen` fetches settings on mount and then gates the entire screen on the
result:

```ts
if (error || !userSettings) {
  return (
    <ErrorContainer>
      <ErrorText>{error || "An unexpected error occurred."}</ErrorText>
    </ErrorContainer>
  );
}
```

So if the device is offline, the API is down, or the request simply fails, the user
gets an error screen with **no SOS button**. `handleActivateEmergency` also opens
with `if (!userSettings) return;`, so shake and voice triggers do nothing either —
the detectors fire into a no-op.

This inverts the requirement: the emergency path must be _most_ available when the
network is worst. Being offline is a reason to need help, not a reason to be denied
the button.

Found by the `emergency-review` gate (check 3: the SOS path must never block on a
network round-trip) while replacing `DangerZone`. **Pre-existing** — not introduced
by that change, which removed one of the two blocking requests.

**To fix:** render the dashboard and the SOS control from a locally cached
`UserSettings`, treat the fetch as a refresh rather than a precondition, and show a
non-blocking staleness notice instead of an error screen. Settings should never be
on the critical path for a trigger. Pairs with PLAT-4 (the pre-authorised emergency
token) and the Phase 1 local safety engine.

---

## Phase 0 status — 2026-10-27

**Resolved:** KI-1, KI-5, KI-6, KI-7, KI-9, KI-11, KI-13, KI-16, KI-17, KI-18,
KI-19, KI-20, KI-22, KI-23, KI-24.

**Partially addressed:** KI-2 (geo model done; no map SDK, no device location) ·
KI-3, KI-8 (labelled in-app as demos, not implemented).

**Still open:** KI-4 (in-memory auth state), KI-10 (login/signup bypass the
shared client), KI-12 (dated Gemini model string), KI-14 (unreachable AI chat
history), KI-15 (no accessibility pass), KI-21 (two accelerometer
subscriptions), KI-25 (no observability), KI-26 (PII in plaintext),
**KI-27 (SOS unavailable when the settings fetch fails — found after Phase 0)**.

KI-21 is deliberately left: DET-4 replaces single-threshold impact detection
with sequence analysis in Phase 3, and merging the two subscriptions now would
be rewritten then. KI-15 is a Phase 1 gate, not a cleanup.

## Hazard reports — 2026-10-27

The `DangerZone` → `HazardReport` replacement landed as its own change after
Phase 0: real coordinates, mandatory decay, per-person confirmations, no
`severity`, one enum spelling everywhere, and a bounded list query (closing the
pagination half of **KI-24**).

Two defects found while doing it, both fixed:

- The **e2e suite built its own looser `ValidationPipe`** — no
  `forbidNonWhitelisted` — so an unknown property was accepted in tests and
  rejected in production. The pipeline is now `configureApp` in
  `src/app.setup.ts`, shared by `main.ts` and the e2e harness.
- **`POST /api/v1/ai/safety-chat` had no DTO.** Its body was an inline object
  type, which `class-validator` cannot see, so the global pipe skipped the
  endpoint entirely and an unbounded `message` went straight into a metered
  Gemini call. It now has `SafetyChatDto` with length and history-depth limits.

### Next

Phase 1 of [`../product/ROADMAP.md`](../product/ROADMAP.md): **device location**
(`expo-location`) and a real map, which together finish KI-2 and unblock
**KI-3** (a real SOS, behind the Verified Delivery Ledger) — the product's reason
to exist.
