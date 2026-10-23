-- Staff auth foundation: Account, psychologist verification, admin RBAC, invitations, audit.

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISABLED', 'DELETED');
CREATE TYPE "StaffRole" AS ENUM ('PSYCHOLOGIST', 'ADMIN');
CREATE TYPE "ProfileVisibilityMode" AS ENUM ('REAL_NAME_AND_PHOTO', 'DISPLAY_NAME_AND_AVATAR');
CREATE TYPE "PsychologistPublicationStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING_VERIFICATION', 'VERIFIED_UNPUBLISHED', 'LIVE', 'NEEDS_ATTENTION');
CREATE TYPE "PsychologistAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');
CREATE TYPE "PsychologistOnboardingStep" AS ENUM ('APPLY', 'PROFILE', 'DOCUMENTS', 'BACKGROUND_CHECK', 'HOURS', 'COMPLETE');
CREATE TYPE "SpecialisationCode" AS ENUM ('STRESS', 'ANXIETY', 'SLEEP', 'BURNOUT', 'RELATIONSHIPS', 'TEENS', 'WOMENS_HEALTH', 'GRIEF');
CREATE TYPE "LanguageCode" AS ENUM ('HINDI', 'ENGLISH', 'MARATHI', 'PUNJABI', 'TAMIL');
CREATE TYPE "IdDocumentType" AS ENUM ('AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENCE');
CREATE TYPE "PsychologistDocumentKind" AS ENUM ('ID_FRONT', 'ID_BACK', 'LIVE_SELFIE', 'PASSPORT_PHOTO', 'DEGREE_CERTIFICATE', 'RCI_CERTIFICATE', 'EXPERIENCE_LETTER');
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'REPLACED', 'REJECTED_NEED_REUPLOAD');
CREATE TYPE "VerificationCheckType" AS ENUM ('IDENTITY', 'RCI_REGISTRATION', 'DEGREE', 'YEARS_OF_EXPERIENCE');
CREATE TYPE "VerificationCheckStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'VERIFIED', 'NEEDS_ATTENTION');
CREATE TYPE "AdminMembershipStatus" AS ENUM ('ACTIVE', 'DISABLED', 'REVOKED');
CREATE TYPE "AdminRoleCode" AS ENUM ('FOUNDER_SUPER_ADMIN', 'VERIFICATION_OFFICER', 'SAFETY_LEAD', 'FINANCE', 'CONTENT_EDITOR');
CREATE TYPE "AdminInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
CREATE TYPE "AuditActorType" AS ENUM ('ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "superTokensUserId" VARCHAR(128) NOT NULL,
    "email" VARCHAR(320),
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountRole" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "role" "StaffRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PsychologistProfile" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "legalFullName" VARCHAR(120),
    "visibilityMode" "ProfileVisibilityMode" NOT NULL DEFAULT 'DISPLAY_NAME_AND_AVATAR',
    "displayName" VARCHAR(80),
    "publicPhotoObjectKey" VARCHAR(512),
    "avatarColor" VARCHAR(16),
    "avatarInitials" VARCHAR(4),
    "rciRegistrationNumber" VARCHAR(64),
    "highestDegree" VARCHAR(120),
    "yearsPractising" INTEGER,
    "idDocumentType" "IdDocumentType",
    "aadhaarLast4" CHAR(4),
    "onboardingStep" "PsychologistOnboardingStep" NOT NULL DEFAULT 'APPLY',
    "applicationSubmittedAt" TIMESTAMPTZ(6),
    "publicationStatus" "PsychologistPublicationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "accountStatus" "PsychologistAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "publishedAt" TIMESTAMPTZ(6),
    "suspendedAt" TIMESTAMPTZ(6),
    "suspensionReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "PsychologistProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PsychologistSpecialisation" (
    "psychologistProfileId" UUID NOT NULL,
    "code" "SpecialisationCode" NOT NULL,
    CONSTRAINT "PsychologistSpecialisation_pkey" PRIMARY KEY ("psychologistProfileId","code")
);

CREATE TABLE "PsychologistLanguage" (
    "psychologistProfileId" UUID NOT NULL,
    "code" "LanguageCode" NOT NULL,
    CONSTRAINT "PsychologistLanguage_pkey" PRIMARY KEY ("psychologistProfileId","code")
);

