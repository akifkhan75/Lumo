-- DropIndex
DROP INDEX "NotificationAttempt_incidentId_recipientId_channel_attemptN_key";

-- AlterTable
ALTER TABLE "EmergencyIncident" ADD COLUMN     "countdownEndsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "IncidentEvent" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "NotificationAttempt" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'ALERT';

-- CreateTable
CREATE TABLE "EmergencyCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "EmergencyCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyCredential_tokenHash_key" ON "EmergencyCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "EmergencyCredential_userId_deviceKey_idx" ON "EmergencyCredential"("userId", "deviceKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationAttempt_incidentId_recipientId_channel_purpose__key" ON "NotificationAttempt"("incidentId", "recipientId", "channel", "purpose", "attemptNumber");

-- AddForeignKey
ALTER TABLE "EmergencyCredential" ADD CONSTRAINT "EmergencyCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written (Prisma cannot express CHECKs; test/incidents.e2e-spec.ts proves them).

-- A purpose is one of the two the code knows. (ALERT: it happened. RESOLVED: it ended.)
ALTER TABLE "NotificationAttempt" ADD CONSTRAINT "NotificationAttempt_purpose_known"
  CHECK ("purpose" IN ('ALERT', 'RESOLVED'));
