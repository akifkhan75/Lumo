# Glossary

Domain and codebase vocabulary. When a term here is also a code identifier, the
identifier is given — use the same word in code, docs and UI copy.

---

## Domain

**Danger Zone** — `DangerZone`
A user-reported hazard at a location: a `severity`, a `type`, a free-text
`description`, and a timestamp. Community data: it outlives its reporter
(`onDelete: SetNull`) and the feed is global. Today its position is a CSS
percentage over a static image, not a coordinate ([KI-2](audit/KNOWN_ISSUES.md)).

**Severity** — `DangerZoneSeverity`
`low` | `medium` | `high`. Drives pin colour: blue `#3b82f6`, amber `#f59e0b`,
red `#ef4444`.

**Zone Type** — `DangerZoneType`
`Theft` | `Assault` | `Harassment` | `Poor Lighting` | `Suspicious Activity`.
Beware: three spellings per value across Prisma, Postgres and the API — see
[DATABASE.md](engineering/DATABASE.md).

**Trusted Contact** — `TrustedContact`
Someone the user nominates to be alerted in an emergency: `name` + `phone`.
Stored and editable today; **not yet used by any alert** ([KI-3](audit/KNOWN_ISSUES.md)).

**SOS / Emergency**
The user's explicit or automatic call for help. In the code, "Emergency" is the
screen (`EmergencyModal.tsx`, route `Emergency`) and "SOS" is the trigger (the
button, the shake, the wake phrase). Keep that distinction.

**Trigger**
Any action that activates SOS. Four exist: the SOS button, a shake, a voice wake
phrase, and a detected crash. All four call `handleActivateEmergency`.

**Fake Call**
An escape tool: a simulated incoming call with an AI-generated script, giving the
user a plausible reason to leave. Real and working.

**Follow Me** — `Journey` (planned)
Sharing a live journey with a contact via a link, for the duration of a trip —
not a persistent background share. Currently a mock link
([KI-8](audit/KNOWN_ISSUES.md)).

**Check-In**
A countdown the user sets; if they do not cancel it, SOS fires. Works in-process
only, so it dies with the screen ([KI-8](audit/KNOWN_ISSUES.md)).

**Safe Walk**
Requesting a companion or responder to accompany a journey. Mock.

**Voice Guard**
The UI name for continuous wake-phrase listening. `isListening` from
`useVoiceActivation` drives the header badge.

**Wake Phrase**
`BRAND_VARIANTS` + `INTENT_WORDS` in `useVoiceActivation.ts`. A wake utterance is
any recognizer alternative containing a brand variant (`lumo`, `loomo`, `luma`, …)
**and** an intent word (`emergency`, `help`, `sos`). Variant matching exists because
`Lumo` is coined and transcribes inconsistently — see [MOBILE.md](engineering/MOBILE.md).

**Defense Mode**
An overlay on the emergency screen showing AI self-defense tips and claiming a
loud alarm. The tips are real; the alarm is not.

**Nearby Volunteers / Responder**
The planned network of vetted people who can respond before emergency services.
Currently a text label; a Phase 4 bet in [ROADMAP.md](product/ROADMAP.md).

**Security Settings** — `SecuritySettings`
The six booleans stored flat on `User`: `locationSharingEnabled`,
`shareLocationOnSos`, `sendSmsOnSos`, `shakeToSosEnabled`,
`voiceActivationEnabled`, `accidentDetectionEnabled`. The last three genuinely
control the sensor hooks; the first three are stored and unread.

**Stealth Mode** (planned)
Operating without visible signs — disguised icon, discreet trigger, no alert UI —
for users whose threat has access to the phone. See T1 in
[SECURITY_AND_PRIVACY.md](engineering/SECURITY.md).

---

## Codebase

**`apiService`** — `apps/mobile/services/apiService.ts`
The mobile app's only network door: a façade over `ApiClient` plus the in-memory
token. Components never call `fetch`.

**`ApiClient`** — `packages/api-client`
A class with one method per endpoint, shared by the app and the tests. The
contract between the two halves of the system.

**Route params as state transport**
This app's deliberate pattern: `DashboardScreen` owns all state and passes it —
plus mutator callbacks — through React Navigation params. No Redux, no Context.
See [ADR-0004](adr/0004-route-params-as-state-transport.md).

**`JwtAuthGuard`**
The passport-jwt guard on every protected route. Populates
`req.user = { id, email }` via `JwtStrategy.validate`.

**Enum mapping** — `mapInputType` / `mapOutputType`
Hand-written translation in `DangerZonesService` between the Prisma enum member,
the `@map`'d Postgres value and the API's display string.

**Fallback (AI)**
The hardcoded response every `AiService` method returns when there is no API key,
the response will not parse, or the call throws. A product guarantee: an
emergency feature must never depend on an LLM round-trip. Preserve it.

**Whitelist stripping**
The global `ValidationPipe({ whitelist: true })` silently deletes body properties
with no validation decorator. The usual cause of "my field is `undefined`".

**Dev client**
A custom native build (`expo run:android`) required because
`@react-native-voice/voice` has no Expo Go support. `useVoiceActivation` detects
its absence and degrades quietly.

**Patched dependency**
`@react-native-voice/voice@3.2.4` + `patches/@react-native-voice__voice@3.2.4.patch`,
applied by `pnpm.patchedDependencies`. Bumping the package invalidates the patch
and breaks the Android build.

