# Lumo — Product Requirements Document

> **Status:** v1.0 · 2026-10-27 · Owner: Product
> **This document is the root.** Every other spec inherits its scope, priorities and
> requirement IDs from here. If a spec disagrees with this file, this file wins —
> then fix the spec.

```
Lumo — Your Light in the Dark.
```

---

## 1. Problem

People feel unsafe in ordinary moments, not only extreme ones: walking home after a
late class, leaving a date that turned uncomfortable, realising someone is following
you, driving alone at night, arriving somewhere unfamiliar.

Existing tools serve only the extreme end. Google's Personal Safety app is an
excellent panic button — and silent before anything goes wrong. Apple's capabilities
are strong but ecosystem-bound and device-dependent. Life360 is family location
sharing, not an emergency workflow. Public-sector apps provide official connectivity
but little everyday utility.

Three gaps follow:

1. **Nothing helps you avoid the situation.** No tool tells you the underpass ahead
   has an unlit stretch reported three times this month.
2. **Nothing helps you leave quietly.** Most unsafe moments are not 911 moments —
   they need a plausible exit, not a siren.
3. **Nothing tells you whether help actually arrived.** Apps display "contacts
   notified" when a server accepted a request. That is not the same thing, and the
   gap between them is where people get hurt.

**The honest state of Lumo today:** it can detect trouble four ways (button, shake,
voice, crash) and then does nothing about it. Every trigger is real; the entire
response chain is a mock. See [`../audit/FEATURES.md`](../audit/FEATURES.md).

---

## 2. Vision and pillars

A personal safety companion that helps people **prevent, detect, respond to, and
recover from** dangerous situations — across ordinary Android phones and iPhones,
without requiring a specific handset or a single vendor's ecosystem.

| Pillar      | Purpose                              | Requirement prefix |
| ----------- | ------------------------------------ | ------------------ |
| **Prevent** | Help people make safer decisions     | `PREV-`            |
| **Detect**  | Identify that something may be wrong | `DET-`             |
| **Respond** | Connect the person with help         | `RES-`             |
| **Protect** | Preserve what matters                | `PRO-`             |
| **Recover** | Help after an incident               | `REC-`             |
| _Platform_  | Cross-cutting capability             | `PLAT-`            |

### Positioning

> **A safety network, not a panic button.**
> Your everyday safety companion, with intelligent assistance when it matters most.

This matters commercially as well as strategically. A panic button is used a handful
of times in a life; a journey companion is used weekly. Habitual use is what makes
the network, the referral loop and the subscription viable — without making users
feel the world is constantly dangerous.

### The three strategic advantages

1. **Cross-platform safety network.** A user starts a journey on Android, shares it
   with an iPhone user, and a trusted contact follows it **in a browser without
   installing anything**. Google cannot match this without owning both platforms.
2. **Context-aware prevention.** Verified advisories plus decaying, confirmed
   community reports — communicating _observations_, never predictions about people.
3. **Verifiable response.** Lumo states exactly what it attempted, what was
   delivered, and what a human acknowledged. No competitor does this well.

---

## 3. Personas

| #   | Persona                                                           | Primary need                                                        | Drives                                                  |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- |
| P1  | **Independent traveller / night commuter** (primary; skews 18–34) | Get there without incident; leave a situation without confrontation | Journeys, discreet triggers, fake call, prevention      |
| P2  | **Family member or caregiver** (frequently the payer)             | Know they arrived — without surveilling them                        | Family plans, consent-visible sharing, check-ins        |
| P3  | **Lone / field worker**                                           | Escalation when nobody is nearby                                    | Crash detection, server-side check-ins, employer plans  |
| P4  | **The trusted contact** (usually not a user)                      | Know the alert is real, and what to do right now                    | Contact onboarding, install-free link, "I'm responding" |

**P4 is half the product and currently has no design at all.** Every competitor
treats the recipient as a notification target rather than a participant. An alert
that reaches someone who does not know what to do has not succeeded.

