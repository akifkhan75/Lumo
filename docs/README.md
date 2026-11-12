# Lumo Documentation

> Written so a person — or an AI agent — arriving with no context can be productive in
> one read. Every claim is verified against the source.

```
Lumo — Your Light in the Dark.
```

## Start here

| Read                                                         | To                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [**../CLAUDE.md**](../CLAUDE.md)                             | Get oriented fast — commands, conventions, the facts that cost an hour each     |
| [**product/PRD.md**](product/PRD.md)                         | Understand what Lumo is, for whom, and what "done" means. **The root document** |
| [**audit/FEATURES.md**](audit/FEATURES.md)                   | Know what is **real vs mock**. Non-negotiable before planning or demoing        |
| [**audit/KNOWN_ISSUES.md**](audit/KNOWN_ISSUES.md)           | See the verified gaps, prioritised                                              |
| [**engineering/DEVELOPMENT.md**](engineering/DEVELOPMENT.md) | Get it running                                                                  |

## Product

[PRD](product/PRD.md) · [Feature Catalog](product/FEATURE_CATALOG.md) ·
[Roadmap](product/ROADMAP.md) · [Monetisation](product/MONETIZATION.md) ·
[Metrics](product/METRICS.md)

## Specs — ★ safety-critical

★ [Safety State Machines](specs/SAFETY_STATE_MACHINES.md) ·
★ [Emergency Workflows](specs/EMERGENCY_WORKFLOWS.md) ·
★ [Delivery Ledger](specs/DELIVERY_LEDGER.md) ·
★ [AI Safety](specs/AI_SAFETY_SPEC.md) ·
★ [Region Profiles](specs/REGION_PROFILES.md) ·
[Escalation Policy](specs/ESCALATION_POLICY.md) ·
[Journey Guardian](specs/JOURNEY_GUARDIAN.md) · [Safety Check](specs/SAFETY_CHECK.md) ·
[Evidence Pipeline](specs/EVIDENCE_PIPELINE.md) · [Offline](specs/OFFLINE_ARCHITECTURE.md) ·
[Practice Mode](specs/PRACTICE_MODE.md) · [Data Model](specs/DATA_MODEL.md) ·
[API Spec](specs/API_SPEC.md)

## Design

★ [UX Spec](design/UX_SPEC.md) · ★ [Accessibility](design/ACCESSIBILITY.md) ·
[Design Tokens](design/DESIGN_TOKENS.md) · [Content & Voice](design/CONTENT_STYLE.md)

## Engineering

[Architecture](engineering/ARCHITECTURE.md) ·
★ [Platform Capability Matrix](engineering/PLATFORM_CAPABILITY_MATRIX.md) ·
★ [Threat Model](engineering/THREAT_MODEL.md) ·
★ [Test Matrix](engineering/TEST_MATRIX.md) ·
[Release Criteria](engineering/RELEASE_CRITERIA.md) · [SLO](engineering/SLO.md) ·
[Observability](engineering/OBSERVABILITY.md) · [Security](engineering/SECURITY.md) ·
[Privacy & Consent](engineering/PRIVACY_AND_CONSENT.md) ·
[API](engineering/API.md) · [Database](engineering/DATABASE.md) ·
[Mobile](engineering/MOBILE.md) · [Web](engineering/WEB.md) ·
[Development](engineering/DEVELOPMENT.md) · [Testing](engineering/TESTING.md) ·
[Deployment](engineering/DEPLOYMENT.md)

## Audit

[Requirements Audit](audit/REQUIREMENTS_AUDIT.md) ·
[Technical Audit](audit/TECHNICAL_AUDIT.md) · [Features](audit/FEATURES.md) ·
[Known Issues](audit/KNOWN_ISSUES.md) · ★ [Edge Cases](audit/EDGE_CASES.md)

## Go to market

[Positioning](gtm/POSITIONING.md) · [Segments](gtm/SEGMENTS.md) ·
[Launch Plan](gtm/LAUNCH_PLAN.md) · [Competitive Analysis](gtm/COMPETITIVE_ANALYSIS.md) ·
[Branding](gtm/BRANDING.md)

## Process

[Contributing](CONTRIBUTING.md) · [Glossary](GLOSSARY.md) · [ADRs](adr/README.md) ·
[Archive](archive/) _(historical, contains claims that were never true)_

---

## The three things to know before touching anything

1. **The SOS screen contacts nobody.** It says "Emergency Calling…", renders a
   _hardcoded_ contact ring and "Notifying Nearby Volunteers…", and performs no call,
   SMS, push or location upload.
2. **There are no real coordinates.** Hazard reports are CSS percentages over a JPEG,
   and the server _invents_ the position of every report.
3. **`pnpm typecheck` is a silent no-op** — all 8 turbo tasks resolve to
   `<NONEXISTENT>`, so it exits 0 having checked nothing.

The parts that _are_ real — sensor hooks, module boundaries, shared types, AI
fallbacks, test suites — are well built. The gap is that the response half of the
product was built as UI first.

## Keeping these honest

This repo once shipped an audit claiming Prisma migrations were tracked when
`prisma/migrations/` had never existed. That is the failure mode to avoid.

- Update the relevant doc **in the same PR** as the code
- When a mock becomes real, [`audit/FEATURES.md`](audit/FEATURES.md) changes **first**
- Verify before asserting: read the file, then write the sentence
- The `lumo-docs` skill runs the ID, link and format checks
