-- AlterTable
ALTER TABLE "TrustedContact" ADD COLUMN     "linkedAt" TIMESTAMP(3),
ADD COLUMN     "linkedUserId" TEXT;

-- AddForeignKey
ALTER TABLE "TrustedContact" ADD CONSTRAINT "TrustedContact_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written (Prisma cannot express partial indexes; `migrate diff` ignores them, so
-- test/push.e2e-spec.ts proves it against a real database).

-- One ACTIVE row per push token. Re-registering a token under another account must first
-- revoke the old row (the service does), and the database refuses two live owners regardless.
CREATE UNIQUE INDEX "Device_active_pushToken_key" ON "Device"("pushToken")
  WHERE "pushToken" IS NOT NULL AND "revokedAt" IS NULL;
