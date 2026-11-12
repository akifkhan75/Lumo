-- CreateEnum
CREATE TYPE "Actor" AS ENUM ('user', 'system', 'policy', 'contact');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('push', 'sms', 'voice', 'device_direct_sms', 'email', 'web');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('manual', 'shake', 'voice', 'safeword', 'crash', 'fall', 'missed_check_in', 'duress');

-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('walk_home', 'date', 'ride', 'travel', 'outdoor', 'custom');

-- CreateEnum
CREATE TYPE "SessionState" AS ENUM ('CREATED', 'ACTIVE', 'CHECK_IN_DUE', 'GRACE', 'ESCALATING', 'ALERTED', 'ARRIVED', 'CLOSED', 'SUSPENDED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "IncidentState" AS ENUM ('CREATED', 'LOCATING', 'DISPATCHING', 'NOTIFYING', 'PARTIALLY_NOTIFIED', 'NOTIFIED', 'ALL_CHANNELS_FAILED', 'ACKNOWLEDGED', 'RESOLVING', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IncidentMode" AS ENUM ('real', 'practice');

-- CreateEnum
CREATE TYPE "AttemptState" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'ACKNOWLEDGED', 'FAILED', 'EXPIRED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ConsentKind" AS ENUM ('contact_role', 'location_sharing', 'recording', 'data_processing');

-- DropIndex
DROP INDEX "TrustedContact_userId_idx";

-- AlterTable
ALTER TABLE "TrustedContact" ADD COLUMN     "consentId" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "removedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "regionProfileId" TEXT;

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT,
    "grantedById" TEXT NOT NULL,
    "kind" "ConsentKind" NOT NULL,
    "scope" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "reconfirmDueAt" TIMESTAMP(3),
    "regionProfileId" TEXT NOT NULL,
    "version" TEXT NOT NULL,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationPolicy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "graceSeconds" INTEGER NOT NULL DEFAULT 300,
    "steps" JSONB NOT NULL,
    "maxRecipientsPerIncident" INTEGER NOT NULL DEFAULT 5,
    "stopOnAcknowledgement" BOOLEAN NOT NULL DEFAULT true,
    "resumeOnUnacknowledge" BOOLEAN NOT NULL DEFAULT true,
    "promptEmergencyNumberOnFailure" BOOLEAN NOT NULL DEFAULT true,
    "deviationGraceSeconds" INTEGER NOT NULL DEFAULT 180,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "SessionKind" NOT NULL,
    "state" "SessionState" NOT NULL DEFAULT 'CREATED',
    "priorState" "SessionState",
    "destinationLat" DOUBLE PRECISION,
    "destinationLng" DOUBLE PRECISION,
    "destinationLabel" TEXT,
    "expectedArrivalAt" TIMESTAMP(3),
    "checkInDueAt" TIMESTAMP(3),
    "escalationPolicyId" TEXT NOT NULL,
    "shareLocation" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fromState" "SessionState",
    "toState" "SessionState" NOT NULL,
    "event" TEXT NOT NULL,
    "actor" "Actor" NOT NULL,
    "reason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationSnapshot" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "incidentId" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "batteryPct" INTEGER,
    "source" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyIncident" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "triggerType" "TriggerType" NOT NULL,
    "mode" "IncidentMode" NOT NULL DEFAULT 'real',
    "isDuress" BOOLEAN NOT NULL DEFAULT false,
    "state" "IncidentState" NOT NULL DEFAULT 'CREATED',
    "priorState" "IncidentState",
    "locationAvailable" BOOLEAN NOT NULL DEFAULT false,
    "triggeredAt" TIMESTAMP(3) NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "regionProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentEvent" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "fromState" "IncidentState",
    "toState" "IncidentState" NOT NULL,
    "event" TEXT NOT NULL,
    "actor" "Actor" NOT NULL,
    "reason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAttempt" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "escalationStep" INTEGER NOT NULL,
    "state" "AttemptState" NOT NULL DEFAULT 'QUEUED',
    "stateReason" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "providerStatus" TEXT,
    "costMinorUnits" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT,

    CONSTRAINT "NotificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "toState" "AttemptState" NOT NULL,
    "reason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyLink" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "pinHash" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),

    CONSTRAINT "JourneyLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "osVersion" TEXT NOT NULL,
    "pushToken" TEXT,
    "capabilities" JSONB NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "metadata" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentRecord_grantedById_kind_idx" ON "ConsentRecord"("grantedById", "kind");

-- CreateIndex
CREATE INDEX "ConsentRecord_reconfirmDueAt_idx" ON "ConsentRecord"("reconfirmDueAt");

