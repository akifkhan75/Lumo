# Safety State Machines

> **Safety-critical.** Changes require review against [`../engineering/THREAT_MODEL.md`](../engineering/THREAT_MODEL.md)
> and [`../engineering/TEST_MATRIX.md`](../engineering/TEST_MATRIX.md).
> Implemented in `packages/safety-domain` — pure, no I/O — and imported unchanged by
> `apps/api` and `apps/mobile`. See [ADR-0008](../adr/0008-three-state-machines.md),
> [ADR-0009](../adr/0009-shared-safety-domain.md).

## Why three machines

The original strategy sketch had one machine spanning journey and emergency. It must
be split, because the two have different lifetimes, authority and failure semantics:

- **An overdue journey is not an emergency.** Conflating them means every late bus
  escalates like an assault.
- **An SOS can exist with no journey at all.**
- **A notification's fate is independent of both** — a delivered SMS to one contact
  and a failed push to another are simultaneous truths about one incident.

So: `SafetySession` (the plan), `EmergencyIncident` (the response),
`NotificationAttempt` (the delivery). One session may raise zero or more incidents;
one incident has many attempts.

---

## 1. SafetySession

A user-initiated plan with an expected outcome: a journey, a check-in, an activity.

```
            ┌──────────┐
            │ CREATED  │  session configured, not yet started
            └────┬─────┘
                 │ start()
            ┌────▼─────┐
     ┌──────│  ACTIVE  │──────┐ arrive()
     │      └────┬─────┘      │
     │           │ deadline   ▼
     │           │        ┌─────────┐    close()   ┌────────┐
     │           │        │ ARRIVED │─────────────►│ CLOSED │
     │           │        └─────────┘              └────────┘
     │      ┌────▼──────────────┐                      ▲
     │      │  CHECK_IN_DUE     │  user prompted        │
     │      └────┬──────────────┘                       │
     │           │ no response                          │
     │      ┌────▼──────────────┐  respond()            │
     │      │  GRACE            │───────────────────────┤
     │      └────┬──────────────┘                       │
     │           │ grace expired                        │
     │      ┌────▼──────────────┐  resolve()            │
     │      │  ESCALATING       │───────────────────────┤
     │      └────┬──────────────┘                       │
     │           │ raises ──────► EmergencyIncident     │
     │           │                                      │
     │      ┌────▼──────────────┐                       │
     │      │  ALERTED          │───────────────────────┘
     │      └───────────────────┘
     │
     ├──► SUSPENDED   connectivity lost; timers run locally,
     │                remote delivery NOT guaranteed
     ├──► CANCELLED   user ended it deliberately
     └──► EXPIRED     abandoned without resolution
```

### States

| State          | Meaning                                                                                                                       | Remote delivery guaranteed?   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `CREATED`      | Configured, not started. No monitoring.                                                                                       | n/a                           |
| `ACTIVE`       | Monitoring. Location shared per permission.                                                                                   | Yes, when connected           |
| `CHECK_IN_DUE` | Deadline reached; user prompted. Nobody else notified yet.                                                                    | Yes                           |
| `GRACE`        | User-configurable window before escalation. **Must not be zero by default** — an ordinary delay is not evidence of an attack. | Yes                           |
| `ESCALATING`   | Grace expired; policy running. Raises an incident.                                                                            | Yes                           |
| `ALERTED`      | An incident exists and owns the response.                                                                                     | Delegated to incident         |
| `ARRIVED`      | Destination or completion detected/confirmed.                                                                                 | Yes                           |
| `CLOSED`       | Terminal. Contacts informed of the outcome.                                                                                   | Yes                           |
| `SUSPENDED`    | **No connectivity.** Timers continue locally; the user is told plainly that contacts cannot currently be reached.             | **No — must be stated in UI** |
| `CANCELLED`    | User ended it. Contacts told it ended normally.                                                                               | Yes                           |
| `EXPIRED`      | No resolution and no escalation possible (e.g. permissions revoked). Logged, contacts informed.                               | Best effort                   |

