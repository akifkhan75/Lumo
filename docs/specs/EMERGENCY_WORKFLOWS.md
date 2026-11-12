# Emergency Workflows

> **Safety-critical.** The end-to-end SOS path. Implements DET-1/2/8, RES-1…RES-9.

## 1. Activation → dispatch

```
trigger (button | shake | voice | crash | missed check-in | duress)
   │
   ├─ 0. local feedback IMMEDIATELY (haptic + visual). Never wait on the network.
   │
   ├─ 1. mint idempotencyKey on device
   ├─ 2. mint/refresh emergency token (PLAT-4)   ← SOS never blocks on auth
   │
   ├─ 3. countdown? (manual 0–3s · automatic 10s · safeword 0)
   │       cancel → CANCELLED        duress-cancel → proceed silently
   │
   ├─ 4. create incident locally; persist before any network call
   ├─ 5. POST /sos (idempotent). Offline → queue, enter SUSPENDED messaging
   │
   ├─ 6. LOCATING, time-boxed ≤5s. No fix → dispatch with "location unavailable"
   ├─ 7. resolve recipients + channels (policy × region profile × consent)
   ├─ 8. fan out in parallel; one ledger row per recipient × channel
   ├─ 9. start evidence capture if authorised — NEVER on the dispatch critical path
   └─ 10. render the ledger. No aggregate tick, ever.
```

**Step 0 is a requirement.** The user must get confirmation the press registered
within ~100 ms, independent of connectivity. Everything after it can be slow; this
cannot.

**Step 9 is deliberately last.** Evidence must never delay an alert.

## 2. Cancel vs resolve

|             | Window                    | Effect                                                                                                       |
| ----------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Cancel**  | During the countdown only | Incident → `CANCELLED`. Nobody was contacted, so nobody is told                                              |
| **Resolve** | After dispatch            | Incident → `RESOLVING` → `CLOSED`. **Contacts are told it ended** — leaving them in the dark is its own harm |

After dispatch there is no cancel. The alert exists; the honest action is to resolve it.

## 3. Duress (DET-8)

Two PINs: the real one cancels; the duress one _appears_ to cancel.

On duress cancel:

- UI renders exactly the normal cancelled state. No badge, no banner, no difference.
- The incident proceeds; contacts receive the alert flagged `duress: true`.
- Contact guidance says help may be coerced — do not call the user back, consider
  contacting emergency services.
- **No delivery state, acknowledgement or recording indicator renders on the device.**
- Acknowledgements are recorded and relayed to contacts, never shown locally.

> **Open question — needs counsel.** `PRO-1` and both region profiles require a
> recording notice (`requiresOnScreenNotice: true`), while this section forbids any
> recording indicator under duress. Both cannot hold. **Until answered, no capture
> happens during a duress incident.** Tracked as KI-28 in
> [`../audit/KNOWN_ISSUES.md`](../audit/KNOWN_ISSUES.md).

Threat context: T1/T3 in `../engineering/THREAT_MODEL.md`.

## 4. Offline (RES-16)

The honest behaviour, per the platform matrix: Lumo **cannot** silently send an SMS on
either platform.

1. Incident persists locally with its true `occurredAt`.
2. Session shows `SUSPENDED` with plain copy: _"You're offline. Lumo will alert your
   contacts as soon as there's a signal. To get help now, call 15."_
3. Offer a **pre-filled SMS** to contacts with the last known location — the user
   presses send. One tap, not zero.
4. Siren and strobe work with no network and no account (RES-19).
5. On reconnect: replay in original order, dedupe by key, dispatch with the delay
   stated to recipients.

## 5. Emergency calling (RES-9)

- Show the region-correct number resolved from **current location** (`15`/`1122` in
  Punjab, `911` in the US).
- **Pre-fill the dialler; the user presses call.** Never auto-dial.
- Never claim dispatch unless `canClaimDispatch` is true.
- Prominent in `ALL_CHANNELS_FAILED`.

## 6. Contact experience (RES-7/8)

**Onboarding:** invited → accepts → consent recorded with timestamp → may revoke
anytime. A non-consented contact is never alerted.

**The alert contains:** who · alert type · last known location **with age and
accuracy** · live link · incident start · battery % if available · whether anyone has
acknowledged · region-appropriate what-to-do-now guidance · an "I'm responding" action.

**Never:** a stale fix presented as current · medical data in the link · evidence links.

## 7. Required tests

Local feedback < 100 ms offline · 5× retry → one incident · no fix → dispatches ·
expired token → dispatches · duress cancel reveals nothing on device · cancel after
dispatch impossible · contacts told on resolve · pre-filled SMS offline · emergency
number follows location while roaming · non-consented contact never alerted ·
process killed mid-countdown → resumes or dispatches.
