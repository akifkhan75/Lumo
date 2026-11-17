-- AlterTable
ALTER TABLE "SessionEvent" ADD COLUMN     "seq" SERIAL NOT NULL;


-- Hand-written (Prisma cannot express partial indexes; test/sessions.e2e-spec.ts proves it).

-- At most ONE journey in progress per person. A retried request must not leave two live sessions, each with its own
-- timers, each able to alert the same contacts.
CREATE UNIQUE INDEX "SafetySession_one_live_per_user" ON "SafetySession"("userId")
  WHERE "state" NOT IN ('CLOSED', 'CANCELLED', 'EXPIRED');
