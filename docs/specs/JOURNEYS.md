# Journeys: check-ins, deadlines and arrival (server)

> **Safety-critical.** Implements `RES-12` `RES-13` (the server half), `DET-1`'s missed-check-in trigger. Product intent:
> [`JOURNEY_GUARDIAN.md`](JOURNEY_GUARDIAN.md), [`SAFETY_CHECK.md`](SAFETY_CHECK.md). State machine:
> [`SAFETY_STATE_MACHINES.md`](SAFETY_STATE_MACHINES.md) §6a. The ladder that runs after an alert: [`ESCALATION_POLICY.md`](ESCALATION_POLICY.md).
> **Milestone 1.10a is the server; 1.10b is the app (below).**

## The four-part contract

| Part                    | Statement                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**               | `apps/api/src/sessions` (`SessionService` is the only writer of session state).                                                                         |
| **Supported platform**  | API, with the queue on. With it off, a journey **cannot be started** (its timers could not be kept), rather than started and silently never escalating. |
| **Failure path**        | A lost or failed timer is caught by a once-a-minute **sweep**. A failed incident raise is retried from `ESCALATING`. Neither skips a step.              |
| **Testable completion** | See _Required tests_.                                                                                                                                   |

## The path, and why it never skips a step

```
deadline ─▶ CHECK_IN_DUE ─▶ (prompt window) ─▶ GRACE ─▶ (grace) ─▶ ESCALATING ─▶ ALERTED
  only the PERSON is asked        nobody told                       an incident, as the SYSTEM
```

- **At the deadline only the person is asked**, on their own devices (a push to them, not through the ledger). Nobody else is told.
- **The prompt window** is `min(60 s, grace/2)`; then `NO_RESPONSE` → `GRACE`. **The grace** (from the template) runs from the deadline.
  Walk Home 3 min, Date 5, Ride 3, Travel 30, Outdoor 60, Custom 5. It can never be below 60 s.
- **Only when the grace has run out** does the journey become an **incident** (`triggerType: missed_check_in`), actor **system**: the
  timeline never says the user pressed anything. The incident runs **the journey's own policy** (its template's contacts-in-order and
  timeouts), snapshotted like any other, so editing the person's default later changes nothing about it.
- **A tick never skips a step.** If an earlier job was lost, the grace tick walks `NO_RESPONSE` and `GRACE_EXPIRED` itself. If the
  deadline job was lost altogether, a grace tick on an `ACTIVE` journey does **nothing** (it cannot jump `ACTIVE → ESCALATING`); the
  sweep fires the deadline instead.

## Deadlines are queue jobs, and are never trusted blindly

- Every deadline is a `session.tick` job (`deadline`, `prompt`, `grace`), enqueued **in the transaction** that sets it. A job carries
  the **check-in time it was set for** and does nothing if the session's check-in has since moved or the session has ended: that is how
  one journey has many timers and no stale one can act. Tested with the case that matters: an old grace timer firing while the journey
  is due _again_ must not escalate the new check-in.
- **The sweep** (`session.sweep`, every minute) finds `ACTIVE`/`CHECK_IN_DUE`/`GRACE`/`ESCALATING` journeys whose check-in time has
  passed and fires what should have fired, one step at a time. It does nothing a timer would not have done, only later.
- **Times are instants.** An arrival written with any UTC offset is one instant; no wall-clock arithmetic exists, so a DST change or a
  timezone change mid-journey moves nothing.

## Starting

- Needs **at least one contact who has agreed** (the machine's `START` guard). A journey no one could be told about is a promise the app
  cannot keep; it is refused with 409 and nothing is half-created.
- **One journey in progress per person**, enforced by a partial unique index, so a retried request cannot leave two live journeys
  each able to alert the same contacts. A second start returns 409 with the existing session's id.
- The arrival time must be **at least a minute away** and within the kind's limit (walk 12 h, ride 12 h, date 24 h, others 7 days).
- **Login only.** The emergency token acts on incidents, not on journeys.

## Answering, arriving, cancelling

- **Check-in** (`POST /:id/check-in {expectedArrivalAt}`): from `ACTIVE` it simply moves the time ("I need longer"); from
  `CHECK_IN_DUE`/`GRACE` (and `ESCALATING` before an incident exists) it is the person **answering**, returning to `ACTIVE`. Once the
  alert has gone out it is refused (409): end it from the emergency screen.
- **Arrive** (`POST /:id/arrive`): confirmation by the person, **never a timer**. If an alert already went out the incident is resolved,
  so the contacts who were alerted are told it ended. **A contact who was never alerted is told nothing**: a journey that ended safely
  without escalating sends no message at all.
- **Cancel**: ends it; refused once an alert is out.
- **By position** (`POST /:id/location`, batched, idempotent): arrival is **detected** only from `ACTIVE`, only from a fix that is both
  within **75 m** of the destination **and** no less precise than 75 m (an imprecise fix near the destination is _not_ an arrival), and
  never from a fix with unknown accuracy (refused). In any other state the response says `atDestination: true` and the person confirms.
- **An SOS during a journey** may name it (`sessionId`); honoured only for the caller's own live journey, otherwise ignored (an SOS must
  never fail over it). The journey becomes `ALERTED`; resolving the incident closes the journey.