**Mock vs Real**
The repo's most load-bearing distinction. "Real" means wired end to end; "mock"
means the UI exists and does nothing. [FEATURES.md](audit/FEATURES.md) is the source of
truth, and describing a mock as shipped is the one unacceptable error here.

**KI-n**
A numbered entry in [KNOWN_ISSUES.md](audit/KNOWN_ISSUES.md). Cite the number in
commits, PRs and docs.

---

---

## Target domain vocabulary

Introduced by the specification suite. Use these words in code, docs and UI copy;
the terms they replace are marked.

**Safety Session** — `SafetySession`
A user-initiated plan with an expected outcome: a journey, a check-in, an activity.
Owns timers and deadlines. **An overdue session is not an emergency** — it escalates
_into_ one. [`specs/SAFETY_STATE_MACHINES.md`](specs/SAFETY_STATE_MACHINES.md)

**Emergency Incident** — `EmergencyIncident`
The response. Created by an explicit SOS, an escalated session, or a confirmed
automatic trigger. Owns dispatch and the ledger.

**Notification Attempt** — `NotificationAttempt`
One per **recipient × channel**. The unit of truth behind the Delivery Ledger.

**Verified Delivery Ledger**
Per-contact, per-channel record of what was attempted, delivered and acknowledged.
Replaces the single success tick. [`specs/DELIVERY_LEDGER.md`](specs/DELIVERY_LEDGER.md)

**Channel ceiling** — `ChannelCapability.maxState`
The highest state a channel can truthfully report. Background push stops at
`DELIVERED`; device-direct SMS at `SENT`. Transitions above the ceiling are rejected,
so the UI cannot lie.

**`UNKNOWN`**
A terminal attempt state meaning the channel cannot report further. Honest
uncertainty — **never rendered as success**.

**`SUSPENDED`**
A live session with no connectivity. Timers run locally; remote delivery is **not**
guaranteed, and the UI must say so.

**`ALL_CHANNELS_FAILED`**
Nothing got out. A full-screen state with a one-tap emergency dial, and it pages
on-call.

**Hazard Report** — `HazardReport` · _replaces `DangerZone`_
An observation about a **condition** — with source, age, confirmations and an expiry —
not a verdict about a place. Has no `severity` and no demographic field.
[ADR-0010](adr/0010-hazard-reports-replace-danger-zones.md)

**Escalation Policy** — `EscalationPolicy`
The user-owned ordered plan: who is contacted, over which channels, with what
timeouts. Visible before it runs. [`specs/ESCALATION_POLICY.md`](specs/ESCALATION_POLICY.md)

**Grace period**
The window between a missed check-in and escalation. Default 300s, **minimum 60s,
never zero** — an ordinary delay is not evidence of an attack.

**Emergency token**
A narrowly-scoped, short-lived token authorising exactly one action: create and
dispatch an incident. Exists so an expired session never blocks an SOS (PLAT-4).

**Idempotency key**
Device-minted before the first attempt, so retries converge on one incident.
Deliberately buckets to the minute: a merged incident beats an alert storm.

**Duress code**
A second PIN that appears to cancel while escalating silently. The device reveals
nothing. Counters coerced cancellation (T1/T3).

**Practice Mode**
Exercises the whole pipeline while notifying nobody. Gates activation. A practice
incident **cannot** acquire a real notification attempt.

**Region Profile** — `RegionProfile`
All market-specific values: emergency numbers, providers, recording-consent rules,
retention, locale, pricing. Emergency numbers and recording rules resolve from
**device location**, never the account. [`specs/REGION_PROFILES.md`](specs/REGION_PROFILES.md)

**Safety Signal** — `SafetySignal`
What a model emits. It never escalates; a deterministic engine decides
([ADR-0013](adr/0013-ai-never-decides.md)).

**`safety-domain`**
The pure, dependency-free, 100%-branch-covered package holding the three state
machines and the escalation rules — imported unchanged by client **and** server, so
they cannot disagree ([ADR-0009](adr/0009-shared-safety-domain.md)).

**Activation** _(product metric)_
≥2 consented contacts **and** one completed Practice Mode run. Not signup.

**Stalkerware inversion** _(threat T2)_
The risk that Lumo's own sharing becomes a tracking tool. Mitigated by consent
re-confirmation, an always-visible sharing indicator, and no persistent background
location.

## Naming: resolved, with leftovers to know about

The product is **Lumo** (2026-10-26). Earlier names — `NeuroShield`, `InSafe`,
`guardian` — are gone from the live code and docs. Deliberate exceptions:
`docs/archive/*` and `docs/adr/0001` keep the old names because they are historical
records. The repo directory, GitHub repo and git remote are all `Lumo` as of
2026-10-27.

Unrelated naming traps that remain:

| In the code                  | Means                                                           |
| ---------------------------- | --------------------------------------------------------------- |
| `*Modal.tsx`                 | A navigator **screen** presented modally, not a `<Modal>`       |
| `/android` at the repo root  | Stray Gradle output. The real project is `apps/mobile/android/` |
| `location` on a `DangerZone` | CSS percentages, **not** latitude/longitude                     |
| `lumo.example`               | A placeholder link, not a real domain (`.example` is reserved)  |

All four are tracked in [KNOWN_ISSUES.md](audit/KNOWN_ISSUES.md).