### Invariants

1. `GRACE` default is **≥ 5 minutes** and user-configurable. A zero grace period
   turns traffic into an emergency.
2. `SUSPENDED` **must** surface in the UI. The single worst failure mode is a user
   believing contacts are watching while the phone is offline.
3. Entering `ESCALATING` is the only path to raising an incident from a session.
4. `ARRIVED` requires either detection **or** user confirmation — never a timer alone.
5. Every transition records `at`, `by` (`user` | `system` | `policy`), and the
   triggering `reason`.
6. A session may be `SUSPENDED` from any live state and returns to the state it left.

---

## 2. EmergencyIncident

Created by an explicit SOS, an escalated session, or a confirmed automatic trigger.
This machine owns the response.

```
┌─────────┐
│ CREATED │ idempotency key assigned; trigger type recorded
└────┬────┘
     │  (countdown, if the trigger was automatic)
     │      │ cancel() ─────────────► CANCELLED
     ▼
┌──────────┐  best available fix; may be stale or absent
│ LOCATING │  NEVER blocks dispatch
└────┬─────┘
     ▼
┌─────────────┐  resolve recipients + channels from policy & region profile
│ DISPATCHING │
└────┬────────┘
     ▼
┌───────────┐  attempts in flight
│ NOTIFYING │
└────┬──────┘
     │
     ├─ some succeeded ──► PARTIALLY_NOTIFIED ──┐
     ├─ all succeeded   ──► NOTIFIED ───────────┤
     └─ all failed      ──► ALL_CHANNELS_FAILED │
                                   │            │
                                   │            ▼
                                   │      ┌──────────────┐
                                   │      │ ACKNOWLEDGED │ a human responded
                                   │      └──────┬───────┘
                                   │             ▼
                                   │      ┌───────────┐   ┌────────┐
                                   └─────►│ RESOLVING │──►│ CLOSED │
                                          └───────────┘   └────────┘
```

### States

| State                 | Meaning                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `CREATED`             | Incident exists. Trigger type and idempotency key recorded.                                                              |
| `LOCATING`            | Acquiring the best available fix. **Time-boxed; never blocks dispatch.**                                                 |
| `DISPATCHING`         | Recipients and channels resolved.                                                                                        |
| `NOTIFYING`           | Attempts in flight.                                                                                                      |
| `PARTIALLY_NOTIFIED`  | At least one channel reached its maximum truthful state; at least one failed. **Rendered as partial, never as success.** |
| `NOTIFIED`            | Every attempt reached its channel's maximum truthful state.                                                              |
| `ALL_CHANNELS_FAILED` | Nothing got out. **Must be shown prominently with the next action for the user.**                                        |
| `ACKNOWLEDGED`        | A human confirmed they are responding. The only state meaning _help knows_.                                              |
| `RESOLVING`           | User indicated safety; winding down.                                                                                     |
| `CLOSED`              | Terminal. Timeline sealed and exportable.                                                                                |
| `CANCELLED`           | Cancelled within the countdown, or by duress-aware cancel.                                                               |

### Invariants

1. **`LOCATING` never blocks dispatch.** An incident with no fix still alerts, with
   "location unavailable" — which is more useful than silence.
2. **A stale fix is never presented as current.** Every location carries its
   timestamp and accuracy; the UI shows age.
3. **`NOTIFIED` ≠ acknowledged.** Only `ACKNOWLEDGED` means a human knows.
4. **`ALL_CHANNELS_FAILED` must never render as success** (PLAT-9).
5. Dispatch **must not** depend on a valid session token — see PLAT-4 and the
   emergency token in [`API_SPEC.md`](API_SPEC.md).
