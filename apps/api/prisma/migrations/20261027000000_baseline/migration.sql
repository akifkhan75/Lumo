-- CreateEnum
CREATE TYPE "DangerZoneSeverity" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "DangerZoneType" AS ENUM ('Theft', 'Assault', 'Harassment', 'Poor Lighting', 'Suspicious Activity');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "bloodType" TEXT,
    "allergies" TEXT,
    "locationSharingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "shareLocationOnSos" BOOLEAN NOT NULL DEFAULT true,
    "sendSmsOnSos" BOOLEAN NOT NULL DEFAULT false,
    "shakeToSosEnabled" BOOLEAN NOT NULL DEFAULT true,
    "voiceActivationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "accidentDetectionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedContact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustedContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DangerZone" (
    "id" TEXT NOT NULL,
    "top" TEXT NOT NULL,
    "left" TEXT NOT NULL,
    "severity" "DangerZoneSeverity" NOT NULL,
    "type" "DangerZoneType" NOT NULL,
    "description" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DangerZone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "TrustedContact_userId_idx" ON "TrustedContact"("userId");

-- CreateIndex
CREATE INDEX "DangerZone_userId_idx" ON "DangerZone"("userId");

-- CreateIndex
CREATE INDEX "DangerZone_reportedAt_idx" ON "DangerZone"("reportedAt");

-- AddForeignKey
ALTER TABLE "TrustedContact" ADD CONSTRAINT "TrustedContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DangerZone" ADD CONSTRAINT "DangerZone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

