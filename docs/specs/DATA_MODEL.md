# Data Model

> Field-level target schema. Current schema and its defects:
> [`../engineering/DATABASE.md`](../engineering/DATABASE.md).
> Prisma 5 / PostgreSQL 15. Migrations are the source of truth (`apps/api/prisma/migrations/`); CI fails on drift.

## Conventions

- `id String @id @default(uuid())` throughout, matching the existing schema
- All timestamps `DateTime`, stored UTC. **Server time is authoritative** for ordering
  and idempotency (device clocks are untrusted — edge case B12)
- Monetary values in **minor units** as `Int`, with an explicit currency
- `@@index` declared wherever a column is filtered or sorted. The current schema has
  **none at all** (KI-24)
- Append-only tables are never updated or deleted — they are evidence

---

## Phase 0

```prisma
model User {
  id            String   @id @default(uuid())
  email         String   @unique
  passwordHash  String
  fullName      String
  bloodType     String?        // encrypted at rest (KI-26)
  allergies     String?        // encrypted at rest
  regionProfileId String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  trustedContacts TrustedContact[]
  sessions        SafetySession[]
  incidents       EmergencyIncident[]
  devices         Device[]
  consents        ConsentRecord[]
  @@index([regionProfileId])
}

model HazardReport {                     // replaces DangerZone — ADR-0010
  id             String             @id @default(uuid())
  type           HazardType
  source         HazardReportSource @default(COMMUNITY)
  description    String                      // see PREV-6: free text to be constrained in Phase 4
  latitude       Float
  longitude      Float
  accuracyMetres Float?                      // nullable on purpose — unknown must travel as unknown
  reportedAt     DateTime           @default(now())
  expiresAt      DateTime                    // mandatory decay — T7
  confirmations  HazardConfirmation[]        // count is DERIVED, never stored
  userId         String?
  user           User?              @relation(fields: [userId], references: [id], onDelete: SetNull)
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt

  @@index([userId])
  @@index([expiresAt])
  @@index([reportedAt])
  // @@index([geohash]) — NOT BUILT. No radius query exists until the device can read
  // its own position (Phase 1, milestone 1.4); the column and index arrive with it.
}

model HazardConfirmation {                 // one row per person per report
  id        String       @id @default(uuid())
  reportId  String
  report    HazardReport @relation(fields: [reportId], references: [id], onDelete: Cascade)
  userId    String
  user      User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime     @default(now())

  @@unique([reportId, userId])
  @@index([userId])
}

// SCREAMING_SNAKE everywhere — Prisma, Postgres and the wire. No @map, no hand-written
// mappers (CLAUDE.md §7). The human label lives in HAZARD_TYPE_LABELS in @lumo/types.
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
enum HazardReportSource { COMMUNITY VERIFIED_PARTNER OFFICIAL_FEED }
```

**No `severity` field, and no demographic field of any kind** — not optional, absent.
Both are structural mitigations for T7 (crowdsourced redlining).

---

## Phase 1 — sessions, incidents, delivery