6. Dispatch **must not** wait on a queue, an AI job, or evidence upload.
7. `CANCELLED` is reachable only during the countdown. After dispatch, the user
   _resolves_ rather than cancels — contacts already have the alert and must be told
   it ended.
8. **Duress-aware cancel:** if the cancel used the duress code, the UI shows
   cancellation while the incident silently proceeds. The real state is never
   rendered on the device.

### Countdown

| Trigger              | Countdown                          | Rationale                               |
| -------------------- | ---------------------------------- | --------------------------------------- |
| Manual SOS button    | 0–3s, configurable                 | Deliberate act; a long delay is harmful |
| Shake                | 10s default                        | Moderate false-positive rate            |
| Crash/fall           | 10s default                        | Advisory only; confirmation required    |
| Wake word / safeword | 10s default; safeword may be 0     | A safeword is deliberate                |
| Audio event signal   | **Never auto-escalates**           | Emits a signal; requires confirmation   |
| Missed check-in      | Grace window acts as the countdown | Already elapsed                         |

---

## 3. NotificationAttempt

**One per recipient per channel.** The unit of truth behind the Delivery Ledger.

```
┌────────┐
│ QUEUED │ durably persisted before any provider call
└───┬────┘
    ▼
┌──────┐   provider accepted
│ SENT │
└───┬──┘
    ├──► DELIVERED ──► ACKNOWLEDGED   (only on channels that can report it)
    ├──► FAILED        provider rejected / unreachable → triggers fallback
    ├──► EXPIRED       TTL elapsed with no progress
    └──► UNKNOWN       channel cannot report further; terminal but not success
```

Full semantics, the channel capability matrix, and UI rendering rules are in
[`DELIVERY_LEDGER.md`](DELIVERY_LEDGER.md).

---

## 4. Idempotency

The scenario this prevents: a phone loses signal, retries an SOS three times, and
creates three incidents, three fan-outs and three sets of SMS charges.

```
idempotencyKey = sha256(userId + triggerType + floor(triggerAtMs / 60000) + sessionId?)
```

- Minted **on the device** before the first attempt, so all retries share it.
- A repeat key returns the **existing** incident with HTTP `200`, not a new one.
- `NotificationAttempt` is also keyed on `(incidentId, recipientId, channel)` so a
  queue redelivery cannot double-send.
- The one-minute bucket is deliberate: two genuinely separate activations within
  60 seconds collapse into one incident. That is the correct trade — a duplicate
  alert storm is worse than a merged incident.
- **The fields are joined with U+001F, not `+`.** Plain concatenation is ambiguous:
  `("ab","c")` and `("a","bc")` would hash identically. A field containing the separator,
  or a non-finite timestamp, is refused rather than hashed.
- **What the key does, precisely:** it collapses _retries of one activation_ — the same
  `triggerAtMs` always yields the same key, however skewed the device clock. It does
  **not** merge two separate activations: the bucket has a boundary, so two triggers two
  seconds apart that straddle it get different keys. "Two triggers within 60 s → one
  incident" (§7) therefore needs a server-side rule as well — an open incident absorbing
  a new trigger. See KNOWN_ISSUES.

---

## 5. Offline reconciliation

When a `SUSPENDED` session or a locally queued incident regains connectivity:

1. Replay queued events **in original occurrence order**, each carrying its true
   `occurredAt` — never the sync time.
2. Deduplicate by idempotency key; the server is authoritative.
3. If the server already advanced the incident, the client adopts server state.
4. If a local escalation fired while offline and its deadline has now long passed,
   the server **still dispatches** and marks the delay explicitly. A late alert beats
   no alert; the recipient is told how old it is.
5. Transitions illegal on arrival are logged as `RECONCILIATION_CONFLICT` and
   surfaced in the incident timeline — never silently dropped.

**Because client and server share `packages/safety-domain`, they cannot disagree
about which transitions are legal.** That is the entire point of PLAT-7.

---

## 6. Transition legality