### Explicitly not narrowing to one demographic

Women experiencing harassment are an important segment and will shape the discreet
and coercion-aware design. But the platform also serves commuters, students, solo
travellers, cyclists, hikers, lone workers, older adults and caregivers. Broad
positioning gives multiple acquisition channels while the pilot stays focused.

---

## 4. Jobs to be done

- _"When I'm walking somewhere unfamiliar at night, help me know what's ahead so I
  can avoid it."_
- _"When someone makes me uncomfortable, give me a way out that doesn't escalate."_
- _"When something happens, reach my people with proof of where I am — even with no
  signal."_
- _"When I'm alerted about someone I love, tell me exactly what to do."_
- _"When it's over, help me figure out what happens next."_

---

## 5. Scope

### In scope

Phases 0–2 of [`ROADMAP.md`](ROADMAP.md): the safety session engine, SOS with
verified delivery, journeys with an install-free tracking link, check-ins, trusted
contacts with consent, evidence capture with an integrity report, practice mode, the
accessibility floor, and offline behaviour that is honest about its limits.

### Non-goals — and why

Stating these is what stops the next requirements document re-promising things that
cannot be built. Each is permanently out of scope unless the stated condition
changes.

| Non-goal                                       | Why                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Earthquake / crisis alerting at platform scale | Google aggregates seismic data from millions of handsets. Not reproducible. Integrate public feeds instead, and never market it as our own                                                                                               |
| Satellite SOS                                  | Requires compatible hardware and carrier agreements                                                                                                                                                                                      |
| OS power-button capture                        | Not available to third-party apps on either platform. A widget, Quick Settings tile, Action Button or volume pattern is the ceiling — see [`../engineering/PLATFORM_CAPABILITY_MATRIX.md`](../engineering/PLATFORM_CAPABILITY_MATRIX.md) |
| Unilateral emergency dispatch                  | Regulated and jurisdiction-specific. Until a signed agreement exists, Lumo offers a user-initiated call, nothing more                                                                                                                    |
| Crash detection marketed as automotive-grade   | A sensor heuristic is not a validated automotive system. Advisory with confirmation only                                                                                                                                                 |
| Continuous background location by default      | A liability and a stalkerware vector. Location is captured during an SOS or an explicitly started journey — never persistently                                                                                                           |
| Guaranteed legal admissibility of evidence     | A hash proves a file did not change after a point in the workflow. It does not prove authorship or authenticity in every legal sense                                                                                                     |

### Claims we must never make

Enforced by [`../gtm/POSITIONING.md`](../gtm/POSITIONING.md) and the
`emergency-review` skill:

- "Police alerted instantly" — unless a signed integration delivered it
- "AI that detects every attack" — unmeasurable, and false
- "Your evidence can never be deleted"
- "Works everywhere, offline" — an offline phone cannot deliver a remote alert
- Any success state not backed by a delivery record

---

## 6. Requirements

Format: `ID · requirement · acceptance criteria · phase · tier`.
Tier: **F** = free forever, **P** = Plus, **B** = Business.
Acceptance criteria are testable; "the screen looks right" is never sufficient.

### Prevent

| ID     | Requirement                                         | Acceptance criteria                                                                                                                                                                                         | Ph  | Tier |
| ------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| PREV-1 | Hazard reports — report a _condition_ at a location | Given a submitted report, it stores type, coordinates, accuracy, source, timestamp, confirmation count and `expiresAt`; it is never rendered as a severity judgement about an area; it decays automatically | 4   | F    |
| PREV-2 | Hazard map and nearby query                         | Reports within a radius return paginated, newest-first, with confidence and age shown on every pin; an unconfirmed report is visually distinct from a verified advisory                                     | 4   | F    |
| PREV-3 | Proximity awareness                                 | On approaching a cluster meeting the confirmation threshold, the user is notified once, with the observation and its age — never a risk score                                                               | 4   | P    |
| PREV-4 | Verified Safety Places                              | Each place carries an explicit verification tier (official / verified partner / community / unverified); tier is always visible                                                                             | 4   | F    |
| PREV-5 | Route awareness                                     | Before a journey, surface verified advisories and confirmed reports on the route as observations with sources                                                                                               | 4   | P    |
| PREV-6 | Report moderation and anti-abuse                    | Rate-limited per user; duplicate clustering; no free-text naming of individuals or businesses; no demographic fields exist in the schema                                                                    | 4   | F    |