## Limits

- **No deviation detection** (RES-14, the 6-step algorithm). It needs an expected route; a journey has only a destination. The machine
  row exists; nothing raises it (KI-101).
- **Contacts are not told a journey started** (the machine's `notifyContactsSessionStarted` effect is not carried out): nothing
  delivers a live link until 1.11, and an SMS per journey costs money and goes beyond what a contact agreed to (KI-102).
- **`SUSPENDED` (offline) is not driven**: the server cannot know the phone went offline. Its timers keep running, which is the safe
  side; the device-side queue is 1.13.
- **Never run with real providers**, and no app side yet (1.10b).

## Required tests

| Rule                                                                                       | Proven by      |
| ------------------------------------------------------------------------------------------ | -------------- |
| Only the person is asked at the deadline; nobody else is contacted                         | database suite |
| Grace respected: no incident before it ends; a late bus alerts no one                      | database suite |
| Every step walked in order, even with a lost job; `ACTIVE` never jumps to `ESCALATING`     | database suite |
| A stale, early, repeated or wrong-time timer changes nothing; one incident at most         | database suite |
| An old grace timer cannot escalate a new check-in (mutation-tested)                        | database suite |
| A failed incident raise is retried from `ESCALATING`                                       | database suite |
| The sweep finds lost timers and advances them one step at a time                           | database suite |
| A journey nobody agreed to be told about is refused, with nothing half-created             | database suite |
| One live journey per person, under concurrent requests                                     | database suite |
| Arrival: by confirmation, by a trustworthy fix only, never by an imprecise or distant one  | database suite |
| Arriving after an alert resolves the incident and tells only the contacts who were alerted | database suite |
| An SOS can link to the caller's own journey only                                           | database suite |
| An arrival is one instant whatever its UTC offset                                          | database suite |
| The missed-check-in words are not a plea for help                                          | unit           |
| Login only; another person's journey is a 404 for every action                             | database suite |

## The app (1.10b)

- **One screen** (`JourneyScreen`) replaces Follow Me and Check-In; both entries open it (Check-In preselects Custom). The old local
  countdown that opened the SOS screen is gone: the deadline is the server's.
- **Setup shows the plan before it runs** (`services/journeyCopy.ts`, pure and tested), in "will try" words: who is asked first (only the
  person), the template's grace, who is tried and in what order, a plain statement that **contacts are not told about the journey itself**,
  and any contact who has not agreed. It **refuses to start** with no agreed contact, rather than start a journey no one could be told about.
- **Running:** the arrival time, the plan, "the server keeps this deadline even if your phone dies or the app is closed", and the state of
  position-saving in words (not saved: you chose not to / location off / you stopped it; saving, with the time of the last save, or "can't
  reach Lumo, N waiting").
- **Position:** read only while the journey runs and Lumo is open; uploaded in batches (every 30 s or 5 fixes), kept and resent on failure
  (the server is idempotent), never with unknown accuracy, nothing kept across a restart. **Stop saving my position** stops uploads on this phone.
  Location permission is asked only from the "Allow location" button.
- **The question:** when the server says a check-in is due, the whole screen becomes **Are you OK?** with "I'm OK — 15 more minutes",
  "I'm OK — an hour" and "I've arrived", and states that only the person has been asked so far and when Lumo **may start** trying their
  contacts, an estimate by the phone's clock. An answer is not claimed until the server accepts it.
- **After an alert:** it says so, opens the incident (the SOS screen's ledger, via `incidentId`; it starts nothing new), and still lets
  the person say they are safe; cancelling is not offered.
- **Polling** every 5 s while a journey is live. A failed refresh keeps the last state on screen, marked old, and says the journey is
  still being kept.
