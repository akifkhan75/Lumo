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

- **No map SDK.** _Resolved in 1.5:_ the dashboard has a real map. Reports are still
  **listed** in the Community Hub rather than pinned; pins are Phase 4.
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

> **Partially resolved — 2026-11-12 (Phase 1, milestone 1.0).** The token is kept in
> `expo-secure-store` and restored on launch; logout clears both the in-memory and the
> stored copy; `ApiClient` throws a typed `ApiError` carrying the HTTP status, and only
> a real `401` ends a session — a timeout, a dropped connection or a 5xx does not.
> **Still open:** no refresh token (a 7-day token still expires into a login screen), and
> the prefilled `josim@example.com` / `password` in `AuthScreen.tsx`.

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

> **Mostly resolved — 2026-11-13 (Phase 1, milestone 1.2).** Contact **phone and email**, and
> users' **blood type and allergies**, are AES-256-GCM ciphertext bound to model, column and row id
> (`DATA_ENCRYPTION_KEY`, required at boot; versioned format with key ids for rotation). Verified by
> reading the raw columns after the HTTP flow, and by refusing a ciphertext copied into another row.
> **Still plaintext:** the account `email` and `fullName` (not in the spec's list). Legacy plaintext
> is read tolerantly and counted until `db:encrypt-pii` converts it — see KI-47.

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

> **Resolved for reachability — 2026-11-12 (Phase 1, milestone 1.0).** The dashboard,
> the SOS control and the phone dialler render from the first frame and no longer
> depend on the settings fetch; a failed or hung fetch shows a non-blocking strip with
> a user-initiated retry, and `ApiClient` now has a 10 s timeout so a hung request ends.
> The emergency screen is also reachable **signed out** (an "Emergency help" control on
> the login screens and the boot screen) and opens with no route params at all.
> **What was deliberately not done:** the cached-settings approach above. It would store
> PII (blood type, contacts' numbers) on the device, which is its own decision. See KI-33
> for the consequence.

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
(`expo-location`) and a real map surface, which together finish KI-2 and unblock
**KI-3** (a real SOS, behind the Verified Delivery Ledger) — the product's reason
to exist. Note the split: the map _surface_ is Phase 1, but hazard pins on it
(`PREV-1`, `PREV-2`) are Phase 4, so the map initially shows the user's own position
only.

## Spec gaps found while planning — 2026-11-12

Found while turning the specification suite into an implementation plan. None is a code
defect; each is a place where a spec contradicts another spec, the code, or itself, and
something will later be built on it.

### 🔴 KI-28 — Duress cancel and the recording notice cannot both hold

`PRO-1` and both region profiles set `requiresOnScreenNotice: true`, so a recording must
announce itself. [`EMERGENCY_WORKFLOWS.md`](../specs/EMERGENCY_WORKFLOWS.md) §3 forbids
any recording indicator on the device under duress. Either capture happens without the
legally required notice, or there is no capture during a duress incident. **Needs
counsel.** Default until answered: **no capture during a duress incident.** Gates Phase 2.

### 🟠 KI-29 — `HazardReport.description` is required free text

`PREV-6` prohibits free-text naming of individuals and businesses. The DTO rejects contact
details but not a business name, and the column is a required `String`. Constrain to
structured fields plus a bounded note, with a backfill. Phase 4.

### 🟠 KI-30 — `EscalationPolicy` has no Prisma model

`SafetySession.escalationPolicyId` references it and
[`ESCALATION_POLICY.md`](../specs/ESCALATION_POLICY.md) defines the shape, but
[`DATA_MODEL.md`](../specs/DATA_MODEL.md) never declares the model. Add both together in
the Phase 1 schema milestone.

### 🟠 KI-31 — Background push cannot prove device arrival

The ledger, ADR-0012's context, the `delivery-ledger` skill and the platform matrix all
claimed a provider receipt reaches `DELIVERED`. It does not: a receipt means FCM or APNs
_accepted_ the message. **Corrected 2026-11-12** — provider-side ceiling is `SENT`;
`DELIVERED` needs a device-side receipt. The code does not exist yet, so nothing was
ever recorded wrongly, but the spec would have led to it.

### 🟡 KI-32 — Requirement IDs missing, and orphaned from any spec

Twelve ROADMAP items carry no requirement ID (circles; discreet triggers; explainable
notifications; accelerometer consolidation; organisation portals; referral loop; trust
page; admin console; professional monitoring; dispatch under agreement; public-alert
feeds; biometric lock and stealth mode). Separately, `RES-10` (live location) has no
owning spec, and 25 further IDs appear in no spec's `Implements` header. IDs are assigned
in the PRD and never minted elsewhere ([`lumo-docs`](../../.claude/skills/lumo-docs/SKILL.md)).

## Found while building milestone 1.0 — 2026-11-12

### 🟠 KI-33 — Hands-free triggers are inert until settings load

With the SOS control no longer gated on the settings fetch (KI-27), the _automatic_
triggers still are: shake, voice and crash detection read `shakeToSosEnabled`,
`voiceActivationEnabled` and `accidentDetectionEnabled` from the fetched settings and
default to off until they arrive. A user who relies on shake-to-SOS and launches the app
with no connection has no hands-free trigger until the fetch succeeds. The dashboard
says so ("Shake, voice and crash triggers are off until your settings load"), so it is
honest, but it is a gap. **To fix:** persist the three trigger flags — not the whole
profile — in the keystore, so the triggers arm from the last known preference. Pairs
with the Phase 1 local safety engine.

### 🟡 KI-34 — `tel:` opening the dialler is unverified on a device

The emergency screen opens the dialler with `Linking.openURL('tel:')`. A bare `tel:`
with no number is assumed to open the dialler on both platforms; that has not been
confirmed on real hardware, and iOS may require a number. The failure is now visible
(a message tells the user to dial their local emergency number) rather than silent, but
whether the success path works is untested. The region-correct number belongs to
Phase 1 milestone 1.8. **To verify:** one Android and one iOS device.

### 🟡 KI-35 — A failed token delete restores an ended session

`tokenStorage.clearToken` reports whether the stored token was removed, and logout does
not act on a `false`. If the keystore refuses the delete, the next launch restores the
session the user just ended. Rare, but it is a logout that silently did not log out.

## Found while building milestone 1.1 — 2026-11-12

Encoding the §6a tables line by line surfaced places where the spec was ambiguous or
contradicted itself. Each was resolved toward never blocking help; none was resolved silently.

### 🔴 KI-36 — The idempotency key cannot merge two separate activations

§7 requires "two triggers within 60 s → one incident". The key is
`sha256(… · floor(triggerAtMs / 60000) · …)`, and a bucket has a boundary: two triggers two
seconds apart that straddle it get **different keys**. The key collapses _retries of one
activation_ (same `triggerAtMs` → same key, whatever the clock skew); it cannot merge distinct
ones. **To fix:** a server-side rule — an open incident absorbs a new trigger from the same user
— in milestone 1.8. Until then the §7 scenario is not met, and the test says so explicitly
rather than passing by a lucky timestamp. The fields were also joined with `+`, which is
ambiguous; they now use U+001F.

### 🟠 KI-37 — `ALL_SETTLED` had no "ladder complete" guard

As written, "none succeeded" fired as soon as the first step's attempts all failed — declaring
`ALL_CHANNELS_FAILED` (a full-screen alarm, on-call paged) while the next step had not been
dispatched. Fixed in code and in §6a: settling needs nothing in flight **and** no step remaining.

### 🟠 KI-38 — Multiple acknowledgers are not modelled

There is no `ACKNOWLEDGED + ACK_RECEIVED` row, so a second contact responding is an
`ILLEGAL_TRANSITION` the caller must treat as benign. Worse, `UNACK_RECEIVED` returns the incident
to its prior state **even if another contact is still responding** — resuming the ladder under
someone who is on their way. **To fix:** the caller must emit `UNACK_RECEIVED` only when no
acknowledgement remains; better, track acknowledgers in the machine. Milestone 1.8.

### 🟠 KI-39 — Session table gaps

`SOS_RAISED` exists only from `ACTIVE`, not from `CHECK_IN_DUE`, `GRACE` or `ESCALATING`; and
`CHECK_IN_DEADLINE_REACHED` has no row from `SUSPENDED`, so a deadline passing offline replays as
a `RECONCILIATION_CONFLICT`. No rows were added. **Creating an incident must never depend on the
session transition succeeding** — an SOS from a graced session still has to dispatch.

### 🟡 KI-40 — `requireAck` has no defined behaviour

`EscalationStep.requireAck` has a default (true) and no semantics. The evaluator carries it
through unchanged. Decide what it means before the notifications module reads it.

### 🟡 KI-41 — A lapsed TTL on an unreceipted push or SMS is `EXPIRED`, which counts as failed

By §6a, `SENT` + TTL on a channel that _could_ have reported is `EXPIRED`; the rollup counts
`EXPIRED` as not reached and the attempt asks for a fallback. For SMS (receipts are
provider-dependent) the message may well have arrived, so the incident can read "couldn't reach
Mum" for someone who was reached, and the fallback sends again. This errs toward more alerts,
bounded by the spend cap. Whether it should be `UNKNOWN` is a product decision.

### 🟡 KI-42 — The rollup is per recipient; the spec says per attempt

§3 reads as per-attempt. With fallbacks that misreports ("push failed, SMS sent" is a recipient
who was reached). The code rolls up per recipient and §3 should say so.

### 🟡 KI-43 — `LOCATION_TIMEOUT` "≤5s elapsed"

Read literally it is a guard that could refuse an early timeout. It has no guard: a skewed clock
must not be able to stall dispatch. The 5 s time box is exported as `LOCATING_TIMEBOX_MS`.

### 🟡 KI-44 — The confirmation floor is still declared twice

`@lumo/safety-domain` now owns `HAZARD_CONFIRMATION_FLOOR` and the API uses it. `@lumo/types`
still exports its own copy, which `apps/mobile` imports. It was left until the mobile milestone-1.0
work (#9) landed, to avoid a lockfile conflict; that has now happened, so it can be done.
**To fix:** point mobile at the shared constant and delete the copy in `@lumo/types`.

## Found while building milestone 1.2 — 2026-11-13

### 🟠 KI-45 — A removed contact's personal data is never purged

Contacts are soft-deleted so the delivery ledger's ids always resolve, but the row keeps its
(encrypted) phone and email indefinitely. Erasing a person's number after removal belongs to the
retention job (milestone 2.11); until it exists, "remove" hides a contact without destroying them.

### 🟠 KI-46 — The erasure flag is a convention, not a privilege boundary

Append-only history refuses `DELETE` unless the transaction ran `SET LOCAL lumo.erasure = 'on'`.
Anything that can open a transaction can set it, so this stops a bug and a careless statement, not a
determined or compromised caller. **To fix:** run the erasure procedure under a separate database
role that alone may delete from those tables, and the app role without it.

### 🟡 KI-47 — Unencrypted legacy values are tolerated on read

A value without the `enc:v1:` prefix is returned as it is and counted
(`PiiCipher.legacyPlaintextReads`), because refusing to read a contact's phone number is worse than
reading it. Nothing writes plaintext. Run `pnpm --filter api db:encrypt-pii --check` (exit 1 if any
remains) on every environment after deploying; CI runs it on a seeded database.

### 🟡 KI-48 — `ConsentRecord.grantedById` is ambiguous for contact consent

Contact consent is granted by the **contact**, who may not be a Lumo user, so `grantedById` cannot be
a user id. The 1.2 tests and the schema comments treat it as the contact's id. The invite flow
(milestone 1.6) must fix what it means before it writes real rows.

### 🟡 KI-49 — No key-loss recovery

`DATA_ENCRYPTION_KEY` loss makes the encrypted columns unrecoverable by design. It must be backed up
separately from the database. Rotation is supported (key ids, `DATA_ENCRYPTION_KEYS_PREVIOUS`) but
no job re-encrypts under a new key yet beyond re-running `db:encrypt-pii` on plaintext only.

## Found while building milestone 1.3 — 2026-11-13

### 🟠 KI-50 — Country and subdivision rely on the platform geocoder (partly fixed in 1.4)

_Update, milestone 1.4:_ the device now reverse-geocodes each fix and `placeFromGeocode` maps it to a country and subdivision; see KI-56. The original problem follows.

#### Original

`@lumo/region-profiles` resolves from a country and subdivision that something else has already
worked out. That something does not exist: the app cannot yet read its position (milestone 1.4),
and even then needs a reverse-geocoder or boundary data. Until it does, the resolver only ever sees
the SIM or account country, so emergency numbers are shown as _unconfirmed_ and regional numbers
(PK 1122) as _possible_. It deliberately does not approximate with bounding boxes: a wrong number
near a boundary is the failure the package exists to prevent. **To fix:** milestone 1.4, with a
source whose accuracy near borders is understood.

### 🔴 KI-51 — The fallback emergency number is unverified

The spec's step 5 ("global safe default") defines nothing. `GLOBAL_DEFAULT` holds `112`, flagged
`verified: false` and labelled unverified. It is a number in code, chosen by the implementation, and
the package makes no claim about where it works. **Needs operations and counsel** to confirm or
replace it before anyone relies on it.

### 🟠 KI-52 — Every emergency number and subdivision mapping is a hypothesis

Both profiles are drafts: `numbersVerified` is false, and the spec itself says counsel and
operations must confirm them. Specifically unverified: that `1122` is **Punjab-only** (and that the
spec's "Punjab" is code `PB`), and that PK has no other regional numbers. A wrong claim here sends
someone to a number that does not answer.

### 🟠 KI-53 — Recording consent is the strictest rule almost everywhere

The US override list has nine states against the spec's own "roughly a dozen", and Pakistan has none,
so any unlisted subdivision resolves to `all-party`. That is deliberate and safe, but it means audio
capture will prompt for consent in places where it may not be required, until counsel supplies the
real per-state rules. No emergency exception is assumed.

### 🟡 KI-54 — "Current fix" is five minutes, and accuracy is ignored

`CURRENT_FIX_MAX_AGE_MS` is five minutes because the spec does not define one. A fix's `accuracyM`
is carried but not used: a fix with a very large error radius near a border could be resolved to the
wrong country by the caller, and nothing here would notice. Decide an accuracy ceiling when the
geocoder exists (KI-50).

### 🟡 KI-55 — Resolution notes are English strings

The uncertainty notes ("Showing Pakistan emergency numbers; we couldn't confirm your location.") are
returned as English text. They need translating — Urdu for PK — under the localisation work
(milestones 1.14 / 6.1), and a native-speaker review like every other safety string.

## Found while building milestone 1.4 — 2026-11-13

### 🟠 KI-56 — The place of a fix depends on an undocumented geocoder

`reverseGeocodeAsync` is documented to return `isoCountryCode` and `region`, but not the _format_ of
`region` (name, abbreviation or code), and it needs the network (assumed, undocumented). Subdivisions
come from an exact-match table for US states and PK provinces; anything else is unknown, which
costs only a "possible" label on a regional number. Unverified on real devices in either country,
and a geocode is reused for a newer fix only within 100 m and 2 minutes (arbitrary, see
`placeTracking.ts`). The region resolver is **not yet wired to the dashboard**, so emergency numbers
still do not use this (milestone 1.8).

### 🔴 KI-57 — A position reaches nobody

Capture and display only. Uploading, the sharing control and the sharing indicator ship together with
sessions (1.10), incidents (1.8) and the recipient page (1.11), so a share can never exist without its
indicator (invariant 4). Until then nothing is stored across a restart either; the durable queue is
1.13. The plan's 1.4 exit ("two devices, one sharing") moved to 1.10/1.11.

### 🟠 KI-58 — The fix is the device's claim

Mock-location settings, indoor or urban-canyon error, and an Android "approximate" grant can all give
a wrong position. Lumo shows the accuracy the device reports and treats a fix with unknown accuracy as
none, but it cannot detect a lying but plausible reading. The "approximate" grant is not distinguished
from a precise one except through the larger accuracy radius.

### 🟡 KI-59 — Permission and watch behaviour is verified in Jest only

Foreground permission flows, `watchPositionAsync` stop-on-blur/background, and the settings deep link
were tested against a mock. Not run on iOS or Android hardware; `expo prebuild` was checked for the
absence of background permissions on Android only. The native project must be rebuilt for the new
plugin.

## Found while building milestone 1.5 — 2026-11-13

### 🟠 KI-60 — The Android map has no tiles without a Google Maps key

`react-native-maps` uses Google Maps on Android, which needs an API key. It is not in the repo (it
must not be): `app.config.js` injects it from `GOOGLE_MAPS_API_KEY` at build time. Until the owner
creates a key (restricted to the app's package and signing certificate) and sets it as a build
secret, the Android map renders blank; the position text above it still works. iOS uses Apple Maps
and needs nothing. The map views themselves are verified in Jest against a mock only.

### 🟡 KI-61 — The map shows a third-party view of where the user is

The map SDK's tile requests reveal the viewed area to Apple or Google. Lumo sends them no
coordinates itself, and `showsUserLocation` is off so the OS's blue dot is not a second claim, but
the store privacy declarations (Data Safety / privacy manifest) must mention map tiles before release.

## Found while building milestone 1.6 — 2026-11-17

### 🔴 KI-62 — Consent is a shared link, not verified identity

The server cannot tell the contact from the account holder when both can open the same link. A user
who wants to can open their own link and "agree" for someone who never did. The link proves possession,
not identity. Mitigations that need infrastructure which does not exist yet: confirm through the
contact's own number (a one-time code by SMS, milestone 1.7) before consent counts. Until then, treat
"agreed" as the contact's agreement **as far as a shared link can show it**.

### 🟠 KI-63 — Nothing delivers the link

Lumo has no SMS, email or push path until milestone 1.7, so the user must pass the link on themselves.
It can be forgotten, sent to the wrong person, or read by anyone who sees the message. The link is
valid for 7 days, replaceable, and ended by a change of number, but a forwarded link works for whoever
opens it first.

### 🟡 KI-64 — The consent page is a stopgap

A minimal server-rendered page in the API, English only, with no accessibility audit, until `apps/web`
(1.11) replaces it. Its wording is versioned (`v1`) and recorded with each consent.

### 🟡 KI-65 — Old phone numbers are not validated

Numbers saved before E.164 validation may be loose or unparseable. They are kept as stored when sent
back unchanged (so one old contact cannot block every settings save) but are not flagged to the user,
and would not be dialable by a later alert path. A review step belongs with the alert work (1.7/1.8).

### 🟠 KI-66 — Safety circles are not built

The plan listed circles in 1.6, but they have no requirement ID in the PRD, nothing consumes them until
the escalation engine (1.9), and the roadmap rule is not to mint IDs. Deferred to 1.9; the owner should
assign the ID.

## Found while building milestone 1.7a — 2026-11-17

### 🟠 KI-67 — At-most-once has a crash window

A worker claims an attempt before calling the provider. If the process dies after the provider accepted and
before the outcome was written, the attempt stays `QUEUED` and claimed, and at its time-to-live becomes
`EXPIRED` with reason `SEND_OUTCOME_UNKNOWN`. The message may have gone; the ledger says exactly that and the
fallback proceeds. A Twilio callback carrying the attempt id can repair it (it records the acceptance it
implies). Chosen over at-least-once because a duplicate alert is recoverable and a silent lie is not, but it is
not free.

### 🔴 KI-68 — Never run against real Twilio

No account exists. The adapter follows Twilio's documented API and is tested against a stub client and a
signed fake callback only. Unverified against the real service: the exact callback fields, error codes, and
whether a destination without receipts ever reports `delivered`. The plan's exit for 1.7 stays open.

### 🟠 KI-69 — Contacts have no push address

`Device` belongs to a user and a contact is not linked to one. The link must never be inferred from a matching
email or number (it would deliver one person's alerts to whoever registers that address). It can exist only when
a contact claims their invite while signed in, which is not built. Until then push to a contact is ledgered
`NO_ADDRESS`. 1.7b must decide how a contact ever gets an app.

### 🟡 KI-70 — Node 22 is now required

pg-boss 12 needs Node ≥ 22.12 (Node 20 reached end of life in April 2026). CI and the Dockerfile moved to 22.
The image has still not been built (no Docker daemon was available), so the Node bump is unverified there.

### 🟡 KI-71 — The queue shares the database, and has no spend cap yet

A database outage stops sending and recording together. The pg-boss schema is created on boot and needs CREATE
on the database. Fan-out is unbounded until the spend cap (1.7b), though nothing can raise an incident yet.
Counters are in-memory only; real metrics are milestone 1.15.

## Found while building milestone 1.7b (part 1) — 2026-11-17

### 🔴 KI-72 — A worker that claimed first and then failed a lookup would have recorded "outcome unknown" for a message never sent

_Fixed in this milestone and kept here as the reason the order is what it is._ The claim is now taken
immediately before the provider call; lookups, the consent re-check and the configuration check come first.

### 🔴 KI-73 — The daily caps are hypotheses, and a cap too low blocks someone asking for help

PK: 30 SMS and 100 push/web per day; US: 30 SMS, 10 voice, 100 push/web. Nobody has measured how many
messages a real incident needs (contacts × channels × retries × several incidents in a day). They are
generous on purpose, but a user with many contacts and a bad day can reach them. A hit is ledgered, returned
to the caller and must be shown to the user; nothing in the UI shows it yet (1.8).

### 🟠 KI-74 — No per-tenant ceiling

PLAT-5 names per-user **and** per-tenant ceilings. There are no tenants until organisations exist (Phase 4);
only the per-user cap is built.

### 🟠 KI-75 — A queued attempt that is then skipped keeps its reservation

Consent withdrawn between planning and sending leaves the attempt counted against the cap. Conservative (it
slightly over-counts), but it can eat budget during a flurry of withdrawals. Left unreleased on purpose, to
keep the reservation append-only.

### 🟡 KI-76 — With no region profile for the incident, nothing is gated

An `UNRESOLVED` incident region sends on any channel the caller lists (with the strictest known cap). Blocking
everything because the country is unknown was judged worse in an emergency, but it means US SMS rules cannot be
applied to an incident whose region could not be worked out.

### 🟡 KI-77 — Voice has never been placed

No Twilio account. The call parameters and statuses follow Twilio's documentation (fetched, not recalled), but
nothing has been run against the real service, and voice to a US number also needs the registration the
profile marks incomplete.

## Found while building milestone 1.7b (part 2) — 2026-11-17

### 🟠 KI-78 — The app's half of push (built in 1.8c, unproven)

_Update: built — see KI-97 – KI-100._ Original text:

#### The app does not do its half of push

Nothing in `apps/mobile` registers a push token, offers "claim this invite", or posts device receipts and
acknowledgements. So no contact can have a push address, and nothing can reach `DELIVERED` or be acknowledged by
push, until it does (needs `expo-notifications`, a native rebuild, and a deep link into the app). On iOS a
backgrounded app cannot post a receipt until the Notification Service Extension (1.16), so many pushes will settle
"sent, not confirmed" there regardless.

### 🟠 KI-79 — Claiming a link is possession, not identity

Whoever holds an unclaimed link, signed in, can claim it, and the first claim wins. A forwarded link can therefore be
claimed by the wrong person; the contact can withdraw (which clears the link), and the owner sees "agreed" either
way. The same limit as KI-62, now with a push address attached. A one-time code to the contact's own number (SMS,
now possible) would close it.

### 🟠 KI-80 — A push the service accepted for some devices is "sent" for all

One attempt covers every live device of the linked account; accepted-for-one is `SENT`, and a device-side receipt
from any one device is `DELIVERED`. The ledger cannot say which device, or whether the others got it.

### 🟡 KI-81 — Expo receipts are checked once

At ~15 minutes, once (the queue retries only if the service is unreachable). A receipt that is not ready then is not
re-asked; the TTL settles the attempt. Receipt-time `DeviceNotRegistered` is not mapped back to a token (receipts
carry only the ticket id), so a token that died after acceptance is revoked at its next send, not at receipt time.

### 🟡 KI-82 — Expo push has never run

No Expo project or credentials. The API is built to Expo's documentation (fetched, not recalled) and tested against a
stub only.

## Found while building milestone 1.8a — 2026-11-18

### 🔴 KI-83 — With the defaults, an SOS reaches nobody

`sendSmsOnSos` defaults to **off**, and push needs a contact who claimed their invite from a signed-in account (KI-78: the
app cannot do that yet). So a typical user's SOS ends `ALL_CHANNELS_FAILED`, honestly, and the app must then put the dialler
first. Whether SMS should be on by default (it costs money and needs the contact's consent, which we have) is a product
decision, and the answer decides whether the headline feature does anything for most users.

### 🔴 KI-84 — No app side, and nothing sent to anyone real

1.8b (countdown UI, live ledger, trigger wiring, the "all failed" screen, region-correct dialling, emergency-token minting)
is not built. No Twilio or Expo account exists. The plan's two-device exit is open.

### 🟠 KI-85 — Without the escalation engine, one plan only

No retry, no next contact on silence, no fallback chain: after the single plan nothing more is coming, so `moreStepsRemain`
is false. A contact who never answers is simply "sent, not confirmed" forever. 1.9 flips this.

### 🟠 KI-86 — The emergency token is wider than the spec's "exactly one action"

It can create, cancel, resolve and read status (ids and states only), because a token that could start an alert but not
stop it would strand someone. A stolen phone with a live token can raise a false alert for up to 30 days unless the token is
revoked. It cannot read contacts, history or location.

### 🟠 KI-87 — A countdown killed with the phone offline is not covered

The server owns the countdown only once the request reaches it. A device that is offline when SOS is pressed counts down
locally and sends on reconnect (1.13); until then it must say so and offer the dialler.

### 🟡 KI-88 — Message times are UTC, and the map link is Google's

A contact's timezone is unknown, so the SMS states UTC. The position is a Google Maps link, which tells Google the
location when opened. A Lumo-hosted page (1.11) replaces it.

## Found while building milestone 1.8b — 2026-11-18

### 🔴 KI-89 — The SOS screen has never run on a device or against a real server

Everything is tested in Jest with the API mocked. The countdown, polling, the dialler for a number (`tel:911` as opposed
to a bare `tel:`, KI-34 still open), the emergency-token lifecycle and resuming after a kill are unverified on iOS and
Android. A native rebuild is needed (it already was, for location, maps and secure-store).

### 🟠 KI-90 — The countdown shown is the device's clock

The server decides when the countdown ends and the screen moves on only when the server says so, so a wrong phone clock
cannot dispatch early or late; but the seconds it shows are counted locally and can disagree with the server's by the
clock's error and the request's latency.

### 🟠 KI-91 — A press while offline sends nothing, and nothing queues it

The screen says nothing was sent and offers the dialler and "try again" (user-initiated, same key). There is no
automatic send on reconnect, and the pre-filled device SMS fallback is not built (1.13).

### 🟡 KI-92 — Emergency numbers on screen rest on unverified profile data

`911` and `15` come from draft profiles (KI-51, KI-52); the fallback `112` is flagged unverified on screen. The regional
Punjab number is shown as "might work" until the subdivision is confirmed.

## Found while building milestone 1.9 — 2026-11-19

### 🔴 KI-93 — A manual SOS now reaches contacts one at a time

By the spec's own design the ladder runs contact → contact with a timeout (120 s), so the **second contact is not alerted for up to
two minutes** unless the first step's attempts all fail. Before 1.9 every contact was alerted at once. A person pressing SOS may
reasonably expect everyone to be told immediately. The safer default for a _manual_ SOS may be "the first two or three together,
then escalate", which a stored policy can already express but nobody can set from the app. Needs a product decision.

### 🟠 KI-94 — The spend cap is not part of the ladder's own accounting

The evaluator can record "the cap, not the policy maximum, stopped this", but the cap is a per-channel count and is applied at
attempt level, so the ladder sees `null` headroom and a capped contact still consumes one of the policy's recipient slots.

### 🟠 KI-95 — No screen for the plan

The plan is readable and editable over the API only. A person cannot see, before it runs, what their app will do, which is the
requirement (RES-4) — until the app shows `GET /escalation-policy`.

### 🟡 KI-96 — Timers are as accurate as the queue's poll

A step's deadline is honoured to within the queue's one-second poll plus any backlog; a long outage of the worker delays the next
contact by that long. An incident whose worker is down is not advanced at all until it returns.

## Found while building milestone 1.8c — 2026-11-19

### 🔴 KI-97 — Push has never run, and a build needs an EAS project id

There is no Expo project, so `getExpoPushTokenAsync` has nothing to use: the screen says the build can't receive alerts yet. Even with
one, nothing here has run on an iOS or Android device (a native rebuild is needed for `expo-notifications`), nor against Expo's
service. The plan's real-delivery exits stay open.

### 🟠 KI-98 — A contact cannot say "I can't help after all" from a notification

The push carries only an attempt id, by design (it crosses third parties and shows on a lock screen). `unack` needs the incident id.
Resuming the ladder after an acknowledgement therefore has no button yet; the alert screen could look the incident up through the
attempt, which needs a (contact-scoped) endpoint.

### 🟠 KI-99 — A link followed while signed out is lost

`lumo://claim/<token>` is handled only once the dashboard is mounted. A person who opens the link signed out, or while the session
is restoring, lands on the sign-in screen and the token is dropped; they paste the link again after signing in.

### 🟡 KI-100 — Receipts exist only while the app runs

A notification that arrives with the app closed or backgrounded is never reported, so those alerts will always read "sent, not
confirmed" to the sender, however well they landed. A background notification task (Android), and the service extension (iOS,
milestone 1.16), are the fix.

## Found while building milestone 1.10a — 2026-11-20

### 🟠 KI-101 — No deviation detection

RES-14's six-step algorithm needs an expected route, and a journey has only a destination. `DEVIATION_DETECTED` is in the state
machine and is never raised. A person who is taken somewhere else is caught only by missing their arrival time.

### 🟠 KI-102 — Contacts are not told a journey started

The machine declares `notifyContactsSessionStarted`; it is not carried out. Nothing yet delivers a live link (1.11) and a message per
journey costs money and goes beyond what a contact agreed to. The consequence: a contact first hears of a journey when it goes wrong.

### 🟡 KI-103 — The prompt to the person is best effort

At the deadline the person is asked by a push to their own devices; if they have none registered, or push is not configured, only the
app (reading the journey's `needsAnswer`) asks. A person with the app closed and no push token is not asked at all before the grace runs.

### 🟡 KI-104 — The sweep is the only recovery from a lost job

If both a timer and the sweep were down for longer than the grace, a journey escalates late, not never. A journey whose escalation
failed repeatedly stays `ESCALATING` and is retried by the sweep every minute until it works.

## Found while building milestone 1.10b — 2026-11-20

### 🟠 KI-105 — No way to set a destination in the app

The server supports a destination and arrival by a precise fix inside 75 m; the screen has no way to choose one (a map picker or a search
is its own piece of work). So in practice every journey ends by the person's own confirmation, which is safe (never a timer) but means the
"you've arrived" automation is unused.

### 🟠 KI-106 — A due check-in reaches the person only through the app and a push

If their phone is off, silent, or the app has no push token (KI-97 means none yet), the question is never seen before the grace runs out.
The grace is the protection (their contacts are then tried), but a person who was merely busy is alerted about because they were not asked
in a way they would notice. Louder, repeated local reminders need a scheduled notification (a native module the app lacks).

### 🟡 KI-107 — Positions are saved only while the app is open

A journey with the phone in a pocket and the screen off, which is the usual walk home, saves no positions: foreground only, by decision
(docs/specs/LOCATION.md). The position an alert carries is therefore the last one saved while Lumo was open, with its age. Background
location is its own permission, review and promise (milestone 1.16 / a decision).

## Found while building milestone 1.12a — 2026-11-17

### 🟡 KI-116 — A practice run with one attempt shows no failure

The simulated failure is the last of two or more attempts. With one contact on push alone there is exactly one attempt, and failing it would
invent a failure of the only path, so that run shows none. A second contact, or SMS turned on, shows one.

### 🟡 KI-117 — Practice simulates one pass, not the ladder over time

The run resolves who would be tried and over which channels and writes the ledger at once, with fixed offsets. It does not step through the
escalation timeouts, retries or an acknowledgement, so a person does not yet see what happens when the first contact stays silent.

### 🟠 KI-118 — No way to start a practice run from the app, and no activation record

The server accepts it; the app has no entry, banner or offline run (1.12b). Onboarding step 4 and the "completed one practice run" activation
measure (PRD §7) are not built, and there is no metrics pipeline yet: `mode` on the incident is the hook that keeps rehearsals out of it.
