# Roadmap

> Dependency-ordered. Each phase has a **falsifiable** exit criterion.
> Accessibility, security review, threat-model update and observability are
> **per-phase gates, not phases**. Requirement IDs from [`PRD.md`](PRD.md).

## Phase 0 — Foundations and truth

**Goal:** establish what Lumo promises versus what it can deliver, and stop the app
lying.

Specs (this deliverable) · de-fake the UI: every mock labelled a demo in-product ·
PLAT-9 lint rule + test · fixes: the alert-loop defect (`App.tsx:140-151`), the no-op
`pnpm typecheck`, the `JWT_SECRET` fallback, the hardcoded LAN IP, Prisma migration
baseline, settings DTO + transaction, helmet/CORS/throttler, exception filter, CI ·
`DangerZone` → `HazardReport` · delete the three empty packages · the 7 skills.

**Exit:** every advertised emergency action has a named owner, a supported platform, a
failure path and a testable completion condition. No screen claims a capability it
lacks. CI green with a **real** typecheck.

## Phase 1 — Core personal safety

`PLAT-7` `PLAT-1` `PLAT-2` `PLAT-4` `PLAT-5` `PLAT-8` · `DET-1/2/3/9` ·
`RES-1…RES-4` `RES-6…RES-14` `RES-16…RES-18` · `PRO-6/7/9`

`packages/safety-domain` extracted **first**, 100% branch-covered, before any feature
uses it · contacts **with consent** · circles with scoped, expiring membership ·
manual SOS + countdown + emergency token · Journey Guardian · Safety Check templates
with **server-side timers** · real location with accuracy and staleness handling ·
**Delivery Ledger** · escalation engine · `apps/web`: the tokenised journey page only
· region profiles **PK + US** · Practice Mode · accessibility floor · incident history.

**Exit:** on real Android **and** iOS, with connectivity interrupted, permissions
denied and duplicate requests replayed — a trigger produces a delivered message with a
working link on a second device, the ledger reports per-channel truth **including
failures**, and no duplicate incident is created. A contact with no app follows a
journey in a browser.

## Phase 2 — Evidence and discreet safety

`PRO-1…PRO-5` `PRO-8` · `DET-8` · `RES-5` `RES-15` `RES-19` · `REC-1` · `PLAT-6`

Authorised capture · encrypted resumable upload with verification · Integrity Report ·
access audit · duress code · discreet triggers where the OS permits · SMS fallback ·
battery-death watchdog · siren/strobe offline · kill switch + staged rollout.

**Exit:** failures are visible and never reported as backed up before verification ·
cross-account evidence access impossible · a duress cancel escalates silently and the
device reveals nothing · evidence survives an attacker holding the unlocked phone.

⚠️ **Gated on the US all-party recording-consent question** — see [`../specs/REGION_PROFILES.md`](../specs/REGION_PROFILES.md).

## Phase 3 — AI safety intelligence

`DET-4…DET-7`

Research spike, then: on-device wake word · distress phrases and safeword · audio-event
classifier · sequence-based crash/fall replacing the single 6 G threshold · explainable
notifications · accelerometer consolidation + duty cycling.

**Exit:** published FP/FN per model on a held-out, independently reviewed set,
**reported per demographic group** · battery < 3%/hr · no audio leaves the device by
default · every escalation reconstructible to signal + model + version + threshold.

## Phase 4 — Community and support

`PREV-1…PREV-6` · `RES-20` · `REC-2/3/4`

Hazard reports with source, confidence and decay · Safety Places with verification
tiers · moderation and bias mitigations · vetted responders (pairs only, ratings,
insurance, liability review) · legal/counselling directory · Support Navigator · org
portals with least privilege.

**Exit:** a community report can never become an authoritative safety claim · org
access provably limited to authorised data · one pilot community completes real
assisted journeys.

## Phase 5 — Monetisation and growth

`PLAT-10` — billing and entitlements · Free/Plus/Family/Business · referral and the
install-free-link loop · trust and transparency page.

**Exit:** paying subscribers; free-tier unit economics positive with the spend cap enforced.

## Phase 6 — Advanced integrations

`PLAT-3` `PLAT-11` `PLAT-12` — professional monitoring (only where a real partner and
process exist) · dispatch under formal agreement · wearables incl. standalone LTE SOS ·
public-alert feeds · i18n (message catalogue and further languages; RTL layout of safety-critical screens lands in Phase 1 with the accessibility floor) · full WCAG AA · biometric lock and stealth mode.

**Exit:** every integration has a signed agreement, an operational owner, a test
procedure, a supported geography, a failure process and an accurate user-facing
description.

## Permanently out of scope

Earthquake/crisis alerting at platform scale · satellite SOS · OS power-button capture
· unilateral emergency dispatch · crash detection marketed as automotive-grade ·
continuous background location by default · guaranteed legal admissibility of evidence.

## Sequencing notes

Phases 0–2 are strictly ordered — **there is no credible product before Phase 2
exits.** 3 and 4 parallelise once 2 lands. 5 must not start before Phase 2's cost model
is validated.
