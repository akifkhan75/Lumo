# Database

- **Engine:** PostgreSQL 15 (`postgres:15-alpine` via `docker-compose.yml`)
- **ORM:** Prisma 5.22 (`prisma-client-js`)
- **Schema:** [`apps/api/prisma/schema.prisma`](../../apps/api/prisma/schema.prisma)
- **Host port:** `5434` → container `5432` (chosen to avoid colliding with a local Postgres)
- **Volume:** `postgres_data_v2`

```
DATABASE_URL="postgresql://lumo:lumo_password@localhost:5434/lumo_db?schema=public"
```

---

## Model graph

```
┌────────────────────────────────┐
│ User                           │
│  id            String  @id uuid│
│  email         String  @unique │
│  passwordHash  String          │  argon2id
│  fullName      String          │
│  bloodType     String?         │
│  allergies     String?         │
│  ── security flags ──          │
│  locationSharingEnabled   @default(true)
│  shareLocationOnSos       @default(true)
│  sendSmsOnSos             @default(false)
│  shakeToSosEnabled        @default(true)
│  voiceActivationEnabled   @default(false)
│  accidentDetectionEnabled @default(false)
│  createdAt / updatedAt         │
└──────┬──────────────────┬──────┘
       │ 1:N              │ 1:N
       │ onDelete:Cascade │ onDelete:SetNull
┌──────▼──────────┐  ┌────▼──────────────────────────────┐
│ TrustedContact  │  │ HazardReport                      │
│  id    uuid     │  │  id             uuid              │
│  name  String   │  │  type           enum HazardType   │
│  phone String   │  │  source         enum  @default()  │
│  userId FK      │  │  description    String             │
└─────────────────┘  │  latitude       Float              │ ← real geo
                     │  longitude      Float              │ ← real geo
                     │  accuracyMetres Float?  nullable   │
                     │  reportedAt     @default(now())    │
                     │  expiresAt      DateTime           │ ← mandatory decay
                     │  userId         FK?  nullable      │
                     └────┬──────────────────────────────┘
                          │ 1:N  onDelete:Cascade
                     ┌────▼──────────────────────────────┐
                     │ HazardConfirmation                │
                     │  id        uuid                    │
                     │  reportId  FK                      │
                     │  userId    FK                      │
                     │  createdAt @default(now())         │
                     │  @@unique([reportId, userId])      │
                     └───────────────────────────────────┘
```

**There is no `severity` column, and there must not be.** A danger grade attached
to a place is the redlining primitive; reports carry a type, an age and a
confirmation count instead ([ADR-0010](../adr/0010-hazard-reports-replace-danger-zones.md)).
There is also **no demographic field of any kind** — not optional, absent.

`confirmationCount` is **not stored.** It is a relation count over
`HazardConfirmation`, because a denormalised counter drifts, and a drifted count
here would promote an unconfirmed report into routing.

### Delete semantics

- `User` → `TrustedContact`: **Cascade.** Deleting a user removes their contacts.
- `User` → `HazardReport`: **SetNull.** Reports survive the reporter, becoming
  anonymous community data. That is the right call for the product, and it is why
  `HazardReport.userId` is optional.
- `User` → `HazardConfirmation`: **Cascade.** A confirmation is meaningless
  without the person who gave it, and leaving orphans would inflate counts.
- `HazardReport` → `HazardConfirmation`: **Cascade.**

---

## Enums

```prisma
enum HazardType {
  POOR_LIGHTING
  OBSTRUCTED_PATH
  BROKEN_INFRASTRUCTURE
  UNSAFE_CROSSING
  THEFT_REPORTED
  HARASSMENT_REPORTED
  AGGRESSION_REPORTED
  OTHER
}

enum HazardReportSource { COMMUNITY  VERIFIED_PARTNER  OFFICIAL_FEED }
```

### One spelling, everywhere

`HazardType` members are identical in Prisma, in Postgres and on the wire. **No
`@map`, no hand-written mappers.** The human label lives in exactly one place,
`HAZARD_TYPE_LABELS` in `packages/types`, and is a presentation concern.

Adding a type means editing `schema.prisma`, `packages/types/src/index.ts` (the
union _and_ the label map — the compiler enforces the latter via `Record`), and
`HAZARD_TTL_DAYS` in the service, which is also compiler-enforced.

This is a deliberate correction. `DangerZoneType` had **three** spellings of one
value — `Suspicious_Activity` in Prisma, `"Suspicious Activity"` in Postgres via
`@map`, and the space-separated string on the wire — translated by hand in
`mapInputType`/`mapOutputType`. `mapInputType` had **no error branch**, so any
unrecognised string silently became `Suspicious_Activity`: a client typo became
bad data rather than a `400`. An unknown value is now rejected by `@IsEnum`.

### Expiry

`expiresAt` is set on create from `HAZARD_TTL_DAYS[type]` in
`HazardReportsService`, and list queries filter `expiresAt > now()`. A report
therefore stops being served without any cleanup job, and expired rows are kept
for audit rather than deleted. A confirmation re-arms the expiry from the moment
it is given, and never shortens one that is already further out.

