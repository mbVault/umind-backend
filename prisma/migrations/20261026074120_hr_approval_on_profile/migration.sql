/*
  Warnings:

  - You are about to drop the `PsychologistApplicant` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "PsychologistHrApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "PsychologistProfile" ADD COLUMN     "hrApprovalStatus" "PsychologistHrApprovalStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
ADD COLUMN     "hrRejectionReason" VARCHAR(500),
ADD COLUMN     "hrReviewedAt" TIMESTAMPTZ(6),
ADD COLUMN     "hrReviewedByAccountId" UUID;

-- DropTable
DROP TABLE "PsychologistApplicant";

-- DropEnum
DROP TYPE "PsychologistApplicantStatus";

-- CreateIndex
CREATE INDEX "PsychologistProfile_hrApprovalStatus_applicationSubmittedAt_idx" ON "PsychologistProfile"("hrApprovalStatus", "applicationSubmittedAt");
