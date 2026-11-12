# Platform Capability Matrix

> **Safety-critical.** This document exists to stop Lumo promising a trigger the
> operating system will not actually run. Every claim must be **verified on real
> hardware** and dated; unverified rows are marked ❓ and may not ship as features.

> ⚠️ **Platform behaviour changes with every OS release.** Treat the verdicts below
> as the design position and the questions to validate — not as tested fact until the
> _Verified_ column is filled in. A row without a verification date is a hypothesis.

## Why this is a safety document

A trigger that the OS silently suspends is worse than a trigger that does not exist,
because the user believes they are protected. Three rules follow:

1. **Never show a trigger as armed unless it is actually armed.** (B9, B10)
2. **Every automatic trigger needs a manual equivalent**, because some users cannot
   use it and some platforms will not run it. (DET-9)
3. **State the limitation in-product**, not only in documentation.

---

## 1. Trigger availability

| Trigger                        | Android                     | iOS                                 | Verdict                                                       |
| ------------------------------ | --------------------------- | ----------------------------------- | ------------------------------------------------------------- |
| In-app button                  | ✅                          | ✅                                  | Ship. The only universally reliable trigger — hence DET-1     |
| Home-screen widget             | ✅                          | ✅                                  | Ship                                                          |
| Lock-screen access             | ✅ widget                   | ❓ varies by OS version             | Validate before claiming                                      |
| Quick Settings tile            | ✅                          | ❌ no equivalent                    | Android only                                                  |
| Control Centre                 | ❌                          | ❓                                  | Validate                                                      |
| **Power button ×3**            | ❌ reserved by OS           | ❌ reserved by OS                   | **Impossible. Must never be promised**                        |
| Volume-key pattern, screen off | ❓ restricted               | ❌                                  | Likely unusable; validate before promising                    |
| Action Button / Back Tap       | n/a                         | ✅ via Shortcut                     | iOS only, user-configured                                     |
| Assistant shortcut             | ✅                          | ✅ Siri Shortcut                    | Ship; requires user setup                                     |
| Shake, app foreground          | ✅                          | ✅                                  | Ship                                                          |
| Shake, app background          | ❓ foreground service       | ❌ heavily restricted               | Android with a visible notification; **not available on iOS** |
| Wake word, app foreground      | ✅                          | ✅                                  | Ship                                                          |
| Wake word, app background      | ❓ foreground service + mic | ❌ not permitted for continuous mic | **Do not promise continuous background listening**            |
| Crash/fall, background         | ❓ foreground service       | ❓ limited                          | Validate; advisory only regardless                            |
| Wearable button                | ❓ Wear OS                  | ❓ watchOS                          | Phase 6                                                       |
| Headphone remote               | ❓                          | ❓                                  | Low priority                                                  |

### The honest summary

**Only the in-app button, the widget and an assistant shortcut can be promised
without qualification on both platforms.** Everything else is conditional on OS
version, a visible foreground notification, or user configuration — and iOS
restricts background microphone and sensor work far more than Android.

This is why the strategy document's instruction is right: _do not promise that every
trigger works when the app is force-closed, the phone is locked, or the OS restricts
background activity._

---

## 2. Background execution

| Capability                          | Android                                         | iOS                                       | Design consequence                                                                                                       |
| ----------------------------------- | ----------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Background location, journey active | ✅ foreground service + persistent notification | ✅ with Always permission + justification | Journeys need an explicit rationale screen; Play requires a written justification and demo video for background location |
| Continuous microphone, background   | ❓ foreground service, type `microphone`        | ❌                                        | **Background voice activation is Android-only at best.** iOS users get foreground-only — and must be told                |
| Sensors, background                 | ❓ foreground service                           | ❌ except specific entitlements           | Shake/crash in background is Android-leaning                                                                             |
| Doze / App Standby                  | Delays alarms and network                       | Low Power Mode throttles                  | Timers must be server-backed; a local timer alone is not a safety mechanism                                              |
| Process killed by OS                | Common under memory pressure                    | Common                                    | Session state persisted locally **and** server-side (B15)                                                                |
| Boot persistence                    | ✅ `BOOT_COMPLETED`                             | ❌ no equivalent                          | After a reboot, iOS sessions resume only on next launch. **Server watchdog covers the gap** — this is why RES-15 exists  |
| Battery-optimisation exemption      | User-grantable                                  | n/a                                       | Request with explanation; never silently assume granted                                                                  |

### Consequence

**A locally-scheduled check-in is not a safety guarantee on either platform.** Every
deadline that must escalate has to be mirrored server-side. That is the single most
important architectural conclusion in this document, and it is why server-side
check-ins (RES-13) are Phase 1 rather than an optimisation.

