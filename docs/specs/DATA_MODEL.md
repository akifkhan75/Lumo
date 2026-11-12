# Data Model

> Field-level target schema. Current schema and its defects:
> [`../engineering/DATABASE.md`](../engineering/DATABASE.md).
> Prisma 5 / PostgreSQL 15. **Migrations required from Phase 0** — none exist today.

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
  id          String   @id @default(uuid())
  type        HazardType
  latitude    Float
  longitude   Float
  accuracyM   Float
  geohash     String                      // prefix match for cheap radius queries
  description String?                     // structured types preferred; no naming of people/businesses
  source      HazardSource @default(community)
  confirmationCount Int @default(0)
  reportedAt  DateTime @default(now())
  expiresAt   DateTime                    // mandatory decay — T7
  userId      String?
  user        User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([geohash])
  @@index([expiresAt])
  @@index([reportedAt])
}

enum HazardType   { poor_lighting obstruction harassment_reported theft_reported unsafe_crossing other }
enum HazardSource { community verified_partner official_advisory }
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
  email      String?
  consentId  String?  @unique
  consent    ConsentRecord? @relation(fields: [consentId], references: [id])
  priority   Int      @default(0)
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
`SafetySignal` + `ModelVersion` (Phase 3) · `SafetyPlace`, `HazardConfirmation`,
`Organization`, `OrganizationMembership`, `Responder` (Phase 4) · `Subscription`,
`Entitlement` (Phase 5).

---

## Rules

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
