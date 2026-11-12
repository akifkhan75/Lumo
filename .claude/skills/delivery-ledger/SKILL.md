---
name: delivery-ledger
description: Correct use of Lumo's notification delivery states and channel capability matrix. Use when touching the notifications module, notification attempts, incident status rollup, or any UI showing whether a contact was reached. Prevents claiming a delivery or acknowledgement a channel cannot actually report.
---

# Delivery Ledger

Spec: `docs/specs/DELIVERY_LEDGER.md`.

## States

`QUEUED → SENT → DELIVERED → ACKNOWLEDGED`, plus terminal `FAILED`, `EXPIRED`,
`UNKNOWN`.

Only **`ACKNOWLEDGED`** means a human knows. `SENT` means a provider accepted it.
`UNKNOWN` is a legitimate terminal state and must never be rendered as success.

## Channel ceilings — never exceed

| Channel              | Max                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------- |
| Push, app foreground | `ACKNOWLEDGED`                                                                          |
| Push, background     | `SENT` from the provider; `DELIVERED` only with a device-side receipt                   |
| SMS via provider     | `DELIVERED` where provider **and destination network** support receipts, else `UNKNOWN` |
| Device-direct SMS    | `SENT`                                                                                  |
| Voice                | `SENT` → answered (answered ≠ understood)                                               |
| Email                | `SENT`, never emergency-grade                                                           |
| Web journey page     | `ACKNOWLEDGED`                                                                          |

Capability is **data** (`ChannelCapability`), not a comment. The UI derives what it
may display, so it cannot lie.

## Rules

1. One attempt per recipient × channel. Append-only history; the row's state is a
   materialised view of its latest event.
2. A fallback is a **new attempt**, never an overwrite.
3. Rollup: any acknowledged → `ACKNOWLEDGED`; all at max → `NOTIFIED`; mixed →
   `PARTIALLY_NOTIFIED`; all failed → `ALL_CHANNELS_FAILED`.
4. `NOTIFIED` copy says **"sent"**, never "notified", and states that nobody has
   responded yet.
5. `ALL_CHANNELS_FAILED` is full-screen with a one-tap region-correct dial, and pages
   on-call.
6. Every state carries a timestamp; every location carries age and accuracy.
7. No optimistic UI anywhere on the emergency path.
8. Never log message bodies, phone numbers or coordinates.
