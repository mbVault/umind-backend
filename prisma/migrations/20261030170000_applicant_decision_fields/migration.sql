-- CreateEnum
CREATE TYPE "PsychologistApplicantNextAction" AS ENUM ('WAIT', 'RESUBMIT', 'UPLOAD_DOC', 'CLARIFY', 'CONTACT_SUPPORT', 'NONE');

-- AlterTable
ALTER TABLE "PsychologistProfile"
  ADD COLUMN "applicantNextAction" "PsychologistApplicantNextAction" NOT NULL DEFAULT 'WAIT',
  ADD COLUMN "applicantMessage" VARCHAR(500),
  ADD COLUMN "identityOnboardingBlocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "finalRejectionAt" TIMESTAMPTZ(6);
