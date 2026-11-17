# Notifications: the queue, the channels and the ledger writer

> **Safety-critical.** Implements `RES-3` (the ledger's write path), the SMS channel of `RES-6`, and the
> queue behind them. Truth rules are in [`DELIVERY_LEDGER.md`](DELIVERY_LEDGER.md); transitions in
> [`SAFETY_STATE_MACHINES.md`](SAFETY_STATE_MACHINES.md) §6a; consent in
> [`TRUSTED_CONTACTS.md`](TRUSTED_CONTACTS.md). **Milestone 1.7a: SMS, the queue, the ledger writer, the Twilio
> webhook. 1.7b-1 (this file's _Region gating_, _The daily cap_ and _Voice_ sections): region gating, the spend cap
> and voice. Push, contact device linking and the device-side receipt are 1.7b-2** (see _Limits_).

## The four-part contract

| Part                    | Statement                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**               | `apps/api/src/notifications`: `LedgerService` (the only writer of attempt state), `NotificationQueue`, `DispatchService`, the SMS adapter, the Twilio webhook controller. |
| **Supported platform**  | API plus a worker in the same process. Postgres ≥ 13 (pg-boss). **Node ≥ 22.12** (pg-boss 12); Node 20 reached end of life in April 2026, so CI and the image move to 22. |
| **Failure path**        | Every way a send can go wrong ends in a ledger row that says which: not configured, no address, provider rejected, provider failed after accepting, no receipt, crash.    |
| **Testable completion** | See _Required tests_.                                                                                                                                                     |

## Rules

### One writer

`LedgerService.apply(attemptId, event, …)` is the **only** code that changes an attempt's state. In one
transaction it locks the attempt row, runs `ATTEMPT_MACHINE` (`@lumo/safety-domain`) against the stored state,
inserts the `NotificationEvent` and updates the materialised state and timestamps. A rejected transition
changes nothing and is reported to the caller. Nothing else — no controller, no adapter, no job — writes
`state`.

### Plan, then send

- **Plan** (`DispatchService.plan`): in **one transaction**, create one `QUEUED` attempt per recipient and
  channel, and enqueue its send job and its expiry job. The pg-boss enqueue joins that transaction, so an
  attempt row can never exist without its job, nor a job without its row (verified: a rolled-back transaction
  leaves no job). pg-boss 12 ships a Prisma adapter only for Prisma 7; this repo is on Prisma 5, so a
  one-method `Db` adapter over the transaction client is used and **the rollback behaviour is tested**.
- **Eligibility** comes only from `resolveRecipients`. A skipped contact is ledgered, never dropped.
- **Send** (the worker): _claim_, then call the provider, then record the outcome.

### Order inside the worker

Everything that can throw or decide "do not send" — the lookups, the consent re-check, the
configuration check — happens **before** the claim; the claim is taken immediately before the provider is
called. A claim taken first and followed by a failing lookup would leave the attempt claimed but unsent:
the job's retry would find the claim and stop, and the attempt would sit `QUEUED` for its whole
time-to-live and be recorded as "outcome unknown" although nothing was sent. (Found in review, tested.)

### At most once

Redelivery of a job must never send a second message. The worker first **claims** the attempt with a
conditional update (`claimedAt IS NULL`, state `QUEUED`). A job that finds the attempt already claimed or no
longer `QUEUED` does nothing. The cost: if the process dies **after** the provider accepted and **before** the
outcome was written, the attempt stays `QUEUED` and claimed. At its time-to-live it becomes `EXPIRED` with the
reason `SEND_OUTCOME_UNKNOWN` — the message may or may not have gone, the ledger says exactly that, and the
fallback proceeds. At-most-once was chosen over at-least-once because in an emergency a duplicate alert is
recoverable and a silent lie is not, but **neither is free**: this window is real.

### Why an attempt is not sent

| Reason                        | Event               | Meaning                                            |
| ----------------------------- | ------------------- | -------------------------------------------------- |
| `NO_ADDRESS`                  | `NOT_ATTEMPTED`     | no phone number for this recipient on this channel |
| `PROVIDER_NOT_CONFIGURED`     | `NOT_ATTEMPTED`     | no credentials: **never** treated as "accepted"    |
| `CHANNEL_DISABLED_FOR_REGION` | `NOT_ATTEMPTED`     | the region profile does not allow it               |
| `PROVIDER_REJECTED`           | `PROVIDER_REJECTED` | the provider refused the request                   |
| `SEND_OUTCOME_UNKNOWN`        | `TTL_ELAPSED`       | a crash between accept and record                  |

`NOT_ATTEMPTED` is a new transition (`QUEUED → FAILED`, no provider involved), added to §6a. A skip is not a
rejection and must not be recorded as one.

### Region gating (`channelGate`)

Decided against the **incident's** region profile (where the device was), never the account's. A channel
the profile does not list is `NOT_ATTEMPTED / CHANNEL_DISABLED_FOR_REGION`; SMS and voice in a market whose
registration is incomplete (US A2P 10DLC) are `NOT_ATTEMPTED / REGISTRATION_INCOMPLETE` — unregistered
traffic is filtered by carriers, so "sending" it would be a lie. **With no profile for the incident
(`UNRESOLVED`) nothing can be gated and nothing is blocked** — blocking every channel because the country
is unknown would be worse in an emergency — but the cap falls back to the **strictest** known profile's.

### The daily cap (PLAT-5)

- **Unit: a count per channel per user per rolling 24 hours**, from `messaging.dailyCaps` in the region
  profile. Not money: counts need no price table, never meet a currency, and are easy to tell a user.
  Required for every listed channel except `device_direct_sms`; the boot check refuses a profile without it.
- **Reserved at plan time**, inside the plan transaction, under a per-user advisory lock — otherwise two
  concurrent plans both read the same remaining budget. (Mutation-tested: without the lock five concurrent
  plans overspend.) A reservation is `reservedAt` on a really-queued attempt.
- **Skipped and capped attempts spend nothing.** An attempt that is queued and then not sent (consent
  withdrawn before the worker ran) **keeps** its reservation: conservative, and a known over-count.
- **Budget goes to contacts in priority order.** The rest are `FAILED / SPEND_CAP` (`SPEND_CAP_REACHED`),
  returned as `capped` so the caller **must tell the user**; an all-capped plan rolls up to
  `ALL_CHANNELS_FAILED`.
- **Per-user only.** No tenant exists yet (organisations are Phase 4); the per-tenant ceiling PLAT-5 also
  names is not built (KI-74).
- **A cap too low blocks someone asking for help.** The values are hypotheses, set generously (KI-73), and a
  hit is loud, never silent.

### Voice

- Twilio calls, with **their own configuration**: a **caller number** (`TWILIO_VOICE_FROM`). A messaging
  service SID cannot place a call, so "SMS is configured" says nothing about voice.
- **Never in a default channel list.** `planIn` creates every channel it is given at once; sequencing
  (SMS, then voice if SMS fails) is the escalation engine's (1.9, 2.4), so a caller that lists voice gets
  voice for everyone immediately.
- The script is spoken once by a machine, names who asked, asks for no keypress, and is **XML-escaped**
  (it carries the sender's name; a name containing `</Say><Dial>` stays text — tested).
- Twilio sends only `completed` unless asked, so the call requests `answered` and `completed`.

| Twilio call status                        | Ledger                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| request accepted                          | `PROVIDER_ACCEPTED` → `SENT`                                                  |
| `busy`, `no-answer`, `failed`, `canceled` | `PROVIDER_REPORTED_FAILURE` → `FAILED`, reason `VOICE_<STATUS>` (not reached) |
| `in-progress`, `completed`                | **no state change**: recorded as `providerStatus` only                        |

`in-progress` and `completed` mean a connection was made — **a person, a voicemail or an IVR** (Twilio's
own words). **Answered is a fact about the call, never an acknowledgement** and never delivery: voice stops at
`SENT`, so it settles `UNKNOWN` at its time-to-live. `providerStatus` is where "answered" lives, because
no state changed.

### Push has no address for a contact

`Device` belongs to a **user**; a `TrustedContact` is not linked to one. The link is **never inferred** from a
matching email or phone number — that would deliver one person's emergency alerts to whoever registers that
address. It can exist only when a contact **claims their invite while signed in** (not built). Until then a
push attempt for a contact is ledgered `NOT_ATTEMPTED / NO_ADDRESS`.

### SMS, and what each Twilio signal means

| Twilio                                              | Ledger                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `Messages.create` returns (any `queued`/`accepted`) | `PROVIDER_ACCEPTED` → `SENT`                                                   |
| callback `sent`, `queued`, `sending`, `accepted`    | no event (carrier-accepted is not a state we claim beyond `SENT`)              |
| callback `delivered`                                | `RECEIPT_DELIVERED` (evidence: **provider**) → `DELIVERED`                     |
| callback `undelivered`, `failed`                    | `PROVIDER_REPORTED_FAILURE` → `FAILED`, with Twilio's error code as the reason |
| **no receipt by the time-to-live**                  | `CHANNEL_CANNOT_REPORT` → **`UNKNOWN`**, reason `NO_RECEIPT_BY_TTL`            |

Twilio does not document a signal for "this destination network gives no receipts", so absence is the only
evidence. A message that stayed at `sent` with no receipt is **"delivery unconfirmed"**, not `EXPIRED`
(`EXPIRED` would say it did not go). `EXPIRED` stays for a message that never left the queue. A receipt that
arrives **after** the attempt became `UNKNOWN` is rejected by the machine (a later claim is not trusted) and is
counted, not applied.

### Callbacks arrive out of order, twice, and early

- A `delivered` or `undelivered` callback that arrives while the attempt is still `QUEUED` (the worker has not
  yet committed `SENT`) first records `PROVIDER_ACCEPTED` with the reason `INFERRED_FROM_CALLBACK`, then the
  receipt. Both events are in the history.
- A duplicate, or a status the attempt is already past, is a no-op.
- A terminal attempt is never changed by a callback.
- Callbacks are matched by `providerMessageId` (indexed). An unknown id is ignored and counted.

### The webhook

- Route `POST /api/v1/webhooks/twilio/status`, **unauthenticated by design**; the **signature** is the gate.
  The signature is HMAC-SHA1 over the exact public URL plus the sorted form parameters, so the URL must match
  what Twilio calls: it is built from `PUBLIC_API_URL`, never from the request's `Host`. Validation uses
  Twilio's own `validateRequest`. Unconfigured, or a bad signature, → `403` and nothing is read.
- Exempt from the global throttler (a provider's burst of callbacks must not be dropped) and from DTO
  whitelisting (Twilio adds fields without notice). Neither exemption touches any other route.
- Never logged: the body, the numbers, the message text, the signature.

### Never in a log or a label

No phone number, message body, coordinate or token appears in a log line, metric label or error (PLAT-8).
Attempts are referred to by id.

### Honest copy

SMS bodies are written server-side, so the honesty scanner now covers `apps/api` and `packages/`. A body may
say what the sender asked Lumo to do; it may not say help is coming. **Real templates (guidance, the live
location link) arrive with incidents (1.8) and the web page (1.11); until then the only body is a neutral
test alert.**

## Limits

- **Never run against real Twilio.** No account exists. The adapter is built to Twilio's documented API and
  tested against a fake HTTP server; **"a real SMS to a real phone with receipts disabled is recorded
  `UNKNOWN`" — the plan's exit — is not met** and stays open until credentials exist.
- US delivery needs A2P 10DLC registration, which takes weeks and can be refused.
- **Push, contact device linking and the device-side receipt are 1.7b-2.** The owner chose **claim while
  signed in**: a contact who already has Lumo opens their consent link inside the app while signed in, and only
  then is their account linked. Until it is built, no contact has a push address and nothing here can reach
  `DELIVERED` by push. Nothing creates an incident yet (1.8), so nothing is sent to anyone.
- At-most-once has a crash window (above).
- `costMinorUnits` stays 0: the cap is a count, not money; recording real cost (Twilio reports price after the fact) is
  unit-economics work for Phase 2.
- The queue lives in the same Postgres. A database outage stops sending and recording together.

## Required tests

| Rule                                                                     | Proven by                        |
| ------------------------------------------------------------------------ | -------------------------------- |
| Only `LedgerService` writes attempt state                                | grep test over `src`             |
| A rejected transition changes nothing                                    | ledger unit + database suite     |
| An attempt row and its jobs exist together or not at all (rollback)      | database suite                   |
| A redelivered send job sends nothing                                     | database suite                   |
| A crash after accept leaves a claimed `QUEUED` that expires as unknown   | database suite                   |
| Unconfigured provider → `NOT_ATTEMPTED / PROVIDER_NOT_CONFIGURED`        | adapter + database suite         |
| A skipped contact is ledgered with its reason                            | dispatch unit + database suite   |
| `delivered` before `SENT` is committed: both events recorded             | webhook + database suite         |
| Duplicate and stale callbacks are no-ops                                 | webhook + database suite         |
| `undelivered` → `FAILED`; no receipt by TTL → `UNKNOWN`                  | database suite                   |
| A late receipt after `UNKNOWN` is rejected and counted                   | database suite                   |
| A lookup that throws before the provider call leaves no claim            | database suite                   |
| Region gating by the incident's region; no profile gates nothing         | database suite                   |
| Budget in priority order; capped rows spend nothing; all-capped → failed | database suite                   |
| Concurrent plans cannot overspend (and the test fails without the lock)  | database suite                   |
| Voice statuses map as above; answered is never an acknowledgement        | database suite                   |
| A spoken name cannot inject TwiML                                        | voice unit                       |
| A bad or missing signature → 403, nothing applied                        | webhook                          |
| The signed URL comes from config, not from the `Host` header             | webhook                          |
| No number, body or signature in any log line                             | database suite with captured log |
