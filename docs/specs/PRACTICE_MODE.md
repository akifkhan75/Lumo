# Practice Mode

> Implements RES-18. Counts toward **activation**. Nobody else does this well.

## Why

Two reasons, both load-bearing:

1. **Users do not trust an untested safety button**, and discovering it does not work
   during an emergency is the worst possible time.
2. It is the only safe way to exercise the real pipeline. Simulated emergencies with
   live responders are irresponsible; Practice Mode is the product-grade equivalent of
   the pilot protocol.

## What it exercises

Trigger → countdown → incident creation → location acquisition → recipient resolution
→ channel resolution → **the full Delivery Ledger** → resolve → timeline.

## What it must never do

Contact anyone — no push, SMS, voice, or email leaves the system · create a billable
message · appear in real incident history or metrics · be confusable with a real
incident.

## Guarantees

- A persistent, unmistakable banner: **"Practice — nobody will be contacted"**
- `incident.mode = 'practice'`, enforced at the notification boundary: a practice
  incident **cannot** acquire a real `NotificationAttempt`. Enforced in code, not
  convention, and unit-tested
- Ledger rows are simulated and labelled as such, showing plausible per-channel states
  including a simulated failure, so the user learns to read the real thing
- Excluded from the north-star metric and from spend
- Available offline, with the offline messaging shown

## In onboarding

Step 4 of 5, and **activation is not complete without it** (PRD §7). An installed app
with contacts but no practice run is an untested safety device.

## Tests

No provider call of any kind is made · a practice incident cannot create a real
attempt (boundary test) · excluded from metrics and spend · banner always present ·
works offline · cannot be confused with a real incident in history.

## As built (1.12a: server)

`POST /api/v1/sos` with `mode: "practice"` creates an incident that runs the real trigger, countdown, location, recipient and channel
resolution, and the real incident state machine, then writes a **simulated** ledger. It is the same request an SOS makes, so the same
countdown, cancel and resolve work; only the sending is different.

- **Three boundaries, so no one mistake can contact a real person.** (1) `DispatchService` throws `PracticeBoundaryError` for a practice
  incident; (2) the send worker settles any attempt of one as never attempted, before a provider is reached; (3) a database trigger refuses
  a `NotificationAttempt` row for a practice incident, whatever wrote it. A second trigger makes an incident's `mode` immutable, so a
  rehearsal can never become real.
- **A separate ledger.** Rows go to `PracticeAttempt`, which no worker reads and which is never queued, costed or counted against the spend
  cap. The view marks the incident `mode: "practice"` and every row `simulated: true`; the failure's reason is `SIMULATED_FAILURE`.
- **The simulation is `simulatePractice` in `@lumo/safety-domain`** (pure, deterministic), so the server and the app's offline fallback show
  the same thing. Push shows DELIVERED (a device receipt), other channels SENT (all they can say). With two or more attempts the last is a
  simulated failure; a contact who may not be alerted is shown as not tried, with the real reason.
- No position is kept (only that one was available), no journey is linked, resolving tells nobody, and a contact cannot see a rehearsal.
- Not yet: onboarding step 4 and the activation measure (KI-118), and an entry point beyond Settings (KI-119).

## As built (1.12b: the app)

**Settings → Practise an emergency** opens its own screen (`PracticeScreen`), not the SOS screen with a flag, so nothing real can leak into it.

- **The banner "Practice — nobody will be contacted"** (the spec's words) is on screen in every state: before starting, counting down, the
  result, offline and signed out. The screen is deliberately not the emergency screen's colour.
- **No dialler.** The screen has no control that opens the phone dialler, so a rehearsal cannot place a call. A plainly labelled red
  button, "Need real help? Open the emergency screen", opens the REAL screen (which starts nothing by itself).
- **It never touches the saved "SOS in progress" record** (`useSos` with `practice`): a rehearsal cannot be resumed as a real alert and
  cannot clear a real one.
- **A 3 s countdown with Cancel**, as a real manual SOS has, then the simulated ledger. Every row is marked "(practice)", the headline is
  "Practice: …", and the example failure is explained in words.
- **Offline.** If Lumo cannot be reached, the same run happens on the phone from the saved contacts, using the SAME `simulatePractice` as
  the server and no network call at all; the screen says it ran on the phone and what that would mean for a real alert. Signed out, it says
  practice needs an account and invents nothing. With no contact who agreed, it shows "nobody to try", as a real SOS would, not a success.