### Detect

| ID    | Requirement                   | Acceptance criteria                                                                                                                                      | Ph  | Tier |
| ----- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| DET-1 | Manual SOS                    | Reachable within one interaction from app launch and from a home/lock-screen widget; works with location denied, offline, and with an expired auth token | 1   | F    |
| DET-2 | Cancellable countdown         | Every automatic trigger opens a countdown (default 10s, configurable) that the user can cancel; manual SOS may skip it                                   | 1   | F    |
| DET-3 | Shake trigger                 | Configurable sensitivity; debounced; disabled automatically after N cancelled activations with the user informed                                         | 1   | F    |
| DET-4 | Crash/fall detection          | Evaluates a sensor _sequence_, not a single threshold; always confirms before escalating; advisory framing only                                          | 3   | F    |
| DET-5 | Wake word                     | On-device; works for the enrolled phrase; measured FP/FN published per [`../specs/AI_SAFETY_SPEC.md`](../specs/AI_SAFETY_SPEC.md)                        | 3   | F    |
| DET-6 | Distress phrases and safeword | User-configured; a safeword escalates directly, a normal command only starts a session                                                                   | 3   | F    |
| DET-7 | Audio event classification    | Classes evaluated on a held-out set across accents, languages, noise, microphones and distances; emits a _signal_, never a decision                      | 3   | P    |
| DET-8 | Duress code                   | A second PIN that appears to cancel or unlock while silently escalating; indistinguishable from the real one on screen                                   | 2   | F    |
| DET-9 | Manual path always reachable  | For every automatic trigger there exists an equivalent manual path usable without speech, without fine motor control, and with a screen reader           | 1   | F    |

### Respond

