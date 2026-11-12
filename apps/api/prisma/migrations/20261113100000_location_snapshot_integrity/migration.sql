-- Integrity for location snapshots (docs/specs/LOCATION.md). Hand-written: Prisma
-- cannot express partial unique indexes or CHECK constraints, and `prisma migrate
-- diff` ignores both, so test/location.e2e-spec.ts proves them against a real
-- database and CI runs that suite.

-- A snapshot has no userId of its own: it belongs to someone ONLY through a session
-- or an incident. A row with neither is unreachable and unattributable — it could not
-- be shown to anyone, expired by owner, or erased with its owner.
ALTER TABLE "LocationSnapshot" ADD CONSTRAINT "LocationSnapshot_has_owner"
  CHECK ("sessionId" IS NOT NULL OR "incidentId" IS NOT NULL);

-- A batch resent after a dropped connection must not duplicate. Enforced by the
-- database, not by checking first: a check-then-insert races, and two retries in
-- flight at once would both pass it. One index per owner kind, because NULLs never
-- collide in a unique index — a single (sessionId, incidentId, capturedAt) index would
-- let two session-owned rows through.
CREATE UNIQUE INDEX "LocationSnapshot_session_capturedAt_key"
  ON "LocationSnapshot"("sessionId", "capturedAt") WHERE "sessionId" IS NOT NULL;
CREATE UNIQUE INDEX "LocationSnapshot_incident_capturedAt_key"
  ON "LocationSnapshot"("incidentId", "capturedAt") WHERE "incidentId" IS NOT NULL;
