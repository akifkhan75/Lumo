-- CreateTable
CREATE TABLE "ContactInvite" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "consentId" TEXT,
    "endedAt" TIMESTAMP(3),
    "endedReason" TEXT,

    CONSTRAINT "ContactInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactInvite_tokenHash_key" ON "ContactInvite"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ContactInvite_consentId_key" ON "ContactInvite"("consentId");

-- CreateIndex
CREATE INDEX "ContactInvite_contactId_idx" ON "ContactInvite"("contactId");

-- AddForeignKey
ALTER TABLE "ContactInvite" ADD CONSTRAINT "ContactInvite_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "TrustedContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written below: Prisma cannot express these, `prisma migrate diff` ignores them,
-- so test/contact-consent.e2e-spec.ts proves them against a real database.

-- An invite is open while endedAt is null; an ended one always says why, and an open
-- one never has a reason. (A reason with no end, or an end with no reason, is a gap in
-- the record of who was asked and who withdrew.)
ALTER TABLE "ContactInvite" ADD CONSTRAINT "ContactInvite_ended_has_reason"
  CHECK (("endedAt" IS NULL) = ("endedReason" IS NULL));

-- Accepted means a consent was recorded, and the reverse.
ALTER TABLE "ContactInvite" ADD CONSTRAINT "ContactInvite_accepted_has_consent"
  CHECK (("acceptedAt" IS NULL) = ("consentId" IS NULL));

-- At most ONE open invite per contact. This is what makes "a new invite ends the old
-- one" safe under concurrency, and what stops two links being live for one person.
CREATE UNIQUE INDEX "ContactInvite_one_open_per_contact"
  ON "ContactInvite"("contactId") WHERE "endedAt" IS NULL;
