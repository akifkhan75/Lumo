-- AlterTable
ALTER TABLE "JourneyLink" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "failedPinAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "JourneyLink_sessionId_idx" ON "JourneyLink"("sessionId");

