# Feature Inventory — Real vs Mock

> **Current reality.** For the _target_ feature set with phases and tiers see
> [`../product/FEATURE_CATALOG.md`](../product/FEATURE_CATALOG.md); for requirements and
> acceptance criteria see [`../product/PRD.md`](../product/PRD.md). IDs below cross-reference
> the PRD so the three documents cannot drift.
>
> "Hazard report" replaced "danger zone"
> ([ADR-0010](../adr/0010-hazard-reports-replace-danger-zones.md)). `severity` is
> gone and will not come back.

**The most important table in this repo.** Half the UI is a convincing prototype.
Nobody — human or agent — should plan work, demo the app, or describe it to a user
without knowing which half.

Verified by reading the code on 2026-10-26.

|                | Meaning                                                               |
| -------------- | --------------------------------------------------------------------- |
| ✅ **Real**    | Wired end to end: UI → API → database, or a genuine device capability |
| 🟨 **Partial** | Works, but a key part is missing or in-process only                   |
| ⛔ **Mock**    | Looks functional, does nothing                                        |

---

## Summary

| Feature                        | ID          | Status     | Where                                                               |
| ------------------------------ | ----------- | ---------- | ------------------------------------------------------------------- |
| Email + password auth          | `—`         | ✅ Real    | `AuthModule`, `AuthScreen`                                          |
| Session persistence            | `KI-4`      | 🟨 Partial | token kept in the keystore and restored on launch; no refresh token |
| Settings & profile             | `PRO-6`     | ✅ Real    | `SettingsModule`, `settings/*`                                      |
| Trusted contacts               | `RES-2/7`   | 🟨 Partial | stored; a contact can agree or withdraw via a link; never alerted   |
| Hazard report feed             | `PREV-2`    | 🟨 Partial | real data, real coordinates, not drawn                              |
| Device location (read-only)    | `RES-10`    | 🟨 Partial | foreground only, shown with age and accuracy; shared with no one    |
| Report a hazard                | `PREV-1`    | ⛔ Blocked | location now readable, but no submit UI yet                         |
| Map                            | `PREV-2`    | 🟨 Partial | real map, shows only your own fix; no hazard pins                   |
| SOS / Emergency                | `RES-1/2/3` | 🟨 Partial | real incident, countdown, ledger; never sent to a real person yet   |
| Shake to SOS                   | `DET-3`     | ✅ Real    | `useShakeDetector`                                                  |
| Voice activation               | `DET-5`     | ✅ Real    | `useVoiceActivation` (dev build only)                               |
| Crash detection                | `DET-4`     | 🟨 Partial | single 6 G threshold, no sequence analysis                          |
| Fake call                      | `RES-17`    | ✅ Real    | AI-generated script                                                 |
| AI safety assistant            | `REC-4`     | 🟨 Partial | works; no conversation memory                                       |
| Self-defense tips              | `REC-4`     | ✅ Real    | AI with fallback                                                    |
| Journey / check-in             | `RES-12/13` | 🟨 Partial | server-side deadlines and escalation; no live link for contacts yet |
| Follow Me link for contacts    | `RES-11`    | ⛔ Absent  | needs the web page (1.11)                                           |
| Community / Safe Walk          | `RES-20`    | ⛔ Mock    | local state                                                         |
| Nearby volunteers              | `RES-20`    | ⛔ Mock    | a text label                                                        |
| Audio/video evidence recording | `PRO-1`     | ⛔ Mock    | `const isRecording = false`                                         |
| Push notifications             | `RES-5`     | ❌ Absent  | not implemented at all                                              |
| Offline support                | `RES-16`    | ❌ Absent  | —                                                                   |

---

## ✅ Real

### Authentication

`POST /auth/login` and `/signup`. argon2id hashing, 7-day HS256 JWT, `JwtAuthGuard`
on every other route. The login screen ships with seed credentials prefilled
(`josim@example.com` / `password`) — remove before any public build.

Missing: email verification, password reset, refresh tokens, rate limiting, MFA,
social sign-in.

### Settings and profile

`GET`/`PUT /api/v1/settings`. Persists full name, blood type, allergies, the six
security toggles, and the trusted-contacts list. The toggles genuinely control
the sensor hooks.

Caveats: the `PUT` body is unvalidated (`body: any`) and saving contacts deletes
and recreates the whole list non-transactionally ([KI-7](KNOWN_ISSUES.md)).

