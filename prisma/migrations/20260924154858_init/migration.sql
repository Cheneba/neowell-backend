-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CAREGIVER', 'CLINICIAN', 'ADMIN');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('en', 'fr');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('FEMALE', 'MALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('GREEN', 'YELLOW', 'RED');

-- CreateEnum
CREATE TYPE "SkinColor" AS ENUM ('NORMAL', 'PALE', 'YELLOW', 'BLUE', 'MOTTLED');

-- CreateEnum
CREATE TYPE "FeedingQuality" AS ENUM ('GOOD', 'REDUCED', 'UNABLE');

-- CreateEnum
CREATE TYPE "StoolPattern" AS ENUM ('NORMAL', 'REDUCED', 'NONE', 'DIARRHEA', 'BLOODY');

-- CreateEnum
CREATE TYPE "CryDescription" AS ENUM ('NORMAL', 'WEAK', 'HIGH_PITCHED', 'INCONSOLABLE');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('NORMAL', 'REDUCED', 'LETHARGIC');

-- CreateEnum
CREATE TYPE "BreathingStatus" AS ENUM ('NORMAL', 'FAST', 'DIFFICULT');

-- CreateEnum
CREATE TYPE "JaundiceLevel" AS ENUM ('NONE', 'FACE_CHEST', 'PALMS_SOLES');

-- CreateEnum
CREATE TYPE "CordStatus" AS ENUM ('NORMAL', 'RED_OR_DISCHARGE', 'SPREADING_REDNESS_OR_PUS');

-- CreateEnum
CREATE TYPE "TemperatureSource" AS ENUM ('MANUAL', 'BLE_THERMOMETER', 'VOICE');