Enforced in one place — `safety-domain/transitions.ts` — and tested exhaustively:
every (state × event) pair is either a defined transition or an explicit rejection.
There is no default-allow.

```ts
type Actor = "user" | "system" | "policy" | "contact";

interface Transition<S, E> {
  from: S;
  event: E;
  to: S;
  guard?: (ctx: Ctx) => boolean;
  actor: Actor[]; // who may cause it
  effects?: Effect[]; // declared, executed by the caller — never inside the machine
}
```

The machine is a **pure reducer**. It never performs I/O, never sends a
notification, and never reads a clock — time is injected. That is what makes it
100% branch-testable and identical on both client and server.

---

## 6a. Transition tables — the normative definition

These tables are the specification of `safety-domain/transitions.ts`. **There is no
default-allow:** any (state × event) pair absent from a table is an explicit
rejection, returning a typed error and logging an `ILLEGAL_TRANSITION` event.

`Actor` — who may cause it: `user` · `system` · `policy` · `contact`.
`Effects` are **declared, not executed** — the caller performs them (ADR-0009).

### SafetySession

| From           | Event                       | To             | Actor        | Guard                                                        | Effects                                                         |
| -------------- | --------------------------- | -------------- | ------------ | ------------------------------------------------------------ | --------------------------------------------------------------- |
| `CREATED`      | `START`                     | `ACTIVE`       | user         | has ≥1 consented contact                                     | `startTimers`, `notifyContactsSessionStarted`                   |
| `CREATED`      | `CANCEL`                    | `CANCELLED`    | user         | —                                                            | —                                                               |
| `ACTIVE`       | `CHECK_IN_DEADLINE_REACHED` | `CHECK_IN_DUE` | system       | —                                                            | `promptUser`                                                    |
| `ACTIVE`       | `ARRIVAL_DETECTED`          | `ARRIVED`      | system       | within destination geofence                                  | `stopTimers`                                                    |
| `ACTIVE`       | `ARRIVAL_CONFIRMED`         | `ARRIVED`      | user         | —                                                            | `stopTimers`                                                    |
| `ACTIVE`       | `DEVIATION_DETECTED`        | `ACTIVE`       | system       | persists > `deviationGraceSeconds` **and** outside GPS error | `promptUserDiscreetly`                                          |
| `ACTIVE`       | `SOS_RAISED`                | `ALERTED`      | user         | —                                                            | `raiseIncident(trigger)`                                        |
| `ACTIVE`       | `CONNECTIVITY_LOST`         | `SUSPENDED`    | system       | —                                                            | `recordPriorState`, `showOfflineNotice`                         |
| `ACTIVE`       | `CANCEL`                    | `CANCELLED`    | user         | —                                                            | `notifyContactsEnded`                                           |
| `ACTIVE`       | `EXPIRE`                    | `EXPIRED`      | system       | no resolution possible (e.g. permission revoked)             | `notifyContactsExpired`                                         |
| `CHECK_IN_DUE` | `USER_RESPONDED`            | `ACTIVE`       | user         | —                                                            | `rescheduleDeadline`                                            |
| `CHECK_IN_DUE` | `NO_RESPONSE`               | `GRACE`        | system       | prompt unanswered                                            | `startGraceTimer`                                               |
| `CHECK_IN_DUE` | `ARRIVAL_CONFIRMED`         | `ARRIVED`      | user         | —                                                            | `stopTimers`                                                    |
| `CHECK_IN_DUE` | `CONNECTIVITY_LOST`         | `SUSPENDED`    | system       | —                                                            | `recordPriorState`                                              |
| `CHECK_IN_DUE` | `CANCEL`                    | `CANCELLED`    | user         | —                                                            | `notifyContactsEnded`                                           |
| `GRACE`        | `USER_RESPONDED`            | `ACTIVE`       | user         | —                                                            | `rescheduleDeadline`                                            |
| `GRACE`        | `GRACE_EXPIRED`             | `ESCALATING`   | system       | `graceSeconds` elapsed                                       | `beginEscalation(policy)`                                       |
| `GRACE`        | `ARRIVAL_CONFIRMED`         | `ARRIVED`      | user         | —                                                            | `stopTimers`                                                    |
| `GRACE`        | `CONNECTIVITY_LOST`         | `SUSPENDED`    | system       | —                                                            | `recordPriorState`                                              |
| `GRACE`        | `CANCEL`                    | `CANCELLED`    | user         | —                                                            | `notifyContactsEnded`                                           |
| `ESCALATING`   | `USER_RESPONDED`            | `ACTIVE`       | user         | no incident raised yet                                       | `haltEscalation`, `rescheduleDeadline`                          |
| `ESCALATING`   | `ARRIVAL_CONFIRMED`         | `ARRIVED`      | user         | no incident raised yet                                       | `haltEscalation`                                                |
| `ESCALATING`   | `INCIDENT_RAISED`           | `ALERTED`      | system       | —                                                            | —                                                               |
| `ALERTED`      | `INCIDENT_RESOLVED`         | `CLOSED`       | user, system | incident is terminal                                         | `notifyContactsResolved`                                        |
| `ALERTED`      | `ARRIVAL_CONFIRMED`         | `CLOSED`       | user         | —                                                            | `resolveIncident`, `notifyContactsResolved`                     |
| `ARRIVED`      | `CLOSE`                     | `CLOSED`       | system       | —                                                            | `notifyContactsArrived`                                         |
| `SUSPENDED`    | `CONNECTIVITY_RESTORED`     | _`priorState`_ | system       | —                                                            | `reconcileQueue`                                                |
| `SUSPENDED`    | `ARRIVAL_CONFIRMED`         | `ARRIVED`      | user         | —                                                            | `queueArrivalNotice`                                            |
| `SUSPENDED`    | `CANCEL`                    | `CANCELLED`    | user         | —                                                            | `queueEndNotice`                                                |
| `SUSPENDED`    | `GRACE_EXPIRED`             | `ESCALATING`   | system       | —                                                            | `queueEscalation` — dispatched on reconnect, **marked delayed** |