### Hands-free SOS triggers

All three are real device integrations, and the best-engineered part of the app:

- **Shake** — accelerometer, > 2.5 G, 800 ms debounce
- **Crash** — accelerometer, > 6.0 G, 1000 ms debounce
- **Voice** — continuous recognition for **"Hey Lumo, emergency"** (brand variant +
  intent word, matched across all recognizer alternatives); needs a custom dev
  build, degrades silently in Expo Go

They all route to `handleActivateEmergency`, which navigates to the mock SOS
screen — so a genuine trigger leads to a fake response.

### Fake call

`FakeCallScreen` fetches a caller name and dialogue from
`GET /ai/fake-call-script` and plays an incoming-call UI. Gemini-generated, with a
local fallback script when there is no API key.

### Self-defense tips

Fetched from `GET /ai/self-defense-tips` inside the emergency screen's defense
overlay. Real network call, real fallback.

---

## 🟨 Partial

### Hazard reports

Real persistence, real community feed, **real coordinates** — and nothing that
draws them. The model now stores `latitude`/`longitude` with an optional accuracy,
expires on a per-type TTL, and counts confirmations one-per-person with a floor
below which a report influences nothing.

Two things are still missing, and both are honest in the UI rather than papered
over:

- **Reports are not pinned.** The dashboard now has a real map, but hazard pins are
  Phase 4 (they need confidence and age rules of their own), so reports are listed in
  the Community Hub rather than drawn. The dashboard does not fetch them.
- **Reporting is still unavailable.** The device can now read its position (see
  _Device location_), but the screen still offers no submit, instead of the predecessor's
  `` `${48 + Math.random() * 4}%` `` on the server.

`GET` is bounded (`take` ≤ 200) but is still not a proximity query, because that
also needs the device's own position. ([KI-2](KNOWN_ISSUES.md))

### Trusted contacts

Stored, editable, validated-ish. Then unused: the emergency screen renders a
**hardcoded** ring (`Police`, `EMS`, `Mom`, `Security`, `Dad`, `Guard`), and
`sendSmsOnSos` / `shareLocationOnSos` are read from the database by nothing.

### AI safety assistant

`POST /ai/safety-chat` works. But `history` is accepted by the client and the
service and then never added to the prompt, so every turn is stateless — the
assistant cannot follow up. ([KI-14](KNOWN_ISSUES.md))

### Check-in timer

The countdown is genuine and does call `onEmergency()` at zero. Two limits: it
lands on the mock SOS screen, and the `setInterval` lives in the screen — so
navigating away, backgrounding, or the OS killing the app cancels the escalation
silently. A check-in that only works while you are watching it is not a safety
feature; it belongs on the server.

---

## ⛔ Mock

### SOS / Emergency — built, never run against a real person

_(Listed under Mock because the rest of this section still is. This one is no longer a screenshot.)_

A press goes **straight to the server**, which owns the countdown (3 s for the button, 10 s for shake, voice and
crash; it is clamped server-side) and dispatches even if the app is killed. The screen says **"Nothing has been
sent"** until the server says otherwise, shows the seconds and a large **Cancel**, then lists **each contact on their
own** with the most that is true (a text is "sent — not confirmed", never "delivered"; only a person's tap is
"responding"). If the request does not complete it says nothing was sent, puts the **dialler first**, and retries with
the same key so a request that did get through is not duplicated. **Nobody reached** is a full screen. A daily-limit
hit is said out loud. "I'm safe" ends the alert and the contacts who were actually alerted are told. The number to
dial follows where the **device** is (911 in the US, 15 in Punjab, with the regional number marked "might work"), and
an unverified number says so. The app keeps a fresh emergency token whenever it opens signed in, and shows an SOS that
was in progress when it was last closed.

**What it does not do:** nothing has been sent to a real person (no Twilio or Expo account), the app cannot yet
register for push or claim a contact invite (KI-78), so **with default settings (SMS off) a typical SOS ends "nobody
was reached"** (KI-83). No retry ladder (1.9), no offline queue (1.13), no duress or practice mode, no recording,
nothing on a device (Jest only). Copy has had no screen-reader or text-scaling pass (1.14). Spec:
`docs/specs/INCIDENTS.md`; gaps KI-83 – KI-92.

### Follow Me (the live link)