CREATE TABLE "PsychologistDocument" (
    "id" UUID NOT NULL,
    "psychologistProfileId" UUID NOT NULL,
    "kind" "PsychologistDocumentKind" NOT NULL,
    "storageObjectKey" VARCHAR(512) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksum" CHAR(64),
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "uploadedAt" TIMESTAMPTZ(6),
    "replacedAt" TIMESTAMPTZ(6),
    "rejectionReason" VARCHAR(500),
    "uploadedByAccountId" UUID,
    "replacesDocumentId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "PsychologistDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PsychologistVerificationCheck" (
    "id" UUID NOT NULL,
    "psychologistProfileId" UUID NOT NULL,
    "type" "VerificationCheckType" NOT NULL,
    "status" "VerificationCheckStatus" NOT NULL DEFAULT 'QUEUED',
    "reviewerAccountId" UUID,
    "reason" VARCHAR(1000),
    "reviewedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "PsychologistVerificationCheck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminMembership" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "status" "AdminMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedByAccountId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    CONSTRAINT "AdminMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminRole" (
    "id" UUID NOT NULL,
    "code" "AdminRoleCode" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminMembershipRole" (
    "adminMembershipId" UUID NOT NULL,
    "adminRoleId" UUID NOT NULL,
    "assignedByAccountId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminMembershipRole_pkey" PRIMARY KEY ("adminMembershipId","adminRoleId")
);

CREATE TABLE "AdminPermission" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "description" VARCHAR(255),
    CONSTRAINT "AdminPermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminRolePermission" (
    "adminRoleId" UUID NOT NULL,
    "adminPermissionId" UUID NOT NULL,
    CONSTRAINT "AdminRolePermission_pkey" PRIMARY KEY ("adminRoleId","adminPermissionId")
);

CREATE TABLE "AdminInvitation" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "AdminInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedByAccountId" UUID NOT NULL,
    "roleCodes" "AdminRoleCode"[],
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(6),
    "acceptedByAccountId" UUID,
    "revokedAt" TIMESTAMPTZ(6),
    "resultingMembershipId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "AdminInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminAuditLog" (
    "id" UUID NOT NULL,
    "actorAccountId" UUID,
    "actorType" "AuditActorType" NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "targetType" VARCHAR(64) NOT NULL,
    "targetId" VARCHAR(64),
    "metadata" JSONB,
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(512),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- Indexes & uniques
CREATE UNIQUE INDEX "Account_superTokensUserId_key" ON "Account"("superTokensUserId");
CREATE INDEX "Account_status_idx" ON "Account"("status");

CREATE UNIQUE INDEX "AccountRole_accountId_role_key" ON "AccountRole"("accountId", "role");
CREATE INDEX "AccountRole_role_accountId_idx" ON "AccountRole"("role", "accountId");

CREATE UNIQUE INDEX "PsychologistProfile_accountId_key" ON "PsychologistProfile"("accountId");
CREATE UNIQUE INDEX "PsychologistProfile_rciRegistrationNumber_key" ON "PsychologistProfile"("rciRegistrationNumber");
CREATE INDEX "PsychologistProfile_publicationStatus_idx" ON "PsychologistProfile"("publicationStatus");
CREATE INDEX "PsychologistProfile_accountStatus_idx" ON "PsychologistProfile"("accountStatus");
CREATE INDEX "PsychologistProfile_applicationSubmittedAt_idx" ON "PsychologistProfile"("applicationSubmittedAt");

CREATE INDEX "PsychologistSpecialisation_code_idx" ON "PsychologistSpecialisation"("code");
CREATE INDEX "PsychologistLanguage_code_idx" ON "PsychologistLanguage"("code");

CREATE UNIQUE INDEX "PsychologistDocument_storageObjectKey_key" ON "PsychologistDocument"("storageObjectKey");
CREATE INDEX "PsychologistDocument_psychologistProfileId_kind_idx" ON "PsychologistDocument"("psychologistProfileId", "kind");
CREATE INDEX "PsychologistDocument_status_idx" ON "PsychologistDocument"("status");

CREATE UNIQUE INDEX "PsychologistVerificationCheck_psychologistProfileId_type_key" ON "PsychologistVerificationCheck"("psychologistProfileId", "type");
CREATE INDEX "PsychologistVerificationCheck_status_type_idx" ON "PsychologistVerificationCheck"("status", "type");
CREATE INDEX "PsychologistVerificationCheck_psychologistProfileId_status_idx" ON "PsychologistVerificationCheck"("psychologistProfileId", "status");

CREATE UNIQUE INDEX "AdminMembership_accountId_key" ON "AdminMembership"("accountId");
CREATE INDEX "AdminMembership_status_idx" ON "AdminMembership"("status");

CREATE UNIQUE INDEX "AdminRole_code_key" ON "AdminRole"("code");
CREATE UNIQUE INDEX "AdminPermission_code_key" ON "AdminPermission"("code");

CREATE UNIQUE INDEX "AdminInvitation_tokenHash_key" ON "AdminInvitation"("tokenHash");
CREATE UNIQUE INDEX "AdminInvitation_resultingMembershipId_key" ON "AdminInvitation"("resultingMembershipId");
CREATE INDEX "AdminInvitation_email_status_idx" ON "AdminInvitation"("email", "status");
CREATE INDEX "AdminInvitation_status_expiresAt_idx" ON "AdminInvitation"("status", "expiresAt");
CREATE INDEX "AdminInvitation_invitedByAccountId_idx" ON "AdminInvitation"("invitedByAccountId");

CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");
CREATE INDEX "AdminAuditLog_actorAccountId_idx" ON "AdminAuditLog"("actorAccountId");

-- Foreign keys
ALTER TABLE "AccountRole" ADD CONSTRAINT "AccountRole_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PsychologistProfile" ADD CONSTRAINT "PsychologistProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PsychologistSpecialisation" ADD CONSTRAINT "PsychologistSpecialisation_psychologistProfileId_fkey" FOREIGN KEY ("psychologistProfileId") REFERENCES "PsychologistProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PsychologistLanguage" ADD CONSTRAINT "PsychologistLanguage_psychologistProfileId_fkey" FOREIGN KEY ("psychologistProfileId") REFERENCES "PsychologistProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PsychologistDocument" ADD CONSTRAINT "PsychologistDocument_psychologistProfileId_fkey" FOREIGN KEY ("psychologistProfileId") REFERENCES "PsychologistProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PsychologistDocument" ADD CONSTRAINT "PsychologistDocument_uploadedByAccountId_fkey" FOREIGN KEY ("uploadedByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PsychologistDocument" ADD CONSTRAINT "PsychologistDocument_replacesDocumentId_fkey" FOREIGN KEY ("replacesDocumentId") REFERENCES "PsychologistDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PsychologistVerificationCheck" ADD CONSTRAINT "PsychologistVerificationCheck_psychologistProfileId_fkey" FOREIGN KEY ("psychologistProfileId") REFERENCES "PsychologistProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PsychologistVerificationCheck" ADD CONSTRAINT "PsychologistVerificationCheck_reviewerAccountId_fkey" FOREIGN KEY ("reviewerAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminMembership" ADD CONSTRAINT "AdminMembership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminMembership" ADD CONSTRAINT "AdminMembership_invitedByAccountId_fkey" FOREIGN KEY ("invitedByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminMembershipRole" ADD CONSTRAINT "AdminMembershipRole_adminMembershipId_fkey" FOREIGN KEY ("adminMembershipId") REFERENCES "AdminMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminMembershipRole" ADD CONSTRAINT "AdminMembershipRole_adminRoleId_fkey" FOREIGN KEY ("adminRoleId") REFERENCES "AdminRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminMembershipRole" ADD CONSTRAINT "AdminMembershipRole_assignedByAccountId_fkey" FOREIGN KEY ("assignedByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminRolePermission" ADD CONSTRAINT "AdminRolePermission_adminRoleId_fkey" FOREIGN KEY ("adminRoleId") REFERENCES "AdminRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminRolePermission" ADD CONSTRAINT "AdminRolePermission_adminPermissionId_fkey" FOREIGN KEY ("adminPermissionId") REFERENCES "AdminPermission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdminInvitation" ADD CONSTRAINT "AdminInvitation_invitedByAccountId_fkey" FOREIGN KEY ("invitedByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminInvitation" ADD CONSTRAINT "AdminInvitation_acceptedByAccountId_fkey" FOREIGN KEY ("acceptedByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdminInvitation" ADD CONSTRAINT "AdminInvitation_resultingMembershipId_fkey" FOREIGN KEY ("resultingMembershipId") REFERENCES "AdminMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorAccountId_fkey" FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