-- CreateIndex
CREATE INDEX "EscalationPolicy_userId_idx" ON "EscalationPolicy"("userId");

-- CreateIndex
CREATE INDEX "SafetySession_userId_state_idx" ON "SafetySession"("userId", "state");

-- CreateIndex
CREATE INDEX "SafetySession_checkInDueAt_idx" ON "SafetySession"("checkInDueAt");

-- CreateIndex
CREATE INDEX "SessionEvent_sessionId_occurredAt_idx" ON "SessionEvent"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "LocationSnapshot_sessionId_capturedAt_idx" ON "LocationSnapshot"("sessionId", "capturedAt");

-- CreateIndex
CREATE INDEX "LocationSnapshot_incidentId_capturedAt_idx" ON "LocationSnapshot"("incidentId", "capturedAt");

-- CreateIndex
CREATE INDEX "LocationSnapshot_expiresAt_idx" ON "LocationSnapshot"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyIncident_idempotencyKey_key" ON "EmergencyIncident"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EmergencyIncident_userId_createdAt_idx" ON "EmergencyIncident"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmergencyIncident_state_idx" ON "EmergencyIncident"("state");

-- CreateIndex
CREATE INDEX "IncidentEvent_incidentId_occurredAt_idx" ON "IncidentEvent"("incidentId", "occurredAt");

-- CreateIndex
CREATE INDEX "NotificationAttempt_incidentId_idx" ON "NotificationAttempt"("incidentId");

-- CreateIndex
CREATE INDEX "NotificationAttempt_state_idx" ON "NotificationAttempt"("state");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationAttempt_incidentId_recipientId_channel_attemptN_key" ON "NotificationAttempt"("incidentId", "recipientId", "channel", "attemptNumber");