There is no link a contact can open: that is the web page of milestone 1.11. The old placeholder link (a constant) and the screen that
pretended to share are gone. What replaced them is the Journey screen below, which does not claim anyone follows you.

### Community / Safe Walk

`requestStatus` is `useState<'idle' | 'pending' | 'accepted'>`. There is no
backend, no volunteer directory, no second user.

### The map

`react-native-maps` (Apple Maps on iOS, Google Maps on Android). It draws one thing:
the device's own fix, as a marker with its accuracy circle (grey when the fix is stale),
and only when a usable fix exists. With none it shows a world view and says the position
isn't known. No hazard pins, no journeys. A map is not screen-reader operable; the text
line from _Device location_ is the equivalent. The Android map needs a Google Maps key
(KI-60). Not yet run on a device.

### Trusted contacts and consent

A contact must agree before they could ever be alerted, and the **contact** is the one who agrees.
For each saved contact the user can get a link (the phone's share sheet; **Lumo sends nothing**).
The contact opens it in any browser, sees who is asking and what is not happening yet, and agrees —
once, even under concurrent taps — or later withdraws with the same link, immediately. Changing a
contact's number or email, or removing them, ends any outstanding link and revokes consent, so a
link sent to the old number cannot grant consent for the new one. Numbers are stored as E.164;
a local number needs the user's region (no country is ever assumed). A pure `resolveRecipients`
returns who is eligible and who is skipped, each skip with a reason.

**What it does not do:** no alert is ever sent (no SMS, push or email path exists), so "Agreed"
means only "willing". The server cannot tell the contact from the account holder using the same
link (KI-62). The consent page is a stopgap for the web app (1.11). Circles are not built (KI-66).
Spec: `docs/specs/TRUSTED_CONTACTS.md`; gaps KI-62 – KI-66. Not run on a device.

### Delivery ledger and SMS (milestone 1.7a)

The plumbing that will carry an alert, with nothing yet raising one. A durable queue (pg-boss, same
Postgres) whose jobs are enqueued **in the same transaction** as the attempt row; a single ledger writer
that runs every state change through the state machine's channel guards and appends an event; an SMS
worker that claims an attempt before sending so a redelivered job can never send twice; consent re-checked
at send time; and a signature-verified Twilio status webhook that handles duplicate, early and out-of-order
callbacks. Every way a send can fail or be skipped is a ledger row that says why — including "no
credentials", which is never recorded as accepted. An SMS that was accepted but never got a receipt is
**"delivery unconfirmed" (UNKNOWN)**, not "delivered" and not "failed".

**Also (1.7b-1):** **region gating** (a channel off in a market is ledgered as such; US SMS/voice wait for A2P
10DLC registration, by the _incident's_ region), a **per-user daily cap per channel** reserved under a lock (the
rest of a fan-out are "capped", budget going to contacts in priority order), and **voice** calls (answered is a
fact on the attempt, never an acknowledgement).

**What it does not do:** nothing creates an incident yet (1.8), so nothing is sent to anyone. It has **never
run against real Twilio** (no account), so the plan's exit — a real SMS recorded as UNKNOWN with receipts
disabled — is **not met**. **Push (1.7b-2, server side):** a contact who claims their invite while signed in is linked to their account (never inferred from a phone or email); a push token belongs to one user at a time; push goes to the linked account's devices; a push nobody confirms is "sent, not confirmed"; only the linked account's device can report delivery or acknowledge. **The app does not do its half yet** (no token registration, no claim screen, no receipts), so in practice no contact can be reached by push and nothing can reach "delivered" that way. At-most-once has a crash window (KI-67). Spec: `docs/specs/NOTIFICATIONS.md`; gaps KI-67 – KI-82.

### Incidents and SOS (milestone 1.8a, server only)

`POST /sos` creates an incident, answers at once, and the **server** runs the countdown (a manual SOS 0–3 s, an automatic
trigger 10 s, clamped whatever the client asks), so an app killed mid-countdown still alerts. It then resolves the
recipients (consent re-checked), applies region gating and the daily cap, plans the attempts, and the incident moves with
its ledger: notifying → notified / partially notified / **all channels failed**, with the contacts who were skipped or
capped named in the response. Cancel works only inside the countdown; after that the person **resolves**, which tells only
the contacts whose alert actually went. A linked contact's "I'm responding" acknowledges it; "I can't help after all"
restores it. An **emergency token** (opaque, 30 days, re-minted on use) lets an SOS dispatch with an expired login and can
do nothing else. A position goes into a message only if the user allows it, worded with its time and precision, "last
known" when stale.

**What it does not do:** the app has none of it yet (1.8b), nothing has been sent to a real person (no provider accounts),
there is no escalation ladder (1.9), and practice and duress are refused. **With the default settings SMS is off, so a user
who has not opted in and has no contact who claimed their invite gets "all channels failed"** (KI-83). Spec:
`docs/specs/INCIDENTS.md`; gaps KI-83 – KI-88.

### Push and joining as a contact (milestone 1.8c, app)

A person can now be the contact: **Settings → Being a contact** lets them paste the link (or the whole message) they were sent
and join from their signed-in account, and turn on alerts on their phone (a button; nothing prompts by itself). An alert tapped
opens a screen with one decision, **I'm responding**, reported to the server, and it says only what the server answered. A
notification that arrives while Lumo is open, or is tapped, is reported as received; one that arrives while it is closed is not
and will read "sent, not confirmed" to the sender. Logging out revokes the phone's registration.

**What it does not do:** never run on a device or with a real push project (KI-97); no background or killed-app receipts, and no
iOS notification extension (1.16); "I can't help after all" has no button (the alert carries no incident id, KI-98); a link
followed while signed out is lost (KI-99). Spec: `docs/specs/NOTIFICATIONS.md` ("The app's half of push"); gaps KI-97 – KI-100.

### Escalation ladder (milestone 1.9, server)

An SOS now follows a plan rather than alerting everyone at once: the first contact, then, if the step times out or every
attempt in it failed, the next, and so on, within a limit on how many people are alerted. A step that only failed does not
wait out its timer; one that was **sent but unconfirmed does**, because it may yet arrive. An acknowledgement halts the plan;
"I can't help after all" resumes it from the step in flight without re-alerting anyone; ending the alert stops it for good.
Without a stored plan one is derived from the person's contacts in priority order. The plan is readable in plain words before
anything runs (`GET /escalation-policy`) and editable (`PUT`), is frozen onto each incident when it starts, and its timers are
queue jobs that survive a restart.

**What it does not do:** no screen for the plan in the app (KI-95); never run with real providers; a manual SOS reaches the
third contact onward only after the step before gives way (the first two are alerted together, KI-93 decided); per-template defaults wait for sessions (1.10); channels within a
step go in parallel, not as a fallback chain (2.4). Spec: `docs/specs/ESCALATION_POLICY.md` ("As executed"); gaps KI-93 – KI-96.

### Device location

`expo-location`, foreground only: permission is read at launch and asked only when
the user taps "Show my location". While the dashboard is focused and the app is in
the foreground it shows the newest fix with its age and accuracy ("Location 9:41 PM
(2 minutes ago), ±18 m"); past five minutes it is "Last known location" and says it is
not where you are now. A reading with unknown accuracy is discarded, never shown as
precise. The country is worked out by the platform's reverse geocoder and attached to
the fix it came from; if that fails the screen says so.

**What it does not do:** it uploads nothing and shares with no one (no session or
incident exists to attach a position to), keeps nothing across a restart, and reads
nothing while the app is closed or in the background. The generated Android manifest
holds no background-location permission. Not yet run on a device. Spec:
`docs/specs/LOCATION.md`; gaps: KI-56 – KI-59.

---

## ❌ Absent entirely

Push notifications · sharing a position with anyone ·
real-time transport (no WebSocket) · offline queue · SMS/telephony · audio or
video capture · background execution · wearable support · emergency-service
integration · crash/analytics reporting · i18n · dark mode
(`userInterfaceStyle: "light"`) · accessibility labels.

---

## What this means for planning

The engineering quality is high where the app is real — the sensor hooks, the
module boundaries, the shared types, the AI fallbacks and the test suites are all
solid. The gap is not craft, it is that the **response** half of the product was
built as UI first.

So the highest-leverage sequence is narrow: give the system real coordinates, then
make SOS actually reach someone. Those two unlock Follow Me, community help, and
proximity alerts, which are the features that would actually differentiate this
from Google's Personal Safety app. See [ROADMAP.md](../product/ROADMAP.md) and
[COMPETITIVE_ANALYSIS.md](../gtm/COMPETITIVE_ANALYSIS.md).
