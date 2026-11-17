-- AlterTable
ALTER TABLE "NotificationAttempt" ADD COLUMN     "reservedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "NotificationAttempt_channel_reservedAt_idx" ON "NotificationAttempt"("channel", "reservedAt");

