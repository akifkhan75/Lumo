-- AlterTable
ALTER TABLE "NotificationAttempt" ADD COLUMN     "claimedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "NotificationAttempt_providerMessageId_idx" ON "NotificationAttempt"("providerMessageId");

