-- NeoWell v2 (2/2): schema changes with data carried over from v1.

-- CreateEnum
CREATE TYPE "CareStatus" AS ENUM ('AT_HOME', 'IN_HOSPITAL', 'KANGAROO_CARE');

-- CreateEnum
CREATE TYPE "MeasurementSource" AS ENUM ('BIRTH', 'HOSPITAL', 'CLINIC', 'HOME');

-- CreateEnum
CREATE TYPE "CheckType" AS ENUM ('ROUTINE', 'UNWELL');

-- CreateEnum
CREATE TYPE "Complaint" AS ENUM ('FEVER', 'FEELS_COLD', 'CRYING_A_LOT', 'NOT_CRYING_OR_WEAK', 'NOT_FEEDING', 'BREATHING_PROBLEM', 'TWITCHING_OR_FITS', 'VOMITING', 'DIARRHEA', 'YELLOW_SKIN_OR_EYES', 'SKIN_COLOUR_CHANGE', 'CORD_PROBLEM', 'OTHER');

-- CreateEnum
CREATE TYPE "BreathingSound" AS ENUM ('QUIET', 'WHEEZING', 'GRUNTING', 'NOISY');

-- CreateEnum
CREATE TYPE "VomitingStatus" AS ENUM ('NONE', 'SOMETIMES', 'REPEATED', 'FORCEFUL_OR_GREEN');

-- CreateEnum
CREATE TYPE "RoomFeel" AS ENUM ('COLD', 'COMFORTABLE', 'HOT');

-- CreateEnum
CREATE TYPE "ClothingLevel" AS ENUM ('LIGHT', 'NORMAL', 'HEAVY');

-- CreateEnum
CREATE TYPE "RecheckStatus" AS ENUM ('PENDING', 'DONE', 'MISSED');

-- CreateEnum
CREATE TYPE "VoiceNoteStatus" AS ENUM ('PENDING', 'TRANSCRIBED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ConsultationMedium" AS ENUM ('CHAT', 'AUDIO', 'VIDEO');

-- CreateEnum
CREATE TYPE "ConsultationTiming" AS ENUM ('SCHEDULED', 'ASAP');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'IMAGE', 'REPORT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ReferralUrgency" AS ENUM ('EMERGENCY', 'SAME_DAY', 'ROUTINE');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('COLLECTION', 'REFUND');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PAID');

-- CreateEnum
CREATE TYPE "DoseStatus" AS ENUM ('GIVEN', 'SKIPPED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- AlterEnum
BEGIN;
CREATE TYPE "Sex_new" AS ENUM ('FEMALE', 'MALE');
ALTER TABLE "Baby" ALTER COLUMN "sex" DROP DEFAULT;
ALTER TABLE "Baby" ALTER COLUMN "sex" DROP NOT NULL;
ALTER TABLE "Baby" ALTER COLUMN "sex" TYPE "Sex_new" USING (CASE WHEN "sex"::text = 'UNKNOWN' THEN NULL ELSE "sex"::text::"Sex_new" END);
ALTER TYPE "Sex" RENAME TO "Sex_old";
ALTER TYPE "Sex_new" RENAME TO "Sex";
DROP TYPE "Sex_old";
COMMIT;


-- AlterTable
ALTER TABLE "User" ADD COLUMN     "city" TEXT,
ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "region" TEXT;
-- Data: split v1 fullName into first/last name
UPDATE "User" SET
  "firstName" = NULLIF(split_part(trim("fullName"), ' ', 1), ''),
  "lastName"  = NULLIF(trim(substr(trim("fullName"), length(split_part(trim("fullName"), ' ', 1)) + 1)), '')
WHERE "fullName" IS NOT NULL;
ALTER TABLE "User" DROP COLUMN "fullName";

-- AlterTable
ALTER TABLE "Baby" ADD COLUMN     "birthFacilityId" TEXT,
ADD COLUMN     "birthFacilityName" TEXT,
ADD COLUMN     "birthHeadCircumferenceCm" DECIMAL(4,1),
ADD COLUMN     "birthLengthCm" DECIMAL(4,1),
ADD COLUMN     "careStatus" "CareStatus" NOT NULL DEFAULT 'AT_HOME',
ADD COLUMN     "givenName" TEXT,
ADD COLUMN     "namePromptSentAt" TIMESTAMP(3);
-- Data: v1 name → givenName, birthHospital → birthFacilityName
UPDATE "Baby" SET "givenName" = "name", "birthFacilityName" = "birthHospital";
ALTER TABLE "Baby" DROP COLUMN "birthHospital", DROP COLUMN "name";

-- AlterTable
ALTER TABLE "Observation" ADD COLUMN     "breathingSound" "BreathingSound",
ADD COLUMN     "checkType" "CheckType" NOT NULL DEFAULT 'ROUTINE',
ADD COLUMN     "chestIndrawing" BOOLEAN,
ADD COLUMN     "clientRef" TEXT,
ADD COLUMN     "clothing" "ClothingLevel",
ADD COLUMN     "complaintText" TEXT,
ADD COLUMN     "complaints" "Complaint"[],
ADD COLUMN     "recheckOfId" TEXT,
ADD COLUMN     "respiratoryRate" INTEGER,
ADD COLUMN     "roomFeel" "RoomFeel",
ADD COLUMN     "voiceNoteId" TEXT,
ADD COLUMN     "vomiting" "VomitingStatus",
ALTER COLUMN "convulsions" DROP NOT NULL,
ALTER COLUMN "convulsions" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ClinicianProfile" ADD COLUMN     "availableNowUntil" TIMESTAMP(3),
ADD COLUMN     "feeAudioXaf" INTEGER,
ADD COLUMN     "feeChatXaf" INTEGER,
ADD COLUMN     "feeVideoXaf" INTEGER,
ADD COLUMN     "offersAudio" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "offersChat" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "offersVideo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "payoutPhone" TEXT,
ADD COLUMN     "payoutProvider" "PaymentProvider",
ADD COLUMN     "photoKey" TEXT,
ADD COLUMN     "title" TEXT NOT NULL DEFAULT 'Dr',
ADD COLUMN     "yearsExperience" INTEGER;
-- Data: the v1 single fee becomes the fee for every medium
UPDATE "ClinicianProfile" SET "feeChatXaf" = "consultationFeeXaf", "feeAudioXaf" = "consultationFeeXaf", "feeVideoXaf" = "consultationFeeXaf";
ALTER TABLE "ClinicianProfile" ALTER COLUMN "feeChatXaf" SET NOT NULL, ALTER COLUMN "feeAudioXaf" SET NOT NULL, ALTER COLUMN "feeVideoXaf" SET NOT NULL;
ALTER TABLE "ClinicianProfile" DROP COLUMN "consultationFeeXaf";

-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN     "acceptDeadline" TIMESTAMP(3),
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "clinicianEarningXaf" INTEGER,
ADD COLUMN     "diagnosisSummary" TEXT,
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "medium" "ConsultationMedium",
ADD COLUMN     "observationId" TEXT,
ADD COLUMN     "payoutId" TEXT,
ADD COLUMN     "preConsultChecklist" JSONB,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3),
ADD COLUMN     "roomName" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "timing" "ConsultationTiming" NOT NULL DEFAULT 'SCHEDULED',
ALTER COLUMN "status" SET DEFAULT 'AWAITING_PAYMENT';
-- Data: v1 type → medium; earnings = fee − commission
UPDATE "Consultation" SET "medium" = "type"::text::"ConsultationMedium", "clinicianEarningXaf" = "feeXaf" - "commissionXaf";
ALTER TABLE "Consultation" ALTER COLUMN "medium" SET NOT NULL, ALTER COLUMN "clinicianEarningXaf" SET NOT NULL;
ALTER TABLE "Consultation" DROP COLUMN "recordingKey", DROP COLUMN "type";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "kind" "PaymentKind" NOT NULL DEFAULT 'COLLECTION';

