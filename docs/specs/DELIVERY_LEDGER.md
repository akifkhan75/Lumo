# Verified Delivery Ledger

> **Safety-critical.** This spec exists to prevent the single most dangerous bug class
> in a safety app: telling someone help is coming when it is not.
> Implements RES-3, PLAT-9. See [ADR-0012](../adr/0012-delivery-ledger.md).

## The problem it solves

The current app renders this on the SOS screen:

> "Emergency Calling… Notifying your contacts, emergency services, and sharing your
> location."

Nothing is sent. Even once dispatch is real, the naïve version is barely better: a
single green tick shown because an API returned `202`. A server accepting a request
is not a message arriving, and a message arriving is not a human reading it.

**The rule:** Lumo must distinguish an _attempted_ action, a _delivered_ message, and
a _human who has acknowledged_ the emergency — and never collapse them.

---

## 1. Attempt states

One `NotificationAttempt` per **recipient × channel**.

| State          | Meaning                                                  | Terminal | Counts as success?     |
| -------------- | -------------------------------------------------------- | -------- | ---------------------- |
| `QUEUED`       | Durably persisted; no provider call yet                  | no       | no                     |
| `SENT`         | Provider accepted it                                     | no       | **no**                 |
| `DELIVERED`    | Provider confirmed arrival on the device/handset         | no       | partial                |
| `ACKNOWLEDGED` | A human pressed "I'm responding"                         | **yes**  | **yes**                |
| `FAILED`       | Provider rejected, or unreachable after retries          | yes      | no — triggers fallback |
| `EXPIRED`      | TTL elapsed with no progress                             | yes      | no                     |
| `UNKNOWN`      | Channel cannot report further; final state is unknowable | yes      | **no**                 |

`UNKNOWN` is the state most systems omit, and it is the honest one. An SMS to a
network with no delivery receipts genuinely cannot be confirmed. Pretending otherwise
is the bug.

---

## 2. Channel capability matrix

**A channel can only reach the states its transport supports.** The UI must render
each channel's _maximum truthful state_, never a uniform tick.