| Type                    | TTL     |
| ----------------------- | ------- |
| `UNSAFE_CROSSING`       | 90 days |
| `BROKEN_INFRASTRUCTURE` | 60 days |
| `POOR_LIGHTING`         | 30 days |
| `THEFT_REPORTED`        | 14 days |
| `HARASSMENT_REPORTED`   | 14 days |
| `AGGRESSION_REPORTED`   | 14 days |
| `OBSTRUCTED_PATH`       | 7 days  |
| `OTHER`                 | 7 days  |

The values differ by physics, not by how alarming the type sounds: a kerb stays
broken for weeks, a blocked path is usually cleared in days. The table is policy
and moves to `packages/safety-domain` in Phase 1 so the device and the server
cannot disagree about whether a report is live.

---

## Migrations

`apps/api/prisma/migrations/` is the source of truth. Two migrations exist: the
baseline, and the one that replaced `DangerZone` with `HazardReport`. CI applies
them against a clean `postgres:15` and then fails the build if `schema.prisma`
and the history disagree, so drift cannot reach `main`.

`db push` is no longer part of any workflow. `archive/PRODUCTION_AUDIT.md` claimed
migrations were tracked long before they were; that claim was false then and is
true now ([KI-5](../audit/KNOWN_ISSUES.md), resolved).

### Workflow

```bash
docker compose up -d postgres
pnpm --filter api exec prisma generate         # regenerate the client after schema edits
pnpm --filter api exec prisma migrate dev --name <change>   # author a migration
pnpm --filter api exec prisma migrate deploy   # apply in CI / production
pnpm --filter api exec prisma studio           # browse the data
```

Generating a migration offline, without a dev database, is also supported and is
how both existing migrations were produced:

```bash
pnpm --filter api exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" --script
```

The same command with no `--script` is the drift check: it must print
`No difference detected.`

> The HazardReport migration **drops `DangerZone` and every row in it**, with no
> backfill. That is deliberate and irreversible: the old table stored CSS
> percentages the server generated with `Math.random()`, so no row recorded where
> anything actually was, and there is no function from a fabricated percentage to
> a coordinate.

---

## Seeding

```bash
pnpm --filter api exec prisma db seed
```

Configured as `node --loader ts-node/esm prisma/seed.ts`. It is **idempotent** —
`upsert` on email, which also resets the password hash — and re-running it does
not pile up duplicates.

Seed data:

|          |                                                                |
| -------- | -------------------------------------------------------------- |
| User     | `josim@example.com` / password **`password`**, blood type `O+` |
| Contacts | `Mom` `111-222-3333`, `Emergency Services` `911`               |
| Reports  | **none, deliberately**                                         |

The seed used to create three hazard reports — _"a physical assault was reported
here last night"_ among them — at invented positions, attributed to the demo user.
That is fabricated community testimony about a place, and a screenshot of it is
indistinguishable from real data. A development database starts with an empty map,
because the empty state is part of the product and needs to be seen.

`AuthScreen.tsx` ships with these credentials prefilled, which is convenient in
development and must be removed before any public build.

---

## Indexes and performance

Beyond the implicit ones (primary keys, the unique index on `User.email`,
foreign-key indexes):

| Index                                    | Why                                      |
| ---------------------------------------- | ---------------------------------------- |
| `TrustedContact(userId)`                 | On the path that resolves who to alert   |
| `HazardReport(userId)`                   | A reporter's own history                 |
| `HazardReport(expiresAt)`                | Every list query filters on it           |
| `HazardReport(reportedAt)`               | Every list query orders by it            |
| `HazardConfirmation(userId)`             | A confirmer's history                    |
| `HazardConfirmation(reportId, userId)` ✱ | **Unique** — one confirmation per person |

`GET /hazard-reports` is bounded: `take` defaults to 50 and is capped at 200, so
the endpoint cannot return the whole table. It is still not a proximity query —
that needs the device's own location, which does not exist yet.

---

## What the data model still needs

Real coordinates have landed ([KI-2](../audit/KNOWN_ISSUES.md), ADR-0010), so the
remaining gaps are new entities rather than a correction:

- **Geospatial querying.** `latitude`/`longitude` are plain `Float` columns with
  no spatial index, so there is no radius query yet. The options are a `geohash`
  column with prefix matching, or PostGIS. Neither is needed before the device can
  report its own position.
- **Moderation.** A report is visible as soon as it is written. Nothing reviews
  it, and `HAZARD_CONFIRMATION_FLOOR` only gates whether it influences routing.
- **Dispute and removal.** There is no way to contest or withdraw a report.

Other models the roadmap needs: `SafetySession`, `EmergencyIncident`,
`NotificationAttempt` (the delivery ledger), `Journey` + `JourneyPing`, `CheckIn`,
`Device` (push tokens). See [ROADMAP.md](../product/ROADMAP.md) and
[DATA_MODEL.md](../specs/DATA_MODEL.md).

---

## Operational notes

- **Connection pooling** is Prisma's default singleton pool. `PrismaService` is
  provided by a `@Global()` module, so there is exactly one client per process.
- **No soft deletes, no audit trail.** A safety app will eventually need both —
  an incident record is evidence.
- **Backups:** none configured. The Docker volume is the only copy of local data.
- **PII:** `email`, `fullName`, `bloodType`, `allergies`, and contact phone numbers
  are all stored in plaintext. See [SECURITY_AND_PRIVACY.md](SECURITY.md).