| ID     | Requirement                    | Acceptance criteria                                                                                                                                                    | Ph  | Tier |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| RES-1  | Emergency incident creation    | Idempotent: N retries of the same activation create exactly one incident and one set of notification attempts                                                          | 1   | F    |
| RES-2  | Trusted contact alerts         | ≥1 consented contact receives a message containing a working live-location link within 10s of dispatch on a connected device                                           | 1   | F    |
| RES-3  | **Verified Delivery Ledger**   | Per contact per channel, the UI shows the maximum _truthful_ state (queued/sent/delivered/acknowledged/failed/unknown). No aggregate tick. A failure is always visible | 1   | F    |
| RES-4  | Escalation ladder              | User-configured policy advances contact→contact on timeout; acknowledgement halts it; the policy is visible before it runs                                             | 1   | F    |
| RES-5  | Channel fallback               | Push → SMS → device-direct SMS per user settings and region profile; each attempt is ledgered independently                                                            | 2   | F    |
| RES-6  | Contact acknowledgement        | One tap "I'm responding" propagates to the user's incident screen within 5s when connected                                                                             | 1   | F    |
| RES-7  | Contact onboarding and consent | A contact must accept the role before receiving alerts; consent is recorded with timestamp and revocable by the contact                                                | 1   | F    |
| RES-8  | Contact guidance               | Every alert carries what-to-do-now instructions appropriate to the alert type and region                                                                               | 1   | F    |
| RES-9  | Emergency calling              | Presents the region-correct number and dials on explicit user action. Never auto-dials, never claims dispatch                                                          | 1   | F    |
| RES-10 | Live location sharing          | Shared only per explicit permission, with accuracy and timestamp; **a stale fix is never presented as current**                                                        | 1   | F    |
| RES-11 | Install-free journey link      | Opaque high-entropy token, configurable expiry, revocable; exposes only what the user authorised; never medical data or evidence                                       | 1   | F    |
| RES-12 | Journey Guardian               | Destination, ETA, optional route, deviation handling, configurable grace, arrival detection and clean session close                                                    | 1   | F    |
| RES-13 | Safety Check templates         | Walk Home / Date / Ride / Travel / Outdoor / Custom, each with its own escalation policy and interval tolerance                                                        | 1   | F    |
| RES-14 | Route deviation                | A meaningful deviation accounts for GPS accuracy and normal detours; it notifies the _user_ discreetly first and only escalates per policy                             | 1   | P    |
| RES-15 | Battery-death alert            | If the device dies with a session active, contacts are notified that the phone went offline — silence must not read as safety                                          | 2   | F    |
| RES-16 | Offline behaviour              | Session, deadline and queue survive loss of connectivity; the user is told plainly that remote delivery is not currently guaranteed                                    | 1   | F    |
| RES-17 | Fake call                      | AI-generated or local script, plausible incoming-call UI, no network dependency for the fallback script                                                                | 1   | F    |
| RES-18 | Practice Mode                  | Exercises triggers, location, dispatch and ledger end-to-end while notifying nobody; clearly labelled; counts toward activation                                        | 1   | F    |
| RES-19 | Loud alarm and strobe          | Functions with no network and no account                                                                                                                               | 2   | F    |
| RES-20 | Nearby assistance              | Only to vetted, opted-in responders; never dispatches a lone stranger to an individual                                                                                 | 4   | P    |

### Protect

| ID    | Requirement                 | Acceptance criteria                                                                                                                 | Ph  | Tier |
| ----- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| PRO-1 | Authorised evidence capture | Starts only on an authorised trigger with a visible recording indicator                                                             | 2   | F    |
| PRO-2 | Encrypted, resumable upload | Encrypted in transit and at rest; chunked and resumable; **never reported as backed up before verification succeeds**               | 2   | P    |
| PRO-3 | Evidence Integrity Report   | Incident ID, start/end, upload status, per-file hashes, location timestamps, access history, and any recording or connectivity gaps | 2   | P    |
| PRO-4 | Evidence authorisation      | Cross-account and cross-tenant access is impossible; every access, download and share is logged                                     | 2   | F    |
| PRO-5 | Retention and deletion      | Explicit per-tier windows; deletion propagates to backups within a stated period                                                    | 2   | F    |
| PRO-6 | Emergency profile           | Optional medical data with granular, per-recipient sharing; never exposed through a journey link                                    | 1   | F    |
| PRO-7 | Sharing transparency        | The user can always see every active share and who viewed it, and revoke any of them in one action                                  | 1   | F    |
| PRO-8 | Consent re-confirmation     | Long-lived sharing requires periodic re-confirmation — the primary stalkerware mitigation                                           | 2   | F    |
| PRO-9 | Incident timeline           | Every state transition and attempt is recorded with a timestamp and is exportable                                                   | 1   | F    |

### Recover

| ID    | Requirement              | Acceptance criteria                                                                                                              | Ph  | Tier |
| ----- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| REC-1 | Incident report export   | A shareable PDF/JSON with the timeline, locations, delivery ledger and evidence hashes                                           | 2   | P    |
| REC-2 | Support Navigator        | Guided post-incident flow to medical, legal, counselling and reporting options, each labelled verified / partner / informational | 4   | P    |
| REC-3 | Follow-up tracking       | Record actions and appointments after an incident                                                                                | 4   | P    |
| REC-4 | AI assistance boundaries | AI may explain options and organise information; it must never present itself as a lawyer, clinician or officer                  | 4   | F    |

### Platform

