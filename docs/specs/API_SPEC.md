# API Specification

> Target API. Current state: [`../engineering/API.md`](../engineering/API.md).
> `/api/v1`. Bearer JWT, except the emergency and public-link paths.

## Cross-cutting

**Idempotency.** Every mutating emergency endpoint requires an `Idempotency-Key`
header. A repeat returns the **existing** resource with `200`, never a duplicate.

**Emergency token (PLAT-4).** A narrowly-scoped, short-lived token minted at session
start and refreshed opportunistically. It authorises **exactly one action** — create
and dispatch an incident. It cannot read contacts, history or evidence. This is why an
expired session never blocks an SOS (B11), and why its scope must stay minimal (T4).

**Errors.** A global exception filter; `message` is always a string. Today validation
returns an array and plain exceptions a string, which arrives at the UI stringified
(API-2).

**Pagination.** Every collection is paginated. No endpoint returns an unbounded set
(API-3).

**Rate limits + spend cap.** Per user and per tenant, enforced server-side (PLAT-5).

## Endpoints

### Emergency — `POST /sos`

Emergency token accepted. `Idempotency-Key` required.
Body: `triggerType`, `triggeredAt`, optional `location{lat,lng,accuracyM,capturedAt}`,
optional `sessionId`, `mode: 'real'|'practice'`, `duress: boolean`.
→ `201` (or `200` on replay) with the incident and its initial ledger.
**Dispatch does not wait on location, the queue, AI, or evidence.**

- `POST /incidents/:id/resolve` — contacts are told it ended
- `POST /incidents/:id/cancel` — countdown window only
- `GET /incidents/:id` — incident + per-channel ledger
- `GET /incidents/:id/export` — timeline, ledger, hashes (REC-1)

### Sessions and journeys

`POST /safety-sessions` · `PATCH /safety-sessions/:id` (check in, arrive, suspend) ·
`POST /safety-sessions/:id/location` (batched snapshots) ·
`POST /safety-sessions/:id/links` → journey link · `DELETE /links/:token` (revoke).

### Public journey link — `GET /j/:token`

**Unauthenticated by design.** Returns only what was authorised: current or last-known
location **with age and accuracy**, expected arrival, session status, emergency
guidance, and an acknowledge action. **Never** medical data, evidence, or history.
Opaque ≥128-bit token, expiring, revocable, `noindex`, no referrer leakage (T6).

### Contacts and consent

`POST /trusted-contacts` (sends a consent invite) · `POST /contacts/invites/:token/accept`
· `DELETE /contacts/consent/:id` (contact may revoke) · circles CRUD.
**A non-consented contact is never alerted** (RES-7).

### Acknowledgement — `POST /incidents/:id/ack`

From the app, a push action, or the journey page. Halts the escalation ladder
immediately. Followed optionally by `POST .../unack` ("I can't help after all"), which
**resumes** the ladder — silence after acknowledging must not strand the user.

### Hazard reports

`GET /hazard-reports/nearby?lat&lng&radiusM&cursor` · `POST /hazard-reports`
(coordinates **from the client**, rate-limited) · `POST /hazard-reports/:id/confirm`.
No `severity` field exists. The server no longer invents positions (ADR-0006).

**Built:** `GET /hazard-reports?take` (bounded, live reports only),
`POST /hazard-reports` with required validated coordinates, and
`POST /hazard-reports/:id/confirm` (one per person per report; the reporter
cannot confirm their own). **Not built:** `/nearby` — a radius query needs a
`geohash` or PostGIS index _and_ the device's own location, neither of which
exists yet. See [`../engineering/API.md`](../engineering/API.md) for the shipped
shapes.

### Other

`GET /me` · settings (`UpdateSettingsDto`, transactional contact upsert — KI-7) ·
evidence (`POST /evidence/sessions`, chunk upload, `GET /evidence/:id/integrity`) ·
`POST /devices` (push tokens, capability report) · `GET /region-profile` (resolved
from supplied location) · `GET /health` (real readiness check, not a hello string).
