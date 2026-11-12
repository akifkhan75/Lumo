# ADR-0012: Verified Delivery Ledger with channel capabilities

- **Status:** Accepted · **Date:** 2026-10-27 · **Deciders:** Product, Architecture

## Context

The current SOS screen says "Emergency Calling… Notifying your contacts" and contacts
nobody. The naïve fix is barely better: one green tick because an API returned `202`.

A server accepting a request is not a message arriving, and a message arriving is not
a human reading it. The gap between those three is where people get hurt.

Compounding it, the states are not uniformly reachable: background push can prove
device arrival but never human receipt; SMS delivery receipts vary by provider and
destination network; device-direct SMS has no receipt path at all.

## Decision

A `NotificationAttempt` per **recipient × channel**, with states
`QUEUED → SENT → DELIVERED → ACKNOWLEDGED` plus terminal `FAILED`, `EXPIRED` and
`UNKNOWN`.

Each channel declares a **`ChannelCapability`** — its maximum reachable state — as
_data_. The UI renders each channel's maximum truthful state and therefore **cannot
lie, because it has no data with which to lie**.

Rollup: any acknowledged → `ACKNOWLEDGED`; all at max → `NOTIFIED` (copy says
_sent_); mixed → `PARTIALLY_NOTIFIED`; all failed → `ALL_CHANNELS_FAILED`, full-screen,
with a dial affordance, paging on-call.

"Notified" is banned as a UI word. No aggregate success tick anywhere.

## Alternatives

| Option                            | Why not                                         |
| --------------------------------- | ----------------------------------------------- |
| Single status per incident        | The dangerous ambiguity this ADR removes        |
| Per-recipient but not per-channel | Hides that SMS succeeded while push failed      |
| Uniform states across channels    | Requires inventing certainty SMS cannot provide |

## Consequences

**Good** — the user always knows where they stand · `UNKNOWN` makes honest uncertainty
representable · the ledger is the incident export's evidence · failures become
observable, so delivery regressions are detectable.

**Cost** — more complex UI than a tick · users must understand "sent" vs "delivered",
which is a content-design problem (`CONTENT_STYLE.md`) · more storage, as attempts are
append-only.

## Revisit when

A channel offers stronger guarantees — add it to the capability data, not the code.

## Erratum — 2026-11-12

The Context above says background push "can prove device arrival". It cannot. Expo's
documentation states that a push receipt with status `ok` means only that Google or
Apple _accepted_ the notification — "this doesn't guarantee that the device has
received the message" — and APNs offers no per-message device receipt at all.

The **Decision is unchanged**: capability is data, and each channel's maximum truthful
state is declared rather than assumed. What changes is the data. Background push is
capped at `SENT` from the provider, and reaches `DELIVERED` only through a device-side
receipt posted back by the app. See [`DELIVERY_LEDGER.md`](../specs/DELIVERY_LEDGER.md) §2.
