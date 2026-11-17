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
- Not yet: the app entry, banner and offline run (1.12b), and onboarding step 4 and the activation metric (KI-118).