Terminal: `CLOSED` · `CANCELLED` · `EXPIRED`.
`SUSPENDED` stores `priorState`; `CONNECTIVITY_RESTORED` returns to it, except where a
queued event has since advanced the machine.

**Deliberate rejections** — each is a safety decision, not an omission:

| Rejected                                  | Why                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ARRIVED → *` (anything but `CLOSE`)      | Arrival is final; a new journey is a new session                                                |
| `CLOSED`/`CANCELLED`/`EXPIRED` → anything | Terminal. Reopening would corrupt the audit record                                              |
| `CREATED → CHECK_IN_DUE`                  | A session that never started has no deadline                                                    |
| `ACTIVE → ESCALATING`                     | Must pass through `CHECK_IN_DUE` and `GRACE`. Skipping grace is how an app escalates a late bus |
| `SUSPENDED → SUSPENDED`                   | Idempotent no-op, not a transition                                                              |

### EmergencyIncident

| From                                                                                 | Event                 | To                    | Actor   | Guard                                | Effects                                    |
| ------------------------------------------------------------------------------------ | --------------------- | --------------------- | ------- | ------------------------------------ | ------------------------------------------ |
| `CREATED`                                                                            | `CANCEL`              | `CANCELLED`           | user    | within countdown **and** not duress  | `stopCountdown`                            |
| `CREATED`                                                                            | `DURESS_CANCEL`       | `LOCATING`            | user    | duress code matched                  | `markDuress`, `suppressAllDeviceUi`        |
| `CREATED`                                                                            | `COUNTDOWN_ELAPSED`   | `LOCATING`            | system  | —                                    | `startLocationFix(timeout)`                |
| `CREATED`                                                                            | `COUNTDOWN_SKIPPED`   | `LOCATING`            | user    | manual SOS or safeword               | —                                          |
| `LOCATING`                                                                           | `LOCATION_ACQUIRED`   | `DISPATCHING`         | system  | —                                    | `attachLocation`                           |
| `LOCATING`                                                                           | `LOCATION_TIMEOUT`    | `DISPATCHING`         | system  | — (never blocks; see below)          | `markLocationUnavailable`                  |
| `DISPATCHING`                                                                        | `RECIPIENTS_RESOLVED` | `NOTIFYING`           | system  | ≥1 consented recipient               | `createAttempts`                           |
| `DISPATCHING`                                                                        | `NO_RECIPIENTS`       | `ALL_CHANNELS_FAILED` | system  | zero consented recipients            | `promptUserToDial`                         |
| `NOTIFYING`                                                                          | `ATTEMPT_SETTLED`     | `NOTIFYING`           | system  | something still to come              | `updateLedger`                             |
| `NOTIFYING`                                                                          | `ALL_SETTLED`         | `NOTIFIED`            | system  | all reached; nothing left to run     | `updateLedger`                             |
| `NOTIFYING`                                                                          | `ALL_SETTLED`         | `PARTIALLY_NOTIFIED`  | system  | some reached, some failed; none left | `updateLedger`                             |
| `NOTIFYING`                                                                          | `ALL_SETTLED`         | `ALL_CHANNELS_FAILED` | system  | nobody reached; nothing left to run  | `pageOnCall`, `promptUserToDial`           |
| `NOTIFYING`                                                                          | `STEP_TIMEOUT`        | `NOTIFYING`           | policy  | more steps remain                    | `advanceEscalationStep`                    |
| `NOTIFYING`, `PARTIALLY_NOTIFIED`, `NOTIFIED`, `ALL_CHANNELS_FAILED`                 | `ACK_RECEIVED`        | `ACKNOWLEDGED`        | contact | —                                    | `haltEscalation`, `notifyUserOfAck`        |
| `ACKNOWLEDGED`                                                                       | `UNACK_RECEIVED`      | _`priorState`_        | contact | —                                    | `resumeEscalation`                         |
| `NOTIFYING`, `PARTIALLY_NOTIFIED`, `NOTIFIED`, `ALL_CHANNELS_FAILED`, `ACKNOWLEDGED` | `RESOLVE`             | `RESOLVING`           | user    | —                                    | `haltEscalation`, `notifyContactsResolved` |
| `RESOLVING`                                                                          | `CLOSE`               | `CLOSED`              | system  | —                                    | `sealTimeline`                             |

Terminal: `CLOSED` · `CANCELLED`.

**How the guards in this table are read** (as built in `packages/safety-domain`):

- **"Something still to come"** means attempts are in flight **or** a later escalation step has not run yet. `ALL_SETTLED` additionally requires that no step remains. Without that, a first step whose recipients all failed would settle the incident as `ALL_CHANNELS_FAILED` — full-screen alarm, on-call paged — while the next step has not even been dispatched. The original wording ("attempts still pending", "none succeeded") did not say so.
- **Reached** is counted **per recipient**, not per attempt. A fallback is a new attempt on the same recipient, so "push failed, then SMS sent" is a recipient who was reached.
- **`LOCATION_TIMEOUT` has no guard.** It was written "≤5s elapsed"; any guard on elapsed time could let a skewed clock stall an emergency. The time box is `LOCATING_TIMEBOX_MS` (5 s); the caller owns the timer. Dispatching early without a fix is safe, waiting is not (invariant 1).

**Deliberate rejections:**

| Rejected                                | Why                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `CANCEL` from any state after `CREATED` | **After dispatch there is no cancel.** Contacts have the alert; the honest action is `RESOLVE`, which tells them it ended |
| `LOCATING → CANCELLED`                  | Dispatch has begun                                                                                                        |
| Any state → `LOCATING` (re-entry)       | Location refreshes update the snapshot, they do not re-enter the machine                                                  |
| `ALL_CHANNELS_FAILED → NOTIFIED`        | A later success creates a _new_ attempt; the incident re-evaluates via `ATTEMPT_SETTLED`                                  |
| `CLOSED → *`                            | Terminal; the timeline is sealed evidence                                                                                 |

### NotificationAttempt

The guards here are what make the Delivery Ledger structurally honest: a transition to
a state **above the channel's `maxState` is rejected**, so a channel that cannot report
delivery can never be recorded as delivered.

| From        | Event                   | To             | Guard                                                                                 |
| ----------- | ----------------------- | -------------- | ------------------------------------------------------------------------------------- |
| `QUEUED`    | `PROVIDER_ACCEPTED`     | `SENT`         | —                                                                                     |
| `QUEUED`    | `PROVIDER_REJECTED`     | `FAILED`       | — · triggers fallback                                                                 |
| `QUEUED`    | `TTL_ELAPSED`           | `EXPIRED`      | —                                                                                     |
| `QUEUED`    | `SPEND_CAP_REACHED`     | `FAILED`       | reason `SPEND_CAP`; surfaced to the user                                              |
| `SENT`      | `RECEIPT_DELIVERED`     | `DELIVERED`    | **the channel can reach `DELIVERED`, and the receipt comes from the source it names** |
| `SENT`      | `ACK`                   | `ACKNOWLEDGED` | **a person can acknowledge through the channel** · ack may precede a receipt          |
| `SENT`      | `CHANNEL_CANNOT_REPORT` | `UNKNOWN`      | the channel stops at `SENT`, **or** its receipts are provider-dependent (SMS)         |
| `SENT`      | `TTL_ELAPSED`           | `EXPIRED`      | `channel.maxState > SENT` — otherwise `UNKNOWN`                                       |
| `DELIVERED` | `ACK`                   | `ACKNOWLEDGED` | **a person can acknowledge through the channel**                                      |

Terminal: `ACKNOWLEDGED` · `FAILED` · `EXPIRED` · `UNKNOWN` · `DELIVERED` (when the
channel cannot reach `ACKNOWLEDGED`).

**Deliberate rejections:**

| Rejected                                | Why                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Any transition above `channel.maxState` | The structural guarantee behind [`DELIVERY_LEDGER.md`](DELIVERY_LEDGER.md). The UI cannot lie because the data cannot hold the lie |
| `FAILED → SENT`                         | A retry is a **new attempt** with a new `attemptNumber`, never a mutation. The history is evidence                                 |
| `UNKNOWN → DELIVERED`                   | Once the channel has said it cannot report, a later claim is not trustworthy                                                       |
| `ACKNOWLEDGED → DELIVERED`              | Acknowledgement supersedes delivery                                                                                                |

**Who can vouch for `DELIVERED`** (`DeliveredEvidence`, in `packages/safety-domain`).
A receipt is only accepted from the source the channel names, so the rule is a
property of the data and not of a code path:

| Channel                               | `DELIVERED` is vouched for by | Why                                                                                        |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| `sms`                                 | the **provider**              | Delivery receipts, where the provider and destination network support them                 |
| `push`                                | the **device**                | A push-service receipt means FCM/APNs _accepted_ the message — not that the handset has it |
| `web`                                 | the **device**                | The contact's browser opening the journey page                                             |
| `voice`, `device_direct_sms`, `email` | nobody                        | These stop at `SENT`                                                                       |

So an Expo, FCM or APNs receipt alone **never** moves a push attempt to `DELIVERED`; the
app (or a notification service extension) has to report back. This is the corrected
reading of the original "provider receipt" wording for background push.

The ledger separates two ceilings: `automaticCeiling` (the furthest the channel gets with
no human action — what "settled at its maximum" means in the rollup) and `humanAck`
(whether a person can acknowledge through it). One `maxState` could not serve both, since
a push can be acknowledged from its notification action yet still "settles" at `DELIVERED`.

An attempt whose TTL lapses at `SENT` is `EXPIRED` where a receipt was possible and
`UNKNOWN` where it never could be — and `EXPIRED` asks for a fallback, `UNKNOWN` does not.

### Cross-machine effects

| Trigger                                  | Consequence                                                           |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `SafetySession → ESCALATING`             | Creates an `EmergencyIncident` with the session's idempotency context |
| `EmergencyIncident → CLOSED`/`CANCELLED` | Emits `INCIDENT_RESOLVED` to the owning session, if any               |
| `NotificationAttempt` settles            | Emits `ATTEMPT_SETTLED` to its incident                               |
| First `ACKNOWLEDGED` attempt             | Emits `ACK_RECEIVED` to its incident, halting the ladder              |

Cross-machine effects are **declared and dispatched by the caller**, never by a machine
reaching into another. That keeps each machine independently testable.

## 7. Required tests

Beyond full branch coverage of `transitions.ts`:

| Scenario                                        | Expected                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| Same activation retried ×5, offline then online | Exactly one incident, one attempt set                                         |
| Grace expires while offline                     | Local escalation queued; dispatched on reconnect, marked delayed              |
| Location never acquired                         | Incident dispatches with "location unavailable"                               |
| All channels fail                               | `ALL_CHANNELS_FAILED`, shown prominently, never as success                    |
| Acknowledgement arrives during escalation       | Ladder halts immediately; no further contacts                                 |
| Duress cancel                                   | UI shows cancelled; incident proceeds; device reveals nothing                 |
| Token expired at activation                     | Dispatch proceeds via emergency token                                         |
| Process killed mid-countdown                    | Countdown resumes or the incident dispatches per policy — never silently lost |
| Clock skewed one hour                           | Idempotency and ordering still correct (server time authoritative)            |
| Two triggers within 60s                         | One incident                                                                  |
| Session suspended then resumed                  | Returns to the prior state; no spurious escalation                            |
| Arrival detected while escalating               | Escalation halts; session closes; contacts told it resolved                   |

### Where each of these is proven

Not every scenario above can be proven by a pure package. Each is mapped to what proves
it, so none is quietly assumed:

| Scenario                                        | Proven by                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Same activation retried ×5, offline then online | `replay.spec.ts` (dedupe by key) · `idempotency.spec.ts` · the API's `200`-on-repeat — milestone 1.8 |
| Grace expires while offline                     | `session.spec.ts` · `replay.spec.ts` (queued, applied on reconnect, marked delayed)                  |
| Location never acquired                         | `incident.spec.ts` · `replay.spec.ts`                                                                |
| All channels fail                               | `incident.spec.ts` · `rollup.spec.ts` · `replay.spec.ts`                                             |
| Acknowledgement arrives during escalation       | `incident.spec.ts` · `escalation.spec.ts` (halts; a late timer is refused)                           |
| Duress cancel                                   | `incident.spec.ts` (goes to `LOCATING`, not `CANCELLED`). The device projection — milestone 2.5      |
| Token expired at activation                     | **Integration** — emergency token, milestone 1.8                                                     |
| Process killed mid-countdown                    | **Integration** — a real device, milestones 1.8 / 1.16                                               |
| Clock skewed one hour                           | `idempotency.spec.ts` (retries still agree). Ordering by server time — milestone 1.8                 |
| Two triggers within 60 s                        | **Not provable by the key alone** — see §4. Needs the server-side rule, milestone 1.8                |
| Session suspended then resumed                  | `session.spec.ts` · `replay.spec.ts`                                                                 |
| Arrival detected while escalating               | `session.spec.ts`                                                                                    |
