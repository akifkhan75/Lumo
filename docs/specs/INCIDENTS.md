# Incidents: SOS, countdown, acknowledgement and resolution

> **Safety-critical.** Implements `DET-1` `DET-2` `RES-1` `RES-2` `RES-6` `PLAT-4` (server side). State machine:
> [`SAFETY_STATE_MACHINES.md`](SAFETY_STATE_MACHINES.md) §6a. Delivery: [`NOTIFICATIONS.md`](NOTIFICATIONS.md).
> Workflow: [`EMERGENCY_WORKFLOWS.md`](EMERGENCY_WORKFLOWS.md). **Milestone 1.8a is the server; 1.8b (below, _The app_)
> is the screen.**

## The four-part contract

| Part                    | Statement                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**               | `apps/api/src/incidents` (`IncidentService` — the only writer of incident state; `EmergencyCredentialService`; the controllers).                   |
| **Supported platform**  | API. Dispatch needs the queue (`NOTIFICATIONS_QUEUE=on`); with it off, `POST /sos` refuses loudly rather than record an alert that cannot be sent. |
| **Failure path**        | Nothing is sent → the response and the incident say so (`ALL_CHANNELS_FAILED`, with who was skipped and why). The app must then offer the dialler. |
| **Testable completion** | See _Required tests_.                                                                                                                              |

## Decisions

### The server owns the countdown

The workflow used to count down on the device and then call `POST /sos`. A device-only countdown dispatches **nothing**
if the app is killed and never reopened, which the spec forbids ("never silently lost"). So: `POST /sos` is called **at
once**, creating the incident `CREATED` with a deadline (`countdownEndsAt`); a delayed job dispatches when it passes; the
device shows a countdown and can `POST /incidents/:id/cancel` until then. A killed app still alerts.

- **The server clamps the countdown by trigger**, whatever the client asks: manual 0–3 s (default 0), safeword 0–10 s
  (default 0), shake / voice / crash / fall 10 s. A buggy or hostile client cannot make a 10-minute countdown.
- Countdown 0 dispatches inside the request. Otherwise the job and `cancel` both go through the incident lock, so a
  cancel racing the deadline has exactly one winner.
