# Offline SOS (milestone 1.13)

> Implements RES-16 for the SOS path. Refines [`OFFLINE_ARCHITECTURE.md`](OFFLINE_ARCHITECTURE.md) and
> [`INCIDENTS.md`](INCIDENTS.md); closes KI-87 and KI-91 as far as the platform allows.

## The honest premise

An offline phone cannot deliver a remote alert, and Lumo cannot send an SMS silently on either platform
([`../engineering/PLATFORM_CAPABILITY_MATRIX.md`](../engineering/PLATFORM_CAPABILITY_MATRIX.md)). So 1.13 does four things and
promises nothing more:

1. **Never lose the press.** It is written to the device before anything else, with when it happened.
2. **Say plainly that nothing has been sent**, and keep the way to real help (the dialler) in front of the person.
3. **Send it as soon as there is a signal, if the app is running**, and tell the contact how late it is.
4. **Offer a text the person sends themselves**, pre-filled, with one tap. Not zero.

**What it does not do, and the UI must say:** it cannot send while the app is closed, killed, or the phone is off or dead (there is no
background task: see Limits). A person who is offline and whose app is killed is protected only by the dialler.

## The four-part contract

| Part              | Offline SOS                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner             | The device until the server has the incident; the server after.                                                                                             |
| Platform          | Android and iOS, foreground. Background send is not offered.                                                                                                |
| Failure path      | Offline · API down but network up · request lost mid-flight · app killed · token expired · clock wrong · cancelled while offline. Each below.               |
| Completion        | An incident the server holds with the **same idempotency key**, and its ledger. Until that exists the screen says "not sent", never "queued for delivery". |

## The press (device)

1. Local feedback at once (< 100 ms), before any I/O.
2. **Written to secure storage before the request**: key, trigger, `startedAt`, and the last known fix. (The existing "active SOS"
   record, extended with the fix; ids, a time and a position, nothing else.)
3. The local countdown runs on the device whatever the network does (3 s manual, 10 s automatic), with Cancel.
4. The request goes out **at once** with the same key (the server owns the countdown when it can). If it fails, the device does not
   give up: it **retries with the same key** while the app is open, backing off (2, 4, 8 … capped at 30 s), and on the app coming to the
   foreground. A retry that actually got through earlier returns the existing incident (idempotent), so there is never a second one.
5. **State shown, in the spec's words, while nothing has reached the server:** "Nothing has been sent. Lumo will alert your contacts as
   soon as there is a signal, if Lumo stays open. To get help now, call <number>." The number is from the region profile, the dialler is
   one tap, and a **"Text your contacts"** control is offered (see below).
6. **A local notification** is scheduled for when the countdown ends ("Your alert has not been sent. Open Lumo, or call"), cancelled the
   moment the server has the incident. It is the only thing that can reach a person whose app was killed, and it is a reminder, not a send.

## Time: never the device's clock for a claim about the past

A phone's clock can be minutes wrong; an alert that tells a contact "triggered 10 minutes ago" because the clock is slow is a false
statement. So the device reports **how long ago** it pressed (`elapsedSeconds`, measured on the device between the press and this
send), and the **server** works out the rest from its own clock: `pressedAt = now − elapsed`. Only the device's _elapsed_ time is
trusted, and only within bounds:

- `0 ≤ elapsedSeconds ≤ MAX_LATE_SOS_SECONDS` (**6 hours**, the same window as resuming a shown SOS). Beyond it the request is refused
  with a plain message, nothing is sent, and the screen says it was too long ago and offers the dialler. (A decision, KI-120: an
  SOS older than that is more likely stale than urgent, and a contact woken by it cannot tell.)
- The countdown that remains is `max(0, countdown − elapsed)`. If the deadline has passed, **it dispatches at once**: a late alert
  beats no alert.
- `lateBySeconds = max(0, elapsed − countdown)` is stored on the incident. If it is two minutes or more, **every message says so**
  ("It was triggered about 14 minutes ago; Lumo could not send it until now."), so the contact knows how old it is.

## The pre-filled text (`device_direct_sms`)

Offered whenever the server has not yet got the incident, and again if all channels failed. Opens the system SMS composer, addressed to
the contacts who have **agreed** (consent applies to this channel: `requiresConsent`), with the last known position **and its age**.
The person presses send.

- It is **attempted, never sent**: the composer's result is "sent" or "cancelled" on some platforms and unknown on others, and a text
  that left the phone is still not delivered. Lumo records only that the composer was opened (and, when online, posts that to the
  incident as an attempt on `device_direct_sms`, ceiling `SENT`, never `DELIVERED`).
- Needs the contacts' numbers **on the device while offline**: an encrypted cache in secure storage, refreshed whenever settings load,
  cleared on logout. This is personal data at rest on the phone (KI-121).
- Needs a native SMS-composer module (a dev-build rebuild, a Jest mock). Without it the control is not shown, and the screen says so.

## Cancel while offline

- During the local countdown: nothing was sent, so cancel clears the record and the reminder. Nothing is queued.
- After the countdown, before the server has it: cancel **clears the pending record first**, so no retry can send it, then, if a
  request may have reached the server unseen, cancels by key once online. Within the server's cancel window it works; after, the person is
  told it already went (409), as today.

## Reconciliation (server)

Idempotency key first; the server's state wins; an illegal-on-arrival event is logged `RECONCILIATION_CONFLICT`, never dropped
(`OFFLINE_ARCHITECTURE.md`). Only the SOS request is replayed by 1.13; check-ins and positions are not (see Limits).

## Limits, stated so the UI can state them

- **No background send.** No background-task module is installed, iOS limits background work, and a dead or off phone sends nothing.
  Only the dialler, and the reminder notification, work with the app killed.
- **No siren or strobe** (RES-19, Phase 2).
- **Journey check-ins and positions are not queued by this slice** (KI-57, KI-107): a journey's deadline is the server's, and an
  offline phone simply stops saving positions, as today.
- The text fallback depends on a SIM and credit, and is one tap by the person, never silent.

## Required tests

Offline at the press · offline at the deadline · request lost mid-flight then retried (one incident) · app killed and reopened (the
record resumes) · cancel during and after the countdown, offline · reconnect after a long delay dispatches and **marks the delay** ·
elapsed over the cap is refused and sends nothing · a wrong device clock changes nothing the server states · a duplicate key from another
user · the composer is never reported as sent · no screen says "queued" or "will be sent" without the qualifier that the app must stay open.

## Slices

- **1.13a** server: late dispatch from `elapsedSeconds`, the cap, `lateBySeconds`, and the delay in every message.
- **1.13b** app: the durable press, retry with the same key, the offline states and copy, the reminder notification, cancel offline.
- **1.13c** the pre-filled text: the contact cache, the composer, the attempt record. Gated on the native module decision.