-- DropEnum
DROP TYPE "ConsultationType";

-- CreateTable
CREATE TABLE "Measurement" (
    "id" TEXT NOT NULL,
    "babyId" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "weightGrams" INTEGER,
    "lengthCm" DECIMAL(4,1),
    "headCircumferenceCm" DECIMAL(4,1),
    "source" "MeasurementSource" NOT NULL,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recheck" (
    "id" TEXT NOT NULL,
    "babyId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "RecheckStatus" NOT NULL DEFAULT 'PENDING',
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceNote" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "babyId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "VoiceNoteStatus" NOT NULL DEFAULT 'PENDING',
    "transcript" TEXT,
    "language" TEXT,
    "detectedComplaints" "Complaint"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "senderId" TEXT,
    "kind" "MessageKind" NOT NULL,
    "body" TEXT,
    "attachmentKey" TEXT,
    "contactMasked" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "babyId" TEXT NOT NULL,
    "facilityId" TEXT,
    "facilityName" TEXT NOT NULL,
    "urgency" "ReferralUrgency" NOT NULL,
    "reason" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "clinicianId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "clinicianId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amountXaf" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoseLog" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "DoseStatus" NOT NULL,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoseLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expoPushToken" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "pushedAt" TIMESTAMP(3),
    "smsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Measurement_babyId_measuredAt_idx" ON "Measurement"("babyId", "measuredAt");

-- CreateIndex
CREATE INDEX "Recheck_status_dueAt_idx" ON "Recheck"("status", "dueAt");

-- CreateIndex
CREATE INDEX "Message_consultationId_createdAt_idx" ON "Message"("consultationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_consultationId_key" ON "Referral"("consultationId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_code_key" ON "Referral"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Review_consultationId_key" ON "Review"("consultationId");

-- CreateIndex
CREATE UNIQUE INDEX "DoseLog_itemId_scheduledFor_key" ON "DoseLog"("itemId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "Device_expoPushToken_key" ON "Device"("expoPushToken");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_source_externalId_key" ON "WebhookEvent"("source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Observation_voiceNoteId_key" ON "Observation"("voiceNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Observation_babyId_clientRef_key" ON "Observation"("babyId", "clientRef");

-- CreateIndex
CREATE UNIQUE INDEX "Consultation_roomName_key" ON "Consultation"("roomName");

-- CreateIndex
CREATE INDEX "Consultation_status_idx" ON "Consultation"("status");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Baby" ADD CONSTRAINT "Baby_birthFacilityId_fkey" FOREIGN KEY ("birthFacilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_voiceNoteId_fkey" FOREIGN KEY ("voiceNoteId") REFERENCES "VoiceNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_recheckOfId_fkey" FOREIGN KEY ("recheckOfId") REFERENCES "Recheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recheck" ADD CONSTRAINT "Recheck_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recheck" ADD CONSTRAINT "Recheck_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceNote" ADD CONSTRAINT "VoiceNote_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceNote" ADD CONSTRAINT "VoiceNote_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_caregiverId_fkey" FOREIGN KEY ("caregiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_clinicianId_fkey" FOREIGN KEY ("clinicianId") REFERENCES "ClinicianProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_clinicianId_fkey" FOREIGN KEY ("clinicianId") REFERENCES "ClinicianProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoseLog" ADD CONSTRAINT "DoseLog_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DrugChartItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

