-- CreateTable
CREATE TABLE "PracticeAttempt" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "state" "AttemptState" NOT NULL,
    "reason" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "PracticeAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PracticeAttempt_incidentId_idx" ON "PracticeAttempt"("incidentId");

-- AddForeignKey
ALTER TABLE "PracticeAttempt" ADD CONSTRAINT "PracticeAttempt_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "EmergencyIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- THE BOUNDARY (docs/specs/PRACTICE_MODE.md): a practice incident cannot acquire a real NotificationAttempt. This is enforced HERE, in the
-- database, so no code path (a planner, a worker, a future feature, a hand-run script) can queue a message for a rehearsal. The code
-- guards in DispatchService and the send worker are the first line; this is the one that cannot be bypassed.
CREATE FUNCTION "refuse_attempt_for_practice"() RETURNS trigger AS $$
BEGIN
  IF (SELECT "mode" FROM "EmergencyIncident" WHERE "id" = NEW."incidentId") = 'practice' THEN
    RAISE EXCEPTION 'practice incident % cannot have a NotificationAttempt', NEW."incidentId" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "NotificationAttempt_not_for_practice" BEFORE INSERT ON "NotificationAttempt"
  FOR EACH ROW EXECUTE FUNCTION "refuse_attempt_for_practice"();

-- An incident's mode never changes: a rehearsal cannot become real (it would start sending), nor a real one practice (it would hide).
CREATE FUNCTION "refuse_mode_change"() RETURNS trigger AS $$
BEGIN
  IF NEW."mode" IS DISTINCT FROM OLD."mode" THEN
    RAISE EXCEPTION 'the mode of incident % cannot change', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EmergencyIncident_mode_immutable" BEFORE UPDATE ON "EmergencyIncident"
  FOR EACH ROW EXECUTE FUNCTION "refuse_mode_change"();
