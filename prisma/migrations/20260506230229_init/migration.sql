-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('WAITING', 'CONSULTING', 'COMPLETED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReportSeverity" AS ENUM ('NORMAL', 'LOW', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('WHATSAPP', 'SMS', 'APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'FLAGGED');

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dob" TIMESTAMP(3) NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "abhaId" TEXT,
    "bloodGroup" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Doctor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialization" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "consultationsToday" INTEGER NOT NULL DEFAULT 0,
    "isOnBreak" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "status" "VisitStatus" NOT NULL DEFAULT 'WAITING',
    "reason" TEXT,
    "queuePosition" INTEGER NOT NULL,
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consultedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "waitTime" INTEGER,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalNote" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "rawTranscript" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "duration" TEXT,
    "advice" JSONB NOT NULL,
    "followUp" TEXT,
    "icdCode" TEXT,
    "icdDescription" TEXT,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabReport" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "visitId" TEXT,
    "testName" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "plainEnglish" TEXT,
    "severity" "ReportSeverity" NOT NULL DEFAULT 'NORMAL',
    "recommendation" TEXT,
    "isViewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL DEFAULT 'APP',
    "content" TEXT NOT NULL,
    "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingClaim" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionRisk" INTEGER DEFAULT 0,
    "missingDocs" JSONB,
    "tpaName" TEXT,
    "submittedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockchainRecord" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordHash" TEXT NOT NULL,
    "ipfsCid" TEXT,
    "sharedWith" JSONB,
    "accessLog" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockchainRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HospitalMetric" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalPatients" INTEGER NOT NULL DEFAULT 0,
    "avgWaitTime" INTEGER NOT NULL DEFAULT 0,
    "noShowCount" INTEGER NOT NULL DEFAULT 0,
    "consultationCount" INTEGER NOT NULL DEFAULT 0,
    "revenueProtected" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "experienceScore" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "HospitalMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Patient_phone_key" ON "Patient"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_abhaId_key" ON "Patient"("abhaId");

-- CreateIndex
CREATE INDEX "Visit_status_idx" ON "Visit"("status");

-- CreateIndex
CREATE INDEX "Visit_doctorId_status_idx" ON "Visit"("doctorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalNote_visitId_key" ON "ClinicalNote"("visitId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingClaim_visitId_key" ON "BillingClaim"("visitId");

-- CreateIndex
CREATE INDEX "HospitalMetric_date_idx" ON "HospitalMetric"("date");

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabReport" ADD CONSTRAINT "LabReport_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabReport" ADD CONSTRAINT "LabReport_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingClaim" ADD CONSTRAINT "BillingClaim_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockchainRecord" ADD CONSTRAINT "BlockchainRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