```prisma
model TrustedContact {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name       String
  phone      String                       // encrypted at rest
  email      String?                      // encrypted at rest
  consentId  String?  @unique
  consent    ConsentRecord? @relation(fields: [consentId], references: [id])
  priority   Int      @default(0)
  removedAt  DateTime?                    // soft delete: the ledger refers to contacts by id
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@index([userId, priority])
}

model ConsentRecord {                      // consent is a record, never a flag
  id         String   @id @default(uuid())
  subjectId  String?                       // null when the subject is not a Lumo user
  grantedById String
  kind       ConsentKind
  scope      String
  grantedAt  DateTime @default(now())
  revokedAt  DateTime?
  reconfirmDueAt DateTime?                 // PRO-8 periodic re-confirmation
  regionProfileId String
  version    String
  @@index([grantedById, kind])
  @@index([reconfirmDueAt])
}
enum ConsentKind { contact_role location_sharing recording data_processing }

model SafetySession {
  id             String  @id @default(uuid())
  userId         String
  user           User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind           SessionKind
  state          SessionState @default(CREATED)
  priorState     SessionState?              // restored from SUSPENDED
  destinationLat Float?
  destinationLng Float?
  destinationLabel String?
  expectedArrivalAt DateTime?
  checkInDueAt   DateTime?
  escalationPolicyId String
  shareLocation  Boolean @default(true)
  startedAt      DateTime?
  endedAt        DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  events     SessionEvent[]
  locations  LocationSnapshot[]
  links      JourneyLink[]
  incidents  EmergencyIncident[]
  @@index([userId, state])
  @@index([checkInDueAt])                  // the server-side watchdog scans this
}
enum SessionKind  { walk_home date ride travel outdoor custom }
enum SessionState { CREATED ACTIVE CHECK_IN_DUE GRACE ESCALATING ALERTED ARRIVED CLOSED SUSPENDED CANCELLED EXPIRED }

model SessionEvent {                        // append-only
  id        String   @id @default(uuid())
  sessionId String
  session   SafetySession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  fromState SessionState?
  toState   SessionState
  event     String
  actor     Actor
  reason    String?
  occurredAt DateTime                        // true occurrence, not sync time
  recordedAt DateTime @default(now())
  @@index([sessionId, occurredAt])
}
enum Actor { user system policy contact }

model LocationSnapshot {
  id         String  @id @default(uuid())
  sessionId  String?
  incidentId String?
  latitude   Float
  longitude  Float
  accuracyM  Float                          // non-nullable: the UI cannot render a fix without precision
  capturedAt DateTime                       // non-nullable: nor without age (RES-10)
  batteryPct Int?
  source     String
  @@index([sessionId, capturedAt])
  @@index([incidentId, capturedAt])
}

model EmergencyIncident {
  id             String  @id @default(uuid())
  userId         String
  user           User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  sessionId      String?
  session        SafetySession? @relation(fields: [sessionId], references: [id], onDelete: SetNull)
  idempotencyKey String  @unique            // device-minted; collapses retries
  triggerType    TriggerType
  mode           IncidentMode @default(real)
  isDuress       Boolean @default(false)
  state          IncidentState @default(CREATED)
  priorState     IncidentState?             // restored after UNACK
  locationAvailable Boolean @default(false)
  triggeredAt    DateTime
  dispatchedAt   DateTime?
  acknowledgedAt DateTime?
  resolvedAt     DateTime?
  closedAt       DateTime?
  regionProfileId String
  createdAt      DateTime @default(now())

  attempts  NotificationAttempt[]
  events    IncidentEvent[]
  evidence  EvidenceAsset[]
  @@index([userId, createdAt])
  @@index([state])
}
enum TriggerType   { manual shake voice safeword crash fall missed_check_in duress }
enum IncidentMode  { real practice }
enum IncidentState { CREATED LOCATING DISPATCHING NOTIFYING PARTIALLY_NOTIFIED NOTIFIED ALL_CHANNELS_FAILED ACKNOWLEDGED RESOLVING CLOSED CANCELLED }

model IncidentEvent {                       // append-only — the incident timeline
  id         String @id @default(uuid())
  incidentId String
  incident   EmergencyIncident @relation(fields: [incidentId], references: [id], onDelete: Cascade)
  fromState  IncidentState?
  toState    IncidentState
  event      String
  actor      Actor
  reason     String?
  occurredAt DateTime
  recordedAt DateTime @default(now())
  @@index([incidentId, occurredAt])
}

model NotificationAttempt {
  id            String @id @default(uuid())
  incidentId    String
  incident      EmergencyIncident @relation(fields: [incidentId], references: [id], onDelete: Cascade)
  recipientId   String
  channel       Channel
  attemptNumber Int     @default(1)
  escalationStep Int
  state         AttemptState @default(QUEUED)
  stateReason   String?
  queuedAt      DateTime @default(now())
  sentAt        DateTime?
  deliveredAt   DateTime?
  acknowledgedAt DateTime?
  failedAt      DateTime?
  providerMessageId String?
  providerStatus    String?
  costMinorUnits Int    @default(0)
  currency      String?

  events NotificationEvent[]
  @@unique([incidentId, recipientId, channel, attemptNumber])
  @@index([incidentId])
  @@index([state])
}
enum Channel      { push sms voice device_direct_sms email web }
enum AttemptState { QUEUED SENT DELIVERED ACKNOWLEDGED FAILED EXPIRED UNKNOWN }

model NotificationEvent {                   // append-only; state above is a materialised view
  id        String @id @default(uuid())
  attemptId String
  attempt   NotificationAttempt @relation(fields: [attemptId], references: [id], onDelete: Cascade)
  toState   AttemptState
  reason    String?
  occurredAt DateTime @default(now())
  @@index([attemptId, occurredAt])
}

model JourneyLink {
  id         String @id @default(uuid())
  sessionId  String
  session    SafetySession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  tokenHash  String @unique                 // store the HASH, never the token (T6)
  expiresAt  DateTime
  revokedAt  DateTime?
  pinHash    String?
  viewCount  Int @default(0)
  lastViewedAt DateTime?
  @@index([expiresAt])
}

model Device {
  id          String @id @default(uuid())
  userId      String
  user        User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  platform    String
  osVersion   String
  pushToken   String?
  capabilities Json                          // probed DeviceCapability — what is actually armed
  lastSeenAt  DateTime @default(now())
  revokedAt   DateTime?
  @@index([userId])
}

model AuditLog {                             // append-only
  id        String @id @default(uuid())
  actorId   String?
  action    String
  subjectType String
  subjectId String
  metadata  Json?                            // NEVER coordinates, numbers or message bodies (PLAT-8)
  at        DateTime @default(now())
  @@index([actorId, at])
  @@index([subjectType, subjectId])
}
```