| ID      | Requirement              | Acceptance criteria                                                                                                                                                                                                           | Ph  | Tier |
| ------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| PLAT-1  | Region profiles          | No market-specific value is hard-coded. A market cannot be enabled until its profile is complete and legally reviewed — enforced in code                                                                                      | 1   | —    |
| PLAT-2  | Accessibility floor      | Every safety-critical control has a label and role, ≥4.5:1 contrast, a ≥44pt target, and is operable one-handed and with a screen reader; safety-critical screens lay out correctly under RTL, because Urdu is the PK default | 1   | —    |
| PLAT-3  | Full accessibility       | WCAG 2.2 AA across the app; audited externally                                                                                                                                                                                | 6   | —    |
| PLAT-4  | SOS never blocks on auth | A pre-authorised emergency token lets an SOS dispatch with an expired session or skewed clock                                                                                                                                 | 1   | —    |
| PLAT-5  | Spend cap                | Hard per-user and per-tenant notification ceilings, enforced server-side                                                                                                                                                      | 1   | —    |
| PLAT-6  | Remote kill switch       | Any feature can be disabled server-side without a release; staged rollout for all releases                                                                                                                                    | 2   | —    |
| PLAT-7  | Shared safety domain     | The three state machines and escalation rules are one pure, 100%-branch-covered implementation used by both client and server                                                                                                 | 1   | —    |
| PLAT-8  | Observability            | Dashboards for delivery, acknowledgement, false activation, upload failure and battery, with **no coordinates or contact details in logs**                                                                                    | 1   | —    |
| PLAT-9  | No fake success          | No success state may render without a corresponding verified record. Enforced by lint rule and test                                                                                                                           | 0   | —    |
| PLAT-10 | Billing and entitlements | Tier gating per [`MONETIZATION.md`](MONETIZATION.md); basic emergency help is never gated                                                                                                                                     | 5   | —    |
| PLAT-11 | Localisation             | UI and alert copy in a message catalogue with further languages; contact guidance localised per region profile. RTL layout of safety-critical screens is PLAT-2, not this                                                     | 6   | —    |
| PLAT-12 | Wearables                | Trigger from a watch; standalone LTE SOS with no phone present                                                                                                                                                                | 6   | P    |

**60 requirements** across six pillars (`PREV` 6 · `DET` 9 · `RES` 20 · `PRO` 9 · `REC` 4 · `PLAT` 12). Traceability to the original requirements document is in
[`../audit/REQUIREMENTS_AUDIT.md`](../audit/REQUIREMENTS_AUDIT.md).

---

## 7. Success metrics

### North star — **verified alert deliveries per month**

Not installs, not DAU. A safety app's value is help actually delivered, and this is
the only metric that measures it. **It is zero today**, which is the honest one-line
summary of the product.

### Activation — the metric most products get wrong

> A user is **activated** when they have **≥2 consented trusted contacts** _and_ have
> completed **one Practice Mode run**.

An installed app with no consented contacts is worth nothing in an emergency. Tying
activation to demonstrated readiness — rather than signup — is what keeps onboarding
honest.

### Primary

| Metric                                                | Target                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| Alert delivery success (≥1 contact, connected device) | ≥99% within 10s                                                   |
| Contact acknowledgement rate                          | Tracked from launch; no target until baselined                    |
| Time to first acknowledgement                         | p50 and p95 reported                                              |
| False activation rate, per trigger type               | Published per model from Phase 3                                  |
| Successful safety sessions                            | Started → completed or resolved, contacts updated, closed cleanly |

### Guardrails — a breach blocks release

| Metric                             | Threshold                           |
| ---------------------------------- | ----------------------------------- |
| Battery drain, monitoring mode     | < 3%/hr                             |
| Crash-free sessions                | ≥ 99.5%                             |
| Contact opt-out rate               | Watched as the alert-fatigue signal |
| Notification spend per active user | Under the configured cap            |
| Cross-tenant data exposure         | Zero, always                        |

### Business

