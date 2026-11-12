# Feature Catalog

> Every feature, by pillar, with its requirement ID, phase, tier and today's status.
> Requirements and acceptance criteria: [`PRD.md`](PRD.md).
> Current reality: [`../audit/FEATURES.md`](../audit/FEATURES.md).

✅ real · 🟨 partial · ⛔ mock · ❌ absent · **F** free · **P** Plus · **B** Business

## Prevent

| Feature                          | ID     | Ph  | Tier | Now                                                    |
| -------------------------------- | ------ | --- | ---- | ------------------------------------------------------ |
| Hazard reports (condition-based) | PREV-1 | 4   | F    | 🟨 feed real, real coordinates; submission unavailable |
| Hazard map + nearby query        | PREV-2 | 4   | F    | 🟨                                                     |
| Proximity awareness              | PREV-3 | 4   | P    | ❌                                                     |
| Verified Safety Places           | PREV-4 | 4   | F    | ❌                                                     |
| Route awareness                  | PREV-5 | 4   | P    | ❌                                                     |
| Moderation + anti-abuse          | PREV-6 | 4   | F    | ❌                                                     |

## Detect

| Feature                      | ID    | Ph  | Tier | Now                                          |
| ---------------------------- | ----- | --- | ---- | -------------------------------------------- |
| Manual SOS                   | DET-1 | 1   | F    | 🟨 opens a screen that says nothing was sent |
| Cancellable countdown        | DET-2 | 1   | F    | ❌                                           |
| Shake trigger                | DET-3 | 1   | F    | ✅                                           |
| Crash / fall detection       | DET-4 | 3   | F    | 🟨 single 6 G threshold                      |
| Wake word                    | DET-5 | 3   | F    | ✅ variant matching                          |
| Distress phrases / safeword  | DET-6 | 3   | F    | ❌                                           |
| Audio event classification   | DET-7 | 3   | P    | ❌                                           |
| Duress code                  | DET-8 | 2   | F    | ❌                                           |
| Manual path always reachable | DET-9 | 1   | F    | ❌                                           |

## Respond

| Feature                        | ID     | Ph  | Tier | Now                              |
| ------------------------------ | ------ | --- | ---- | -------------------------------- |
| Incident creation (idempotent) | RES-1  | 1   | F    | ❌                               |
| Trusted contact alerts         | RES-2  | 1   | F    | ⛔ **contacts nobody**           |
| **Verified Delivery Ledger**   | RES-3  | 1   | F    | ❌                               |
| Escalation ladder              | RES-4  | 1   | F    | ❌                               |
| Channel fallback               | RES-5  | 2   | F    | ❌                               |
| Contact acknowledgement        | RES-6  | 1   | F    | ❌                               |
| Contact onboarding + consent   | RES-7  | 1   | F    | ❌                               |
| Contact guidance               | RES-8  | 1   | F    | ❌                               |
| Emergency calling              | RES-9  | 1   | F    | ❌                               |
| Live location sharing          | RES-10 | 1   | F    | ❌ no location capability at all |
| Install-free journey link      | RES-11 | 1   | F    | ⛔ hardcoded constant            |
| Journey Guardian               | RES-12 | 1   | F    | ⛔                               |
| Safety Check templates         | RES-13 | 1   | F    | 🟨 in-process timer only         |
| Route deviation                | RES-14 | 1   | P    | ❌                               |
| Battery-death alert            | RES-15 | 2   | F    | ❌                               |
| Offline behaviour              | RES-16 | 1   | F    | ❌                               |
| Fake call                      | RES-17 | 1   | F    | ✅                               |
| **Practice Mode**              | RES-18 | 1   | F    | ❌                               |
| Siren + strobe                 | RES-19 | 2   | F    | ⛔ text label only               |
| Nearby assistance              | RES-20 | 4   | P    | ⛔                               |

## Protect

| Feature                    | ID    | Ph  | Tier | Now                      |
| -------------------------- | ----- | --- | ---- | ------------------------ |
| Authorised capture         | PRO-1 | 2   | F    | ⛔ `isRecording = false` |
| Encrypted resumable upload | PRO-2 | 2   | P    | ❌                       |
| Evidence Integrity Report  | PRO-3 | 2   | P    | ❌                       |
| Evidence authorisation     | PRO-4 | 2   | F    | ❌                       |
| Retention + deletion       | PRO-5 | 2   | F    | ❌                       |
| Emergency profile          | PRO-6 | 1   | F    | 🟨 stored, shown as text |
| Sharing transparency       | PRO-7 | 1   | F    | ❌                       |
| Consent re-confirmation    | PRO-8 | 2   | F    | ❌                       |
| Incident timeline          | PRO-9 | 1   | F    | ❌                       |

## Recover

| Feature                  | ID    | Ph  | Tier | Now                  |
| ------------------------ | ----- | --- | ---- | -------------------- |
| Incident export          | REC-1 | 2   | P    | ❌                   |
| Support Navigator        | REC-2 | 4   | P    | ❌                   |
| Follow-up tracking       | REC-3 | 4   | P    | ❌                   |
| AI assistance boundaries | REC-4 | 4   | F    | 🟨 tips real, no TTS |

## Platform

| Feature                      | ID      | Ph  | Now                                            |
| ---------------------------- | ------- | --- | ---------------------------------------------- |
| Region profiles (PK + US)    | PLAT-1  | 1   | ❌                                             |
| Accessibility floor          | PLAT-2  | 1   | ❌ near-zero: 2 labels, none on the SOS button |
| Full WCAG 2.2 AA             | PLAT-3  | 6   | ❌                                             |
| SOS never blocks on auth     | PLAT-4  | 1   | ❌                                             |
| Spend cap                    | PLAT-5  | 1   | ❌                                             |
| Kill switch + staged rollout | PLAT-6  | 2   | ❌                                             |
| Shared safety domain         | PLAT-7  | 1   | ❌                                             |
| Observability                | PLAT-8  | 1   | ❌                                             |
| No fake success              | PLAT-9  | 0   | 🟨 CI-enforced for `apps/mobile` only          |
| Billing + entitlements       | PLAT-10 | 5   | ❌                                             |
| Localisation (catalogue)     | PLAT-11 | 6   | ❌                                             |
| Wearables                    | PLAT-12 | 6   | ❌                                             |

## Summary

**60 requirements · 3 real · 8 partial · 6 mock · 43 absent.**

Every real feature is a **trigger** or an **escape tool**. The entire **response**
chain is absent. Phase 1 exists to close exactly that gap.