-- CreateEnum
CREATE TYPE "FacilityService" AS ENUM ('NEONATOLOGY', 'PAEDIATRICS', 'OPD', 'MATERNITY', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING_DOCUMENTS', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ClinicianDocumentType" AS ENUM ('MEDICAL_LICENSE', 'MEDICAL_DEGREE', 'EMPLOYMENT_PROOF');

-- CreateEnum
CREATE TYPE "ConsultationType" AS ENUM ('AUDIO', 'VIDEO', 'CHAT');

-- CreateEnum
CREATE TYPE "ConsultationStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MTN_MOMO', 'ORANGE_MONEY');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "fullName" TEXT,
    "role" "Role" NOT NULL DEFAULT 'CAREGIVER',
    "locale" "Locale" NOT NULL DEFAULT 'en',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "consentDataCollectionAt" TIMESTAMP(3),
    "consentClinicianShareAt" TIMESTAMP(3),
    "consentRecordingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Baby" (
    "id" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sex" "Sex" NOT NULL DEFAULT 'UNKNOWN',
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "birthWeightGrams" INTEGER,
    "gestationalAgeWeeks" INTEGER,
    "birthHospital" TEXT,
    "dischargeDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Baby_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "babyId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "temperatureC" DECIMAL(4,1),
    "temperatureSrc" "TemperatureSource" NOT NULL DEFAULT 'MANUAL',
    "feedingCount24h" INTEGER,
    "feedingQuality" "FeedingQuality",
    "stoolPattern" "StoolPattern",
    "skinColor" "SkinColor",
    "cry" "CryDescription",
    "activity" "ActivityLevel",
    "breathing" "BreathingStatus",
    "jaundice" "JaundiceLevel",
    "cordStatus" "CordStatus",
    "convulsions" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "photoKey" TEXT,
    "riskLevel" "RiskLevel" NOT NULL,
    "riskReasons" JSONB NOT NULL,
    "riskEngineVer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "city" TEXT,
    "address" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "services" "FacilityService"[],
    "mainPhone" TEXT,
    "hours" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityDepartment" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "service" "FacilityService" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,

    CONSTRAINT "FacilityDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicianProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "specialties" TEXT[],
    "bio" TEXT,
    "currentFacility" TEXT,
    "consultationFeeXaf" INTEGER NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING_DOCUMENTS',
    "verificationNote" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "ratingAvg" DECIMAL(3,2),
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicianProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicianDocument" (
    "id" TEXT NOT NULL,
    "clinicianId" TEXT NOT NULL,
    "type" "ClinicianDocumentType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicianDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicianAvailability" (
    "id" TEXT NOT NULL,
    "clinicianId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "ClinicianAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consultation" (
    "id" TEXT NOT NULL,
    "babyId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "clinicianId" TEXT NOT NULL,
    "type" "ConsultationType" NOT NULL,
    "status" "ConsultationStatus" NOT NULL DEFAULT 'REQUESTED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "feeXaf" INTEGER NOT NULL,
    "commissionXaf" INTEGER NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "previsitSummary" JSONB,
    "recordingConsent" BOOLEAN NOT NULL DEFAULT false,
    "recordingKey" TEXT,
    "clinicianNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consultation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "payerPhone" TEXT NOT NULL,
    "amountXaf" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "externalRef" TEXT,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugChart" (
    "id" TEXT NOT NULL,
    "babyId" TEXT NOT NULL,
    "consultationId" TEXT,
    "prescribedById" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrugChart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugChartItem" (
    "id" TEXT NOT NULL,
    "drugChartId" TEXT NOT NULL,
    "drugName" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "timesOfDay" TEXT[],
    "durationDays" INTEGER NOT NULL,
    "instructions" TEXT,

    CONSTRAINT "DrugChartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "statusCode" INTEGER,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "OtpCode_phone_createdAt_idx" ON "OtpCode"("phone", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "Baby_caregiverId_idx" ON "Baby"("caregiverId");

-- CreateIndex
CREATE INDEX "Observation_babyId_observedAt_idx" ON "Observation"("babyId", "observedAt");

-- CreateIndex
CREATE INDEX "Facility_latitude_longitude_idx" ON "Facility"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityDepartment_facilityId_service_key" ON "FacilityDepartment"("facilityId", "service");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicianProfile_userId_key" ON "ClinicianProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicianProfile_licenseNumber_key" ON "ClinicianProfile"("licenseNumber");

-- CreateIndex
CREATE INDEX "ClinicianDocument_clinicianId_type_idx" ON "ClinicianDocument"("clinicianId", "type");

-- CreateIndex
CREATE INDEX "ClinicianAvailability_clinicianId_idx" ON "ClinicianAvailability"("clinicianId");

-- CreateIndex
CREATE INDEX "Consultation_clinicianId_scheduledAt_idx" ON "Consultation"("clinicianId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Consultation_caregiverId_idx" ON "Consultation"("caregiverId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_externalRef_key" ON "Payment"("externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "DrugChart_consultationId_key" ON "DrugChart"("consultationId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Baby" ADD CONSTRAINT "Baby_caregiverId_fkey" FOREIGN KEY ("caregiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityDepartment" ADD CONSTRAINT "FacilityDepartment_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicianProfile" ADD CONSTRAINT "ClinicianProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicianDocument" ADD CONSTRAINT "ClinicianDocument_clinicianId_fkey" FOREIGN KEY ("clinicianId") REFERENCES "ClinicianProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicianAvailability" ADD CONSTRAINT "ClinicianAvailability_clinicianId_fkey" FOREIGN KEY ("clinicianId") REFERENCES "ClinicianProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_caregiverId_fkey" FOREIGN KEY ("caregiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_clinicianId_fkey" FOREIGN KEY ("clinicianId") REFERENCES "ClinicianProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugChart" ADD CONSTRAINT "DrugChart_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugChart" ADD CONSTRAINT "DrugChart_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugChartItem" ADD CONSTRAINT "DrugChartItem_drugChartId_fkey" FOREIGN KEY ("drugChartId") REFERENCES "DrugChart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
