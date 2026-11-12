# API Reference

NestJS 12 REST API. **Verified against `apps/api/src/` on 2026-10-26.**

- **Base URL (dev):** `http://<host>:3005` — but `main.ts` defaults `API_PORT` to
  **3001**. Set `API_PORT=3005` in `apps/api/.env`; the mobile client assumes 3005.
- **Prefix:** every controller spells out `api/v1/...` itself. There is no global
  prefix and no `enableVersioning()`.
- **Auth:** `Authorization: Bearer <jwt>` on everything except `/auth/*` and `/`.
- **CORS:** `app.enableCors()` with no options — all origins allowed.
- **Validation:** global `ValidationPipe({ transform: true, whitelist: true })`.
  Properties without a `class-validator` decorator on the DTO are **silently
  stripped** from the body.

The canonical client for all of this is
[`packages/api-client`](../../packages/api-client/src/index.ts) — prefer adding a
method there over calling `fetch` anywhere else.

---

## Health

### `GET /`

Public. Returns the string from `AppService.getHello()`. Used by the e2e suite as
a liveness check.

---

## Authentication — `/api/v1/auth`

Public. Both endpoints return a signed JWT (`{ email, sub: userId }`, **7-day
expiry**, HS256, secret from `JWT_SECRET`). Passwords are hashed with **argon2id**.

### `POST /api/v1/auth/login` → `200 OK`

```json
{ "email": "josim@example.com", "password": "password" }
```

| Field      | Rules                      |
| ---------- | -------------------------- |
| `email`    | `@IsEmail`, `@IsNotEmpty`  |
| `password` | `@IsString`, `@IsNotEmpty` |

Response:

```json
{
  "token": "eyJhbGciOi...",
  "user": { "id": "uuid", "email": "josim@example.com", "fullName": "Josim" }
}
```

Errors: `401` `Invalid credentials` (same message for unknown email and wrong
password — deliberate, do not make it specific), `400` on validation failure.

### `POST /api/v1/auth/signup` → `201 Created`

```json
{
  "email": "new@example.com",
  "password": "atleast6",
  "fullName": "New User",
  "name": "New User"
}
```

| Field      | Rules                                     |
| ---------- | ----------------------------------------- |
| `email`    | `@IsEmail`, `@IsNotEmpty`                 |
| `password` | `@IsString`, `@MinLength(6)`              |
| `fullName` | `@IsString`, `@IsOptional`                |
| `name`     | `@IsString`, `@IsOptional` — legacy alias |

Both `fullName` and `name` are accepted; the service resolves
`fullName || name || 'User'`. The client sends both. Response shape matches login.

Errors: `400` `User with this email already exists`.

> No email verification, no password reset, no refresh token, no rate limiting,
> and `MinLength(6)` is the only password rule. See
> [SECURITY_AND_PRIVACY.md](SECURITY.md).

---

## Settings — `/api/v1/settings`

`@UseGuards(JwtAuthGuard)` at the controller level. Always scoped to the caller;
there is no way to read another user's settings.

### `GET /api/v1/settings` → `200 OK`

Composed from the flat `User` row plus its `TrustedContact[]`:

```json
{
  "personalInfo": {
    "fullName": "Josim",
    "bloodType": "O+",
    "allergies": "None"
  },
  "trustedContacts": [{ "id": "uuid", "name": "Mom", "phone": "111-222-3333" }],
  "security": {
    "locationSharingEnabled": true,
    "shareLocationOnSos": true,
    "sendSmsOnSos": false,
    "shakeToSosEnabled": true,
    "voiceActivationEnabled": false,
    "accidentDetectionEnabled": false
  }
}
```

`bloodType` and `allergies` are nullable columns coerced to `""`.

Errors: `404` `User not found` (a valid token for a deleted user), `401` without a token.

### `PUT /api/v1/settings` → `200 OK`

Accepts the same shape; all three sections are optional, and within
`personalInfo` / `security` any subset of fields may be sent (`undefined` fields
are skipped by Prisma). Returns the full re-read settings object.

```json
{
  "personalInfo": {
    "fullName": "Josim",
    "bloodType": "O+",
    "allergies": "Penicillin"
  },
  "security": { "shakeToSosEnabled": false },
  "trustedContacts": [{ "name": "Mom", "phone": "111-222-3333" }]
}
```