| Channel                                     | Max reachable                                                                               | Typical latency | Notes                                                                                                                                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-app push, app foregrounded               | `ACKNOWLEDGED`                                                                              | < 2s            | The only channel that can prove a human saw it                                                                                                                                                                                                       |
| Push, background (FCM/APNs)                 | `SENT` from the provider; `DELIVERED` **only with a device-side receipt**                   | 1–10s           | A provider receipt means FCM/APNs _accepted_ the message — not that the handset has it. `DELIVERED` needs the app (or an iOS Notification Service Extension) to post the attempt id back. OS may throttle or batch; Doze and Low Power Mode delay it |
| SMS via provider                            | `DELIVERED` where the provider **and destination network** support receipts, else `UNKNOWN` | 2s–minutes      | Receipt availability varies by country and carrier. Never assume                                                                                                                                                                                     |
| Device-direct SMS (from the user's own SIM) | `SENT`                                                                                      | varies          | No receipt path. Last-resort fallback when the backend is unreachable                                                                                                                                                                                |
| Voice call                                  | `SENT` → answered                                                                           | seconds         | Answered ≠ understood. Never treat as acknowledgement                                                                                                                                                                                                |
| Email                                       | `SENT`                                                                                      | seconds–minutes | Supplementary only; **never** a primary emergency channel                                                                                                                                                                                            |
| Web (journey link polling)                  | `ACKNOWLEDGED`                                                                              | < 5s            | Contact acknowledges in the browser, no app needed                                                                                                                                                                                                   |

### Implementation requirement

Capability is **data, not code comments** — declared per channel and per region
profile, so the UI derives what it may display:

```ts
interface ChannelCapability {
  channel: Channel;
  maxState: "SENT" | "DELIVERED" | "ACKNOWLEDGED";
  deliveryReceipts: "always" | "provider-dependent" | "never";
  isEmergencyGrade: boolean; // email → false
  requiresConsent: boolean; // per region profile
}
```

A channel whose `maxState` is `SENT` can never show a "delivered" affordance. The UI
cannot lie because it has no data with which to lie.

---

## 3. Incident rollup

Per-attempt truth rolls up to the incident state without inventing certainty:

| Condition                                          | Incident state        | User-facing summary                                  |
| -------------------------------------------------- | --------------------- | ---------------------------------------------------- |
| Any attempt `ACKNOWLEDGED`                         | `ACKNOWLEDGED`        | "Maya is responding"                                 |
| All attempts at their max state, none acknowledged | `NOTIFIED`            | "Sent to 3 contacts · no response yet"               |
| Some at max, some `FAILED`/`EXPIRED`               | `PARTIALLY_NOTIFIED`  | "Sent to 2 of 3 · couldn't reach Dad"                |
| All `FAILED`/`EXPIRED`                             | `ALL_CHANNELS_FAILED` | "Couldn't reach anyone — call 911 now" + dial button |
| Attempts in flight                                 | `NOTIFYING`           | "Sending…"                                           |

**`NOTIFIED` is never phrased as "contacts have been notified."** It means messages
left the system. The copy says _sent_, and says nobody has responded yet. That
distinction is the whole product promise.

---

## 4. UI rules

Non-negotiable, enforced by the `emergency-review` skill and PLAT-9:

1. **No aggregate success tick.** The incident screen lists contacts individually.
2. **Failures are as prominent as successes.** Never collapsed into "2 of 3 sent"
   without naming who was missed.
3. **Every state carries its timestamp.** "Delivered 9:42 PM", not "Delivered".
4. **Locations show age.** "Last location 9:41 PM (2 min ago), ±18m". Never a bare pin.
5. **Pending is visibly pending**, with a spinner and elapsed time — not an empty row.
6. **`ALL_CHANNELS_FAILED` is a full-screen state**, not a toast, and offers the
   region-correct emergency number as a one-tap dial.
7. **Offline shows the truth:** "You're offline. Lumo will alert your contacts as
   soon as there's a signal. To get help now, call 911."
8. **No optimistic UI on the emergency path anywhere.** Optimistic rendering is
   correct for a like button and unacceptable here.

### Worked example

```
SOS · 9:42 PM · triggered by shake
─────────────────────────────────────────────────
Location acquired        9:42 PM   ±18m
Recording started        9:42 PM   local only

Maya        push    ✓ Delivered     9:42 PM
                    ✓ Responding    9:43 PM      ← the only true "help knows"
Dad         push    ✗ Failed        9:42 PM
            SMS     • Sent          9:42 PM   delivery unconfirmed
Mum         SMS     ✓ Delivered     9:43 PM   no response yet

Cloud backup        ⟳ Uploading     2 of 5 chunks
Emergency call      — not initiated              [ Call 911 ]
─────────────────────────────────────────────────
```

Every row is independently true. Nothing is implied. A user reading this knows
exactly where they stand — which is the difference between a safety product and a
reassurance product.

---

## 5. Fallback chain

Triggered by `FAILED`, not by `SENT`. Each step is a **new attempt** with its own
ledger row — fallbacks never overwrite history.

```
push (if token registered, contact has app)
  └─ FAILED or no token
      └─ SMS via provider (if consented & region permits)
          └─ FAILED
              └─ voice call (if region profile enables it)
                  └─ FAILED
                      └─ device-direct SMS from the user's SIM
                          └─ FAILED
                              └─ ALL_CHANNELS_FAILED → prompt the user to call
```

Rules:

- The chain is **per recipient**, run in parallel across recipients.
- Steps are skipped when consent is absent or the region profile disallows the
  channel — and a skip is ledgered with its reason, not hidden.
- Device-direct SMS requires explicit user authorisation and is **not silent** on
  either platform. Do not promise that it is.
- Total fan-out is bounded by the PLAT-5 spend cap. Hitting the cap is ledgered as
  `FAILED` with reason `SPEND_CAP`, and the user is told.

---

## 6. Acknowledgement

The only signal that means _help knows_.

- Contact taps **"I'm responding"** in the app, the push action, or the browser
  journey page.
- Propagates to the user's incident screen in < 5s when connected (RES-6).
- **Halts the escalation ladder immediately** — no further contacts are alerted.
- Records who, when, and via which channel.
- An acknowledgement is **not** revocable, but a contact may follow it with
  "I can't help after all", which **resumes** the ladder. Silence after
  acknowledging must not strand the user.

### Duress interaction

If the incident is in duress mode, acknowledgements are recorded and relayed to
contacts, but the device shows nothing. See [`EMERGENCY_WORKFLOWS.md`](EMERGENCY_WORKFLOWS.md).

---

## 7. Data model

```
NotificationAttempt
  id, incidentId, recipientId, channel
  state, stateReason
  queuedAt, sentAt, deliveredAt, acknowledgedAt, failedAt
  providerMessageId, providerStatus, providerError
  attemptNumber, costMinorUnits, regionProfileId
  idempotencyKey   -- (incidentId, recipientId, channel, attemptNumber)
```

- Append-only. A state change writes a `NotificationEvent`; the row's `state` is a
  materialised view of the latest event. **The history is the evidence** and must
  survive into the incident export (REC-1).
- `costMinorUnits` feeds the spend cap and unit economics.
- No message body is stored — only metadata. Bodies may contain location.

---

## 8. Observability

| Metric                                       | Alert                                          |
| -------------------------------------------- | ---------------------------------------------- |
| Delivery success rate per channel per region | < 95% over 15 min                              |
| p95 queue→sent latency                       | > 2s                                           |
| Acknowledgement rate                         | Tracked; no target until baselined             |
| `ALL_CHANNELS_FAILED` count                  | **Any occurrence pages on-call**               |
| `UNKNOWN` terminal rate per region           | Rising trend = a receipt-capability regression |
| Spend per user per day                       | Approaching cap                                |

**No coordinates, phone numbers or message bodies in logs or metrics labels**
(PLAT-8). An observability pipeline that leaks location is itself a safety incident.

---

## 9. Required tests

| Scenario                                 | Expected                                                      |
| ---------------------------------------- | ------------------------------------------------------------- |
| Provider returns 202 then never delivers | `SENT`, then `EXPIRED` at TTL. **Never `DELIVERED`**          |
| Push token stale                         | `FAILED` → SMS fallback, both rows visible                    |
| SMS to a network without receipts        | Terminal `UNKNOWN`, UI says "delivery unconfirmed"            |
| All channels fail                        | `ALL_CHANNELS_FAILED` full-screen + dial affordance           |
| Queue redelivers the same job            | No duplicate send (attempt idempotency)                       |
| Acknowledgement during fan-out           | Ladder halts; remaining contacts not alerted                  |
| Contact acknowledges in browser          | Same path as app acknowledgement                              |
| Spend cap reached mid-fan-out            | Remaining attempts `FAILED/SPEND_CAP`; user informed          |
| Offline at activation                    | Nothing claims sent; `SUSPENDED` messaging shown              |
| Provider outage                          | Fallback engages; incident still reaches `PARTIALLY_NOTIFIED` |
| Two acknowledgements race                | First wins; second recorded, ladder stays halted              |
| Duress incident                          | No delivery state rendered on the device                      |