---

## Phase 2+ (outline)

`EvidenceAsset` (incidentId, storageKey, contentType, bytes, sha256, capturedAt,
uploadState, verifiedAt, gaps Json) · `EvidenceAccessLog` (append-only) ·
`DuressCredential` (userId, pinHash — never distinguishable in any API response) ·
`FeatureFlag` · `FeatureFlagOverride` · `RolloutCohort` (PLAT-6) · device heartbeat fields
(`lastSeenAt`, battery) for the go-dark watchdog (RES-15) ·
`SafetySignal` + `ModelVersion` (Phase 3) · `SafetyPlace`,
`Organization`, `OrganizationMembership`, `Responder` (Phase 4) · `Subscription`,
`Entitlement` (Phase 5).

---

## Rules

**Geo.** `HazardReport` and `LocationSnapshot` carry `latitude`/`longitude` as `Float`
plus an accuracy. The `top`/`left` CSS percentages are **deleted** — they carried no real
location (ADR-0006).

**Every location is a snapshot.** `capturedAt` + `accuracyM` are **non-nullable** on
`LocationSnapshot`, so the UI cannot render a fix without its age and precision (RES-10).
`HazardReport.accuracyMetres` is deliberately **nullable**: a reporting device genuinely
may not know, and an unknown accuracy must travel as unknown rather than defaulting to a
confident number.

**Idempotency.** `EmergencyIncident.idempotencyKey` unique. `NotificationAttempt`
unique on `(incidentId, recipientId, channel, attemptNumber)`.

**Consent is a record, not a flag.** `ConsentRecord` has subject, scope, grantedAt,
revokedAt, region profile and version — because PRO-8 requires periodic
re-confirmation and the history must be provable.

**No demographic fields.** Not optional — **absent** from the schema. T7/C8.

**Tenancy.** Every org-scoped table carries `organizationId`, enforced in application
authorization **and** with a database-level policy. Zero tolerance (F14).

**Encryption at rest.** `bloodType`, `allergies`, `TrustedContact.phone` — field-level.

**Retention.** Driven by the region profile, not hard-coded: `expiresAt` on hazard
reports, location snapshots and evidence; a scheduled job enforces it; erasure
propagates to backups within the profile SLA.

**Append-only tables** — `SessionEvent`, `IncidentEvent`, `NotificationEvent`,
`EvidenceAccessLog`, `AuditLog` — have no update or delete path in the application
layer. They are the incident export (REC-1) and therefore evidence.

**Practice isolation.** `EmergencyIncident.mode = practice` is checked at the
notification boundary: a practice incident **cannot** acquire a real
`NotificationAttempt`. Enforced in code and unit-tested, not by convention.

**Indexes.** `HazardReport(geohash)`, `(reportedAt)`, `(expiresAt)` · `LocationSnapshot(sessionId, capturedAt)`
· `EmergencyIncident(userId, createdAt)`, `(idempotencyKey)` unique
· `NotificationAttempt(incidentId)`, `(state)` · `AuditLog(actorId, at)`.

DB-1 is closed: the schema now indexes `TrustedContact(userId)`,
`HazardReport(userId)`, `(expiresAt)`, `(reportedAt)`,
`HazardConfirmation(userId)` and a unique `(reportId, userId)`. Only
`HazardReport(geohash)` is outstanding, and it waits on the radius query.

