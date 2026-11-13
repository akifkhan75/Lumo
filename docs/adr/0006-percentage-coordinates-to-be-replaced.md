# ADR-0006: Percentage coordinates were a porting shortcut, not a design

- **Status:** Superseded by [ADR-0010](0010-hazard-reports-replace-danger-zones.md) (data model) and milestone 1.5 (a real map replaced the background image) — see [KI-2](../audit/KNOWN_ISSUES.md)
- **Date:** 2026-10-04 (decided), 2026-10-26 (recorded)
- **Deciders:** Project owner

## Context

The app originated as a web prototype where the "map" was a background image and
danger zones were `<div>`s positioned with CSS `top`/`left` percentages. When the
backend was built, the schema mirrored that representation so the existing UI did
not have to change:

```prisma
model DangerZone {
  top  String   // "45%"
  left String   // "60%"
}
```

The schema comment states the reason outright: _"Storing as string to match
existing frontend implementation"_.

## Decision

We recorded this as a deliberate, temporary shortcut: keep percentage positions so
the migration to NestJS + Prisma could ship without rewriting the map UI, and
treat the geospatial model as separate, later work.

Because `POST /danger-zones` had no coordinates to accept, the controller
**synthesises** them:

```ts
const top = `${48 + Math.random() * 4}%`;
const left = `${48 + Math.random() * 4}%`;
```

## Consequences

**Good**

- The migration shipped without touching the UI; the full stack worked end to end

**Bad — and the cost is now the project's largest blocker**

- **Reports have no real location.** Every submission lands in a random spot near
  the centre of a JPEG. The community map is decorative
- No proximity alerts, no safe routing, no nearby-help, no distance filtering —
  the entire prevention half of the product ([COMPETITIVE_ANALYSIS.md](../gtm/COMPETITIVE_ANALYSIS.md))
- `GET /danger-zones` cannot be filtered or paginated meaningfully, so it returns
  every row ever written
- Coordinates as `String` cannot be indexed or compared
- The data accumulated under this model **has no salvage value** — there is nothing
  to backfill from

**Honest assessment:** the shortcut was defensible for a migration sprint, but it
was recorded nowhere, and the random-coordinate generation in the controller turned
a display hack into **fabricated data**. That part was a mistake, not a trade-off.

## Supersede with

Add `latitude Float`, `longitude Float`, `geohash String`, `accuracyM Float?`,
`expiresAt`, `confirmCount` (+ indexes); accept coordinates from the client; render
with `react-native-maps`; query by bounding box; **delete** `top`/`left` and the
`Math.random()` block. Migration sketch in [DATABASE.md](../engineering/DATABASE.md); this is
Phase 1 of [ROADMAP.md](../product/ROADMAP.md).

Write the superseding ADR when that lands.

## Lesson

A shortcut taken to protect a migration is fine. A shortcut that **invents data**
is not — it should have thrown a 400 asking for coordinates instead of generating
them. Record shortcuts as ADRs when you take them, so the next person inherits the
reasoning and not just the symptom.
