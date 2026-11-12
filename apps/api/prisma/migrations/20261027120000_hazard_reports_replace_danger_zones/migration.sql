-- Replaces DangerZone with HazardReport (ADR-0010).
--
-- THIS MIGRATION DROPS "DangerZone" AND ALL ROWS IN IT. That is intentional
-- and there is no backfill, because the data cannot be migrated: the old
-- table stored CSS percentages ("45%") that the server generated with
-- Math.random() on create, so no row records where anything actually was.
-- There is no function from a fabricated percentage to a coordinate.
--
-- "severity" is dropped and not replaced. A danger grade attached to a place
-- is the redlining primitive this model exists to remove; reports now carry a
-- type, a source, an age and a confirmation count instead.

-- CreateEnum
CREATE TYPE "HazardType" AS ENUM ('POOR_LIGHTING', 'OBSTRUCTED_PATH', 'BROKEN_INFRASTRUCTURE', 'UNSAFE_CROSSING', 'THEFT_REPORTED', 'HARASSMENT_REPORTED', 'AGGRESSION_REPORTED', 'OTHER');

-- CreateEnum
CREATE TYPE "HazardReportSource" AS ENUM ('COMMUNITY', 'VERIFIED_PARTNER', 'OFFICIAL_FEED');

-- DropForeignKey
ALTER TABLE "DangerZone" DROP CONSTRAINT "DangerZone_userId_fkey";

-- DropTable
DROP TABLE "DangerZone";

-- DropEnum
DROP TYPE "DangerZoneSeverity";

-- DropEnum
DROP TYPE "DangerZoneType";

-- CreateTable
CREATE TABLE "HazardReport" (
    "id" TEXT NOT NULL,
    "type" "HazardType" NOT NULL,
    "source" "HazardReportSource" NOT NULL DEFAULT 'COMMUNITY',
    "description" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyMetres" DOUBLE PRECISION,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HazardReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HazardConfirmation" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HazardConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HazardReport_userId_idx" ON "HazardReport"("userId");

-- CreateIndex
CREATE INDEX "HazardReport_expiresAt_idx" ON "HazardReport"("expiresAt");

-- CreateIndex
CREATE INDEX "HazardReport_reportedAt_idx" ON "HazardReport"("reportedAt");

-- CreateIndex
CREATE INDEX "HazardConfirmation_userId_idx" ON "HazardConfirmation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HazardConfirmation_reportId_userId_key" ON "HazardConfirmation"("reportId", "userId");

-- AddForeignKey
ALTER TABLE "HazardReport" ADD CONSTRAINT "HazardReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardConfirmation" ADD CONSTRAINT "HazardConfirmation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "HazardReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardConfirmation" ADD CONSTRAINT "HazardConfirmation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