**Confirmation counts are derived**, not stored: `HazardConfirmation` is one
uniquely-constrained row per person per report, so a count cannot be inflated by
one account and cannot drift from a denormalised column.

---

## As built — Phase 1 schema (milestone 1.2)

`apps/api/prisma/schema.prisma` and migration `20261112140000_phase1_sessions_incidents_ledger`
implement the Phase 1 block above. Where the code differs from the block, **the code is
right** and this section is the record:

- **`TrustedContact.removedAt`** — contacts are soft-deleted. `NotificationAttempt.recipientId`
  is a plain id (not a foreign key), so a hard delete would leave the evidence pointing at
  nothing. Removed contacts leave every read and every recipient list; the row stays.
  Purging a removed contact's personal data belongs to the retention job (2.11).
- **Editing a contact's phone or email revokes the consent** (`ConsentRecord.revokedAt` +
  `revokedReason`), and clears `consentId`. The person at the old number agreed, not whoever
  has the new one. Formatting-only changes (`+1 (555) 010-6000` → `+15550106000`) and
  name-only edits keep it. The record is never deleted — it is evidence.
- **`ConsentRecord.revokedReason`** — added; a revocation with no reason is a gap in the evidence.
- **`LocationSnapshot.expiresAt`** — required. The Rules section requires decay on location
  snapshots; the model block above omitted the column. It is `NOT NULL`: whoever writes a
  snapshot must supply the region profile's retention.
- **`LocationSnapshot`/`SafetySession`/`EmergencyIncident` relations** are declared (the block
  left some as bare ids), so deleting a session or incident removes its snapshots.
- **`EmergencyIncident.evidence`** is omitted until `EvidenceAsset` exists (Phase 2).
- **`EscalationPolicy`** is now a model (it was referenced by `SafetySession.escalationPolicyId`
  but never declared). `steps` is JSON validated by `validatePolicy()` in `@lumo/safety-domain`;
  a recipient that no longer exists is skipped and ledgered at run time, not rejected at write
  time. `SafetySession.escalationPolicyId` uses `ON DELETE NO ACTION`, not `RESTRICT`: deleting a
  user cascades to its sessions **and** its policies in one statement, and `RESTRICT` is checked
  before the sessions are gone.
- **Enum members are exactly the strings `@lumo/safety-domain` defines** — lowercase for
  `Channel`, `TriggerType`, `SessionKind`, `Actor`, `IncidentMode`, `ConsentKind`; upper-case for
  the three state enums — with no `@map` and no mappers. `src/prisma/domain-parity.ts` breaks the
  build if the two ever differ, and `test/schema.e2e-spec.ts` compares the labels in Postgres.

### What the database enforces (and the drift gate cannot see)

Hand-written in the migration. `prisma migrate diff` ignores all of it, so
`test/schema.e2e-spec.ts` proves it and CI's `integration` job runs that suite:

- **Append-only history.** `SessionEvent`, `IncidentEvent`, `NotificationEvent` and `AuditLog`
  refuse `UPDATE` always, refuse `TRUNCATE` always, and refuse `DELETE` unless the transaction ran
  `SET LOCAL lumo.erasure = 'on'`. The carve-out exists because retention and the right to erasure
  (PRO-5) require history to be deletable by a deliberate procedure, and a user deletion cascades
  through these tables. It is a **convention enforced by review, not a privilege boundary** —
  anything that can open a transaction can set it. The parents (attempts, incidents, sessions)
  update their `state` and are deliberately **not** append-only.
- **CHECK constraints.** `graceSeconds >= 60` (a test fails if this differs from
  `MIN_GRACE_SECONDS`), `maxRecipientsPerIncident >= 1`, `deviationGraceSeconds > 0`, a valid
  latitude/longitude/accuracy/battery on `LocationSnapshot`, `attemptNumber >= 1`,
  `costMinorUnits >= 0`.
- **One default policy per user** (partial unique index).

### Encryption at rest

`TrustedContact.phone`, `TrustedContact.email`, `User.bloodType`, `User.allergies` are AES-256-GCM
ciphertext (`enc:v1:<keyId>:<iv>:<tag>:<data>`), bound to model, column and **row id** so a value
copied into another row fails authentication. The key is `DATA_ENCRYPTION_KEY`, required at boot.
`fullName` and `email` (the account's) are **not** encrypted — they are not in the spec's list.