**Two behaviors to know before you call this:**

1. The handler is typed `@Body() body: any`, so it **opts out of the global
   ValidationPipe**. Garbage in this body reaches Prisma. ([KI-7](../audit/KNOWN_ISSUES.md))
2. If `trustedContacts` is present, the service **deletes every contact and
   recreates the array**, outside a transaction. Contact `id`s change on every
   save, and a crash between the two statements leaves the user with **no
   emergency contacts**. Omit the key entirely to leave contacts untouched.

---

## Hazard Reports — `/api/v1/hazard-reports`

`@UseGuards(JwtAuthGuard)` at the controller level. Replaces
`/api/v1/danger-zones`, which is **gone, not deprecated** — the shape is
incompatible and there is no transitional alias ([ADR-0010](../adr/0010-hazard-reports-replace-danger-zones.md)).

A hazard report is an observation about a **condition**, with a source, an age,
an expiry and a confirmation count. There is no `severity`, and adding one back
is rejected on sight.

### `GET /api/v1/hazard-reports` → `200 OK`

Live reports from all users, newest first (`reportedAt desc`). Expired reports are
never returned.

| Query  | Default | Max   |
| ------ | ------- | ----- |
| `take` | `50`    | `200` |

```json
[
  {
    "id": "uuid",
    "type": "POOR_LIGHTING",
    "source": "COMMUNITY",
    "description": "Streetlight out on the footbridge",
    "coordinates": {
      "latitude": 51.5074,
      "longitude": -0.1278,
      "accuracyMetres": 12.5
    },
    "reportedAt": "2026-10-26T12:00:00.000Z",
    "expiresAt": "2026-11-25T12:00:00.000Z",
    "confirmationCount": 4,
    "influencesRouting": true
  }
]
```

- `coordinates` are **real latitude and longitude**. `accuracyMetres` is `null`
  when the reporting device did not know — render that as unknown, never as a
  precise point.
- `confirmationCount` is derived from `HazardConfirmation` rows, not a stored
  counter, so it cannot drift.
- `influencesRouting` is the server's verdict: a `COMMUNITY` report needs
  `HAZARD_CONFIRMATION_FLOOR` (3) confirmations; a verified source needs none.
  **Clients must not recompute it** — the floor is policy and lives in one place.
- Still no distance filter. A proximity query needs the device's own location,
  which does not exist yet.

### `POST /api/v1/hazard-reports` → `201 Created`

```json
{
  "type": "POOR_LIGHTING",
  "description": "Streetlight out on the footbridge",
  "latitude": 51.5074,
  "longitude": -0.1278,
  "accuracyMetres": 12.5
}
```