-- CreateIndex
CREATE INDEX "NotificationEvent_attemptId_occurredAt_idx" ON "NotificationEvent"("attemptId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyLink_tokenHash_key" ON "JourneyLink"("tokenHash");

-- CreateIndex
CREATE INDEX "JourneyLink_expiresAt_idx" ON "JourneyLink"("expiresAt");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_at_idx" ON "AuditLog"("actorId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_subjectType_subjectId_idx" ON "AuditLog"("subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedContact_consentId_key" ON "TrustedContact"("consentId");

-- CreateIndex
CREATE INDEX "TrustedContact_userId_priority_idx" ON "TrustedContact"("userId", "priority");

-- CreateIndex
CREATE INDEX "User_regionProfileId_idx" ON "User"("regionProfileId");

-- AddForeignKey
ALTER TABLE "TrustedContact" ADD CONSTRAINT "TrustedContact_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "ConsentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationPolicy" ADD CONSTRAINT "EscalationPolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetySession" ADD CONSTRAINT "SafetySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetySession" ADD CONSTRAINT "SafetySession_escalationPolicyId_fkey" FOREIGN KEY ("escalationPolicyId") REFERENCES "EscalationPolicy"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SafetySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationSnapshot" ADD CONSTRAINT "LocationSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SafetySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationSnapshot" ADD CONSTRAINT "LocationSnapshot_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "EmergencyIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyIncident" ADD CONSTRAINT "EmergencyIncident_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyIncident" ADD CONSTRAINT "EmergencyIncident_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SafetySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvent" ADD CONSTRAINT "IncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "EmergencyIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAttempt" ADD CONSTRAINT "NotificationAttempt_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "EmergencyIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "NotificationAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyLink" ADD CONSTRAINT "JourneyLink_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SafetySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Everything below is hand-written. Prisma cannot express it, and `prisma migrate
-- diff` ignores triggers and CHECK constraints, so the CI drift gate does not see
-- it. apps/api/test/schema.e2e-spec.ts proves each of these against a real
-- database, and CI runs that suite.
-- ============================================================================

-- Existing contacts keep the order they were created in. Without this every
-- contact gets priority 0 and the alert order becomes whatever the planner returns.
UPDATE "TrustedContact" AS t
SET "priority" = r.rn - 1
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "userId" ORDER BY "createdAt", "id") AS rn
  FROM "TrustedContact"
) AS r
WHERE t."id" = r."id";

-- ----------------------------------------------------------------------------
-- Append-only history: SessionEvent, IncidentEvent, NotificationEvent, AuditLog.
--
-- These tables ARE the evidence (REC-1). The application has no update or delete
-- path for them; this is the backstop for a bug, a bad migration or a person.
--
-- UPDATE is always refused.
-- DELETE is refused unless the same transaction has run
--     SET LOCAL lumo.erasure = 'on'
-- That carve-out exists because the retention rules and the right to erasure
-- (PRO-5) require history to be deletable by a deliberate, reviewed procedure —
-- and a user deletion cascades through these tables. The flag is a convention
-- enforced by review, not a privilege boundary: anything that can open a
-- transaction can set it. Separating database roles is the real fix (KNOWN_ISSUES).
--
-- Not covered: the history tables' PARENT rows (sessions, incidents, attempts) are
-- ordinary mutable rows whose `state` columns change. They must not get this trigger.
-- ----------------------------------------------------------------------------
CREATE FUNCTION lumo_forbid_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% is append-only: UPDATE is not permitted', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  IF current_setting('lumo.erasure', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '% is append-only: DELETE is only permitted by the erasure procedure (SET LOCAL lumo.erasure = ''on'')', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END
$$;

-- Row triggers do not fire on TRUNCATE, so it needs its own statement-level trigger.
-- Erasure uses DELETE; nothing legitimate truncates history.
CREATE FUNCTION lumo_forbid_history_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: TRUNCATE is not permitted', TG_TABLE_NAME
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER "SessionEvent_append_only" BEFORE UPDATE OR DELETE ON "SessionEvent"
  FOR EACH ROW EXECUTE FUNCTION lumo_forbid_history_mutation();
CREATE TRIGGER "IncidentEvent_append_only" BEFORE UPDATE OR DELETE ON "IncidentEvent"
  FOR EACH ROW EXECUTE FUNCTION lumo_forbid_history_mutation();
CREATE TRIGGER "NotificationEvent_append_only" BEFORE UPDATE OR DELETE ON "NotificationEvent"
  FOR EACH ROW EXECUTE FUNCTION lumo_forbid_history_mutation();
CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION lumo_forbid_history_mutation();

CREATE TRIGGER "SessionEvent_no_truncate" BEFORE TRUNCATE ON "SessionEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION lumo_forbid_history_truncate();
CREATE TRIGGER "IncidentEvent_no_truncate" BEFORE TRUNCATE ON "IncidentEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION lumo_forbid_history_truncate();
CREATE TRIGGER "NotificationEvent_no_truncate" BEFORE TRUNCATE ON "NotificationEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION lumo_forbid_history_truncate();
CREATE TRIGGER "AuditLog_no_truncate" BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION lumo_forbid_history_truncate();

-- ----------------------------------------------------------------------------
-- CHECK constraints: the domain's invariants, held by the database as well.
-- ----------------------------------------------------------------------------

-- MIN_GRACE_SECONDS in @lumo/safety-domain. A test fails if these two numbers differ.
-- A zero or near-zero grace turns traffic into an emergency.
ALTER TABLE "EscalationPolicy" ADD CONSTRAINT "EscalationPolicy_graceSeconds_min"
  CHECK ("graceSeconds" >= 60);
ALTER TABLE "EscalationPolicy" ADD CONSTRAINT "EscalationPolicy_maxRecipients_min"
  CHECK ("maxRecipientsPerIncident" >= 1);
ALTER TABLE "EscalationPolicy" ADD CONSTRAINT "EscalationPolicy_deviationGrace_positive"
  CHECK ("deviationGraceSeconds" > 0);

-- At most one default policy per user.
CREATE UNIQUE INDEX "EscalationPolicy_one_default_per_user"
  ON "EscalationPolicy"("userId") WHERE "isDefault";

-- A retry is attemptNumber 2, never a rewrite of attempt 1.
ALTER TABLE "NotificationAttempt" ADD CONSTRAINT "NotificationAttempt_attemptNumber_min"
  CHECK ("attemptNumber" >= 1);
ALTER TABLE "NotificationAttempt" ADD CONSTRAINT "NotificationAttempt_cost_nonnegative"
  CHECK ("costMinorUnits" >= 0);

-- A fix has to be a place on Earth, with a non-negative error radius.
ALTER TABLE "LocationSnapshot" ADD CONSTRAINT "LocationSnapshot_latitude_range"
  CHECK ("latitude" BETWEEN -90 AND 90);
ALTER TABLE "LocationSnapshot" ADD CONSTRAINT "LocationSnapshot_longitude_range"
  CHECK ("longitude" BETWEEN -180 AND 180);
ALTER TABLE "LocationSnapshot" ADD CONSTRAINT "LocationSnapshot_accuracy_nonnegative"
  CHECK ("accuracyM" >= 0);
ALTER TABLE "LocationSnapshot" ADD CONSTRAINT "LocationSnapshot_battery_range"
  CHECK ("batteryPct" IS NULL OR "batteryPct" BETWEEN 0 AND 100);

ALTER TABLE "TrustedContact" ADD CONSTRAINT "TrustedContact_priority_nonnegative"
  CHECK ("priority" >= 0);