Free→paid conversion · CAC/LTV by segment · free-tier unit economics ·
per-alert cost × fan-out × false-positive rate.

**Measure delivery separately from sessions.** An uneventful journey is not evidence
that Lumo can respond to a real emergency.

---

## 8. Release criteria

A public launch is blocked until **all** of these hold. Criteria are fixed before
testing, never adjusted after seeing results.

- [ ] Delivery target met under load, on real Android **and** iOS hardware
- [ ] The full failure matrix in [`../engineering/TEST_MATRIX.md`](../engineering/TEST_MATRIX.md) passes, including offline, permission-denied, reboot, process-kill, provider outage and duplicate-request cases
- [ ] False activation rate measured and below threshold for every enabled trigger
- [ ] **No screen claims a capability it lacks** (PLAT-9 automated check green)
- [ ] Accessibility floor (PLAT-2) verified with a screen reader on both platforms
- [ ] External security review closed, with no high findings open
- [ ] Threat model reviewed, including the abuse cases in [`../engineering/THREAT_MODEL.md`](../engineering/THREAT_MODEL.md)
- [ ] Remote kill switch live and exercised
- [ ] Store data-safety disclosures match actual behaviour
- [ ] Region profiles for all enabled markets complete and legally reviewed
- [ ] Incident response plan documented with a named on-call owner
- [ ] Practice Mode available and discoverable during onboarding

---

## 9. Pricing summary

Full model in [`MONETIZATION.md`](MONETIZATION.md). The principle:

> **The ability to ask for help is never behind a paywall.**

Free forever: manual SOS, all triggers, 3 trusted contacts, journeys, check-ins,
hazard map, fake call, practice mode, offline fallback. Monetise convenience,
storage, coordination and organisational features — never the emergency itself.

---

## 10. Risks

| Risk                                                | Mitigation                                                             | Owner    |
| --------------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| **False sense of security** — the defining risk     | PLAT-9, the delivery ledger, explicit limitations in-product           | Product  |
| False alerts distress contacts and burn the network | Countdown, confirmation, adaptive escalation, opt-out tracking         | Eng      |
| Missed emergencies                                  | Fallback chain, offline queue, published limits, independent testing   | Eng      |
| Background restrictions silently disable triggers   | Platform capability matrix, per-OS validation, in-app status surfacing | Mobile   |
| AI misclassification                                | Layered decisions, measured thresholds, AI never decides               | AI       |
| Privacy breach endangers users physically           | Encryption, least privilege, retention limits, no PII in logs          | Security |
| App becomes a stalking tool                         | Consent re-confirmation, visible sharing, no hidden tracking           | Product  |
| Unverified reports mislead                          | Confirmation floors, decay, source labelling, no demographic data      | Product  |
| Notification cost spiral                            | Spend cap, rate limits                                                 | Eng      |
| Low activation                                      | Practice mode in onboarding, contact consent flow                      | Growth   |

### Locked decisions

| Date       | Decision                                              | Reasoning                                                                                       |
| ---------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 2026-10-26 | Named **Lumo**                                        | [ADR-0007](../adr/0007-name-the-product-lumo.md)                                                |
| 2026-10-26 | On-device AI preferred                                | Cost, offline capability, and privacy as a product claim                                        |
| 2026-10-27 | **Region-agnostic**; first profiles **Pakistan + US** | Market deferred; two maximally different profiles prove the abstraction rather than assuming it |
| 2026-10-27 | Freemium B2C, basics free forever                     | Ethics, and the network effect the map and contacts depend on                                   |
| 2026-10-27 | Specs before code                                     | The absence of this document is why the app has four triggers and no response                   |
| 2026-10-27 | Three state machines, not one                         | [ADR-0008](../adr/0008-three-state-machines.md)                                                 |
| 2026-10-27 | Hazard reports replace danger zones                   | [ADR-0010](../adr/0010-hazard-reports-replace-danger-zones.md)                                  |
