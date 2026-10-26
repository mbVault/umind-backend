-- CreateEnum
CREATE TYPE "PsychologistApplicantStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "PsychologistApplicant" (
    "id" UUID NOT NULL,
    "superTokensUserId" VARCHAR(128) NOT NULL,
    "email" VARCHAR(320),
    "phone" VARCHAR(32),
    "legalFullName" VARCHAR(120),
    "visibilityMode" "ProfileVisibilityMode" NOT NULL DEFAULT 'DISPLAY_NAME_AND_AVATAR',
    "displayName" VARCHAR(80),
    "avatarColor" VARCHAR(16),
    "avatarInitials" VARCHAR(4),
    "rciRegistrationNumber" VARCHAR(64),
    "highestDegree" VARCHAR(120),
    "yearsPractising" INTEGER,
    "idDocumentType" "IdDocumentType",
    "aadhaarLast4" CHAR(4),
    "specialisations" "SpecialisationCode"[] DEFAULT ARRAY[]::"SpecialisationCode"[],
    "languages" "LanguageCode"[] DEFAULT ARRAY[]::"LanguageCode"[],
    "onboardingStep" "PsychologistOnboardingStep" NOT NULL DEFAULT 'APPLY',
    "status" "PsychologistApplicantStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMPTZ(6),
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewedByAccountId" UUID,
    "rejectionReason" VARCHAR(500),
    "approvedAccountId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PsychologistApplicant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PsychologistApplicant_superTokensUserId_key" ON "PsychologistApplicant"("superTokensUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PsychologistApplicant_approvedAccountId_key" ON "PsychologistApplicant"("approvedAccountId");

-- CreateIndex
CREATE INDEX "PsychologistApplicant_status_submittedAt_idx" ON "PsychologistApplicant"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "PsychologistApplicant_email_idx" ON "PsychologistApplicant"("email");

-- RenameIndex
ALTER INDEX "PsychologistProfile_publicationStatus_presence_acceptingNewClie" RENAME TO "PsychologistProfile_publicationStatus_presence_acceptingNew_idx";