| Field            | Values                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`           | `POOR_LIGHTING` \| `OBSTRUCTED_PATH` \| `BROKEN_INFRASTRUCTURE` \| `UNSAFE_CROSSING` \| `THEFT_REPORTED` \| `HARASSMENT_REPORTED` \| `AGGRESSION_REPORTED` \| `OTHER` |
| `description`    | string, 1–280 chars, **no links, email addresses or phone numbers**                                                                                                   |
| `latitude`       | required, valid latitude                                                                                                                                              |
| `longitude`      | required, valid longitude                                                                                                                                             |
| `accuracyMetres` | optional, 0–10000                                                                                                                                                     |

> **The client sets the location, and must.** The predecessor generated it on the
> server — `` top = `${48 + Math.random() * 4}%` `` — so every report described a
> place nobody had been to. Coordinates are now required and validated; a request
> without them is a `400`, and `severity` is a `400` because the DTO has no such
> field and the pipe uses `forbidNonWhitelisted`.

`userId` comes from the JWT. `source` defaults to `COMMUNITY`; it cannot be set by
a client. `expiresAt` is derived from a per-type TTL (`HAZARD_TTL_DAYS`).

### `POST /api/v1/hazard-reports/:id/confirm` → `201 Created`

Records that a second person has observed the same condition, and re-arms
`expiresAt` from now. Returns the updated report.

| Status | When                                     |
| ------ | ---------------------------------------- |
| `404`  | No such report                           |
| `409`  | The reporter confirming their own report |
| `409`  | This user has already confirmed it       |
| `400`  | `:id` is not a UUID                      |

One row per `(reportId, userId)`, enforced by a unique constraint, so repeated
presses cannot inflate a count.

Not implemented: update, delete, dispute, moderation, proximity query.

---

## AI — `/api/v1/ai`

Guards are applied **per route** here (not at the controller), though all three
are currently guarded. Backed by Google Gemini (`@google/genai`,
`gemini-1.5-flash`) with `process.env.API_KEY`.

**Every endpoint degrades gracefully.** With no key, a parse failure or a thrown
error, it returns a hardcoded fallback and still answers `200`. This is intentional
— never make an emergency feature depend on an LLM round-trip. Preserve it.

### `GET /api/v1/ai/fake-call-script` → `200 OK`

```json
{
  "callerName": "Maya",
  "script": ["Hey! Where are you?", "I'm just around the corner…", "Hurry up!"]
}
```

Fallback: `{ "callerName": "Friend", "script": ["Hey, are you there?", …] }`

### `GET /api/v1/ai/self-defense-tips` → `200 OK`

```json
["Yell 'FIRE!' to get attention.", "Run towards a populated, well-lit area."]
```

An array of strings — the model is asked for `{ tips: [...] }` and the service
unwraps it. Fallback: `["Yell for help!", "Run away if possible!", "Aim for vulnerable spots."]`

### `POST /api/v1/ai/safety-chat` → `200 OK`

```json
{ "message": "I'm walking home alone at night", "history": [] }
```

Response: `{ "response": "…" }`

| Field     | Values                                                                     |
| --------- | -------------------------------------------------------------------------- |
| `message` | required, 1–2000 chars                                                     |
| `history` | optional, ≤20 turns, each `{ role: 'user' \| 'model', parts: [{ text }] }` |

> `history` is accepted by both the client and the service and then **never used**
> — the prompt is built from `message` only, so the assistant has no memory within
> a conversation. ([KI-14](../audit/KNOWN_ISSUES.md))

> The body had no DTO until now, so the global pipe skipped it entirely and an
> unbounded `message` went straight into a metered Gemini call. The length and
> history limits above are the spend bound.

The user message is interpolated directly into the prompt string, which is a
prompt-injection surface; it is low-impact today (the output is only displayed)
but matters once the assistant can act.

---

## Errors

Standard NestJS exception shape:

```json
{
  "statusCode": 400,
  "message": ["email must be an email"],
  "error": "Bad Request"
}
```

`message` is a **string** for thrown `HttpException`s and an **array of strings**
for validation failures. `ApiClient.handleResponse` reads `error.message` and
falls back to `HTTP error! status: ${status}`, so an array arrives at the UI
stringified — worth normalising with an exception filter.

| Code  | When                                                |
| ----- | --------------------------------------------------- |
| `400` | Validation failure, or duplicate email on signup    |
| `401` | Missing/invalid/expired token; bad credentials      |
| `404` | `GET /settings` for a user id that no longer exists |
| `500` | Unhandled — e.g. database unreachable               |

There is no global exception filter, no request logging, and no correlation id.

---

## Endpoints the product needs but does not have

Tracked in [ROADMAP.md](../product/ROADMAP.md); listed here so nobody looks for them twice.

| Planned                                                       | Purpose                                                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `POST /api/v1/sos`                                            | Record an incident, fan out to contacts — the real SOS ([KI-3](../audit/KNOWN_ISSUES.md)) |
| `POST /api/v1/journeys`, `PATCH /…/location`, `GET /j/:token` | Real Follow Me with a public tracking link                                                |
| `POST /api/v1/check-ins`                                      | Server-side timer so a dead phone still escalates                                         |
| `GET /api/v1/hazard-reports/nearby?lat&lng&radius`            | Proximity query (needs the device's own location)                                         |
| `POST /api/v1/devices`                                        | Push token registration                                                                   |
| `POST /api/v1/auth/refresh`, `/forgot-password`               | Session and account recovery                                                              |
| `GET /api/v1/me`                                              | Identity without the whole settings payload                                               |