- **Offline** the device cannot reach the server: it counts down locally and sends on reconnect (milestone 1.13, `OFFLINE_SOS.md`).
  The request carries `elapsedSeconds`, how long ago the press was **by the device's own stopwatch**; the server takes `now − elapsed` as the
  press time (never the phone's clock), measures the countdown from it, and **dispatches at once if the deadline has passed**. Up to 6 hours
  (`MAX_LATE_SOS_SECONDS`); beyond it the request is `400 { tooLate: true }`, nothing is sent and nothing is created. `lateBySeconds`
  (the whole elapsed time less the countdown) is stored, returned, and from two minutes **stated in every SMS, push and call**.

### Refused until they exist

`duress: true` (no device suppression until 2.5) is **refused with 400**, not accepted and ignored: it would show a ledger that must be
hidden. `mode: "practice"` is accepted (1.12, `PRACTICE_MODE.md`): it runs the whole path and contacts nobody.

### The emergency token (PLAT-4)

An **opaque random token** (not a JWT), only its SHA-256 stored, so the JWT strategy cannot accept it and it cannot be
mistaken for a login. **30 days, re-minted every time the app opens while signed in**; minting for a device revokes that
device's earlier one; at most 10 live per user; revoked on logout (`DELETE`) and from the device list.

- **Scope: act on incidents you raised** — create (`POST /sos`), cancel, resolve, and read an incident's status as **ids and
  states only** (no contact names). It reads nothing else. (This is wider than the spec's "exactly one action":
  without cancel and resolve the token could start an alert it could not stop. The route table is tested: only these routes
  accept it.)
- A phone unopened for more than 30 days falls back to the dialler.

### Region of the incident

Never a client string stored as is. It is **built** with `resolveRegion` from what the device reports (country,
subdivision, accuracy, age of the fix) and the account country. A country with no profile, or none at all, is
`UNRESOLVED`, which gates nothing and takes the strictest cap (see `NOTIFICATIONS.md`).

### Honouring the user's settings

`sendSmsOnSos` decides whether SMS is a channel; `shareLocationOnSos` decides whether a position is put in any message. Push goes
to contacts who have claimed their invite. **`sendSmsOnSos` is ON by default for new accounts (KI-83, decided)**: an SOS that
reaches nobody by default is not an SOS. SMS goes only to contacts who **agreed**, is bounded by the daily cap, and the person
can turn it off in Settings → Setup Alert. **Accounts created before this keep the value they have**, which for most is off
(the column's old default): they are not silently switched on, and are not texted until they choose to be. Someone who has SMS
off, and has no contact who has claimed their invite, still gets `ALL_CHANNELS_FAILED` and the dialler, shown plainly.

### What a message says about location

An SMS cannot update, so it states the **fix's clock time (UTC) and accuracy**, and a fix older than the freshness limit is
worded **"last known location"**. It carries a map link for that position. There is no live link until the web page (1.11).
No coordinate is ever logged.

## Endpoints

| Route                                | Auth               | Does                                                                     |
| ------------------------------------ | ------------------ | ------------------------------------------------------------------------ |
| `POST /api/v1/emergency-token`       | login              | mint (and rotate) this device's emergency token                          |
| `DELETE /api/v1/emergency-token/:id` | login              | revoke (logout)                                                          |
| `POST /api/v1/sos`                   | login **or** token | create the incident; `Idempotency-Key` required; `201`, `200` on replay  |
| `POST /api/v1/incidents/:id/cancel`  | login or token     | only while `CREATED` and before the deadline; else 409 "resolve instead" |
| `POST /api/v1/incidents/:id/resolve` | login or token     | tells the contacts whose alert was sent that it ended                    |
| `GET /api/v1/incidents/:id`          | login or token     | status and ledger (names only with a login)                              |
| `POST /api/v1/incidents/:id/ack`     | a linked contact   | "I'm responding": `ACK_RECEIVED`, halts escalation                       |
| `POST /api/v1/incidents/:id/unack`   | a linked contact   | "I can't help after all": back to the prior state                        |

**Idempotency.** The key is unique **globally**, not per user. A replay by the same user returns the existing incident
(`200`) and **never re-plans**, even with two requests at once. A key already used by another user is `409` with no data.

## Rules

- **One writer.** `IncidentService.apply` is the only code that changes incident state. In one transaction it locks the
  incident row, runs `INCIDENT_MACHINE`, appends an `IncidentEvent` (with `seq`) and updates the state. **Lock order is
  always incident, then attempt.**
- **The rollup is recomputed**, idempotently, from the attempts (purpose `ALERT` only), under the incident lock, after the
  plan and after every ledger change. It emits `ALL_SETTLED`; it **never emits an acknowledgement**.
- **Acknowledgement is an incident event, not a derived one.** An attempt stays `ACKNOWLEDGED` for good, so deriving it
  would re-acknowledge the incident after an `unack`. `ACK_RECEIVED` and `UNACK_RECEIVED` are applied only by the explicit
  actions (the receipt endpoint, `/ack`, `/unack`). After an `unack` the attempt stays acknowledged — they did acknowledge.
- **No escalation engine yet** (1.9): after the single plan nothing more is coming, so `moreStepsRemain` is **false**.
  Without the engine an incident would otherwise never leave `NOTIFYING`. When 1.9 lands this flips to "steps remain".
- **Resolve** is a second fan-out (purpose `RESOLVED`) to contacts whose alert **actually went** (the attempt reached `SENT`
  or beyond); a contact who was never alerted is not told. It is exempt from the daily cap (it is bounded by the alerts
  already sent, and leaving contacts in the dark is its own harm). The incident closes once those messages are queued;
  their own delivery is ledgered under `RESOLVED`.
- **A cap hit comes back as `capped`** in the response so the app can say so. This is the caller that must.
- The response never contains a contact's name or number for an emergency-token caller.

## The app (1.8b)

- **A press navigates to the SOS screen with its trigger** (`manual` 3 s; `shake`, `voice`, `crash` 10 s). The screen's own
  first act is to persist `{key, startedAt, trigger}` (ids and a time, no position or name) and then call `POST /sos`;
  nothing waits for anything else. Opened with no trigger (from the login or boot screens) it starts nothing and says so.
- **Phases:** requesting · counting · live · unreachable · cannot. **unreachable** (timeout, no connection, server
  error, unreadable answer) and **cannot** (credential rejected) both say "Nothing has been sent" and lead with the
  dialler. **Retry reuses the same key.** A failed refresh of an incident that exists keeps the last ledger and says how
  old it is; it is never blanked or invented.
- **Credentials:** the emergency token is tried first for raising an SOS, so it never depends on the login; on a 401 it
  falls back to the login. It is re-minted whenever the app opens signed in and removed on logout.
- **Wording** (`services/sosLedger.ts`, pure and tested): a text is "sent — not confirmed"; a push nobody confirmed is
  "we couldn't confirm it arrived"; "delivered" only on a delivery receipt; "responding" only on a person's tap. No
  aggregate tick; failures are rows of their own with a reason in words; the headline is "Sent to N · no response yet",
  never "notified".
- **Dialling:** the number resolves from the device's fix and place (not the account); an unverified one says so; a
  regional number that may not apply is "might work where you are".
- **Resume:** an SOS in progress when the app was closed is shown again on the next launch (≤ 6 hours old).

## Limits

- **Never sent to anyone real.** No providers (KI-68, KI-78, KI-82). The plan's two-device exit stays open.
- Without 1.9, one plan only: no retry ladder, no next contact on silence.
- `duress` is refused (above). `practice` is a rehearsal and sends nothing.
- UTC clock times in SMS (no timezone known for the contact).
- `sendSmsOnSos` is on for new accounts only; existing ones keep theirs (KI-83).

## Required tests

| Rule                                                                                        | Proven by        |
| ------------------------------------------------------------------------------------------- | ---------------- |
| The same `Idempotency-Key` twice creates one incident; concurrent ones plan once            | database suite   |
| Another user's key is 409 and leaks nothing                                                 | database suite   |
| Duress is refused; the countdown is clamped by trigger                                      | database suite   |
| Dispatch proceeds with no location; the message says so                                     | database suite   |
| An expired login but a valid emergency token dispatches                                     | database suite   |
| Only the SOS routes accept the emergency token; the JWT strategy rejects it                 | route-table test |
| Cancel in the window works; after the deadline or dispatch it is 409; a race has one winner | database suite   |
| The countdown job dispatches an incident whose app never returns                            | database suite   |
| A non-consented contact is never alerted, and the response names who was skipped            | database suite   |
| `sendSmsOnSos` and `shareLocationOnSos` are honoured                                        | database suite   |
| A stale fix is worded "last known"; a fresh one carries time and accuracy                   | unit             |
| Ack halts, unack restores and the recompute does not re-acknowledge                         | database suite   |
| Resolve tells only contacts whose alert went, and bypasses the cap                          | database suite   |
| The rollup reaches ALL_CHANNELS_FAILED / PARTIALLY_NOTIFIED / NOTIFIED correctly            | database suite   |
| The incident timeline is ordered by `seq`                                                   | database suite   |