---

## 3. Notification delivery

| Capability                              | Android                                                   | iOS                                                                                 | Consequence                                                                                                                                              |
| --------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Override DND / silent                   | ✅ via a correctly configured high-importance channel     | ✅ **only with the Critical Alerts entitlement**                                    | iOS entitlement requires Apple approval and a stated justification. **If not granted, the app must tell the user emergency alerts may be silenced** (B8) |
| Full-screen intent                      | ✅ with permission                                        | ❌                                                                                  | Android can present a call-like emergency screen                                                                                                         |
| Delivery receipt                        | ⚠️ FCM acceptance only; device-side receipt needs the app | ⚠️ APNs acceptance only; device-side receipt needs a Notification Service Extension | A provider receipt proves the push service _accepted_ the message, **not** that the device has it, and never that a human saw it                         |
| Notification actions ("I'm responding") | ✅                                                        | ✅                                                                                  | Powers RES-6 acknowledgement                                                                                                                             |
| Time-sensitive / priority               | ✅                                                        | ✅ interruption level                                                               | Required for emergency alerts                                                                                                                            |

---

## 4. Telephony and SMS

| Capability                        | Android                                                  | iOS                  | Consequence                                                                               |
| --------------------------------- | -------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| Place a call programmatically     | ❓ requires permission; dialler pre-fill is reliable     | ❌ user must confirm | **Never auto-dial emergency services** (RES-9). Pre-fill and let the user press call      |
| Send SMS silently from the device | ❓ restricted, permission-gated, Play-policy constrained | ❌ not permitted     | **Device-direct SMS is not silent on either platform.** Do not promise silent offline SMS |
| Open the SMS composer, pre-filled | ✅                                                       | ✅                   | The honest offline fallback: one user tap                                                 |
| Read SMS for confirmation         | ❓ heavily restricted                                    | ❌                   | Not usable                                                                                |

### The offline fallback, stated honestly

The strategy document is right to flag this. The deliverable is: Lumo pre-fills an
SMS to the user's contacts containing their last known location and asks them to
press send. **One tap, not zero.** Marketing must say "Lumo prepares an SMS you can
send with one tap when you have no data" — never "Lumo sends your location by SMS
automatically".

---

## 5. Sensors and media

| Capability                     | Android                               | iOS                           | Notes                                                                   |
| ------------------------------ | ------------------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| Accelerometer / gyroscope      | ✅                                    | ✅                            | Usually no runtime permission; availability still checked               |
| Sampling rate                  | Configurable; high rates cost battery | Configurable                  | Duty-cycle to meet the < 3%/hr guardrail                                |
| Background audio capture       | ❓ foreground service                 | ❌ except specific categories | Evidence audio is foreground-leaning                                    |
| Camera in background           | ❌                                    | ❌                            | Evidence video requires the app in the foreground. **State this limit** |
| Torch / strobe                 | ✅                                    | ✅                            | RES-19 works offline, no account                                        |
| Audible alarm over silent mode | ✅                                    | ❓ depends on category        | Validate; fall back to vibration + strobe                               |

---

## 6. Rules this matrix imposes

Binding on the product, not advisory:

1. **The capability matrix is machine-readable.** `DeviceCapability` is probed at
   runtime and persisted per install, so the UI can show what is genuinely armed and
   support can diagnose a user's actual configuration.
2. **A trigger toggle is disabled with an explanation** when the platform cannot
   support it — never enabled-but-dead. "Voice activation needs the app open on
   iPhone" beats a switch that does nothing.
3. **Every deadline is server-mirrored.** Local timers are a convenience.
4. **No marketing claim may exceed this matrix.** The `emergency-review` skill checks
   copy against it.
5. **Re-verify every OS major release.** A platform change that disables a trigger is
   a safety regression and must page on-call, not be discovered by a user.

---

## 7. Verification log

Every row above must be confirmed on real hardware. Unverified rows cannot ship as
features.

| Platform | Device | OS    | Verified by | Date | Result                                                 |
| -------- | ------ | ----- | ----------- | ---- | ------------------------------------------------------ |
| Android  | _TBD_  | _TBD_ | —           | —    | not yet run                                            |
| iOS      | _TBD_  | _TBD_ | —           | —    | **never built** ([KI/STD-3](../audit/KNOWN_ISSUES.md)) |

**Minimum matrix before launch:** two Android OEMs across two OS majors (one with
aggressive battery management, e.g. a Chinese OEM skin), plus two iPhones across two
OS majors. Emulators are insufficient — the failures this document is about are
precisely the ones emulators do not reproduce.
