import {
  PsychologistAccountStatus,
  PsychologistApplicantNextAction,
  PsychologistHrApprovalStatus,
  PsychologistOnboardingStep,
  PsychologistPublicationStatus,
  StaffRole,
  VerificationCheckStatus,
  VerificationCheckType,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { writeAuditLog } from "./auditService";
import { loadStaffAccountBySuperTokensUserId } from "./accountLoader";
import { REQUIRED_VERIFICATION_CHECKS } from "./permissions";
import { getOrCreatePsychologistProfile } from "./psychologistService";

/**
 * Applicant submits for HR queue. Does not grant Sign-in.
 * hrApprovalStatus stays PENDING_APPROVAL (or returns there after correctable REJECTED).
 */
export const submitForHrReview = async (accountId: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);

  if (profile.identityOnboardingBlocked || profile.applicantNextAction === PsychologistApplicantNextAction.NONE) {
    fail(403, "This application was finally rejected and cannot be resubmitted");
  }

  if (profile.hrApprovalStatus === PsychologistHrApprovalStatus.APPROVED) {
    fail(409, "Already approved by HR");
  }

  if (
    profile.hrApprovalStatus === PsychologistHrApprovalStatus.REJECTED &&
    profile.applicantNextAction !== PsychologistApplicantNextAction.RESUBMIT
  ) {
    fail(403, "Resubmission is not permitted for this application");
  }

  const errors: Record<string, string[]> = {};
  if (!profile.legalFullName?.trim()) errors.legalFullName = ["Required"];
  if (!profile.rciRegistrationNumber) errors.rciRegistrationNumber = ["Required"];
  if (!profile.highestDegree?.trim()) errors.highestDegree = ["Required"];
  if (profile.yearsPractising === null || profile.yearsPractising === undefined) {
    errors.yearsPractising = ["Required"];
  }
  if (!profile.specialisations.length) errors.specialisations = ["Select at least one"];
  if (!profile.languages.length) errors.languages = ["Select at least one"];
  if (Object.keys(errors).length) fail(400, "Validation failed", errors);

  return prisma.psychologistProfile.update({
    where: { id: profile.id },
    data: {
      applicationSubmittedAt: new Date(),
      hrApprovalStatus: PsychologistHrApprovalStatus.PENDING_APPROVAL,
      hrRejectionReason: null,
      applicantNextAction: PsychologistApplicantNextAction.WAIT,
      applicantMessage: null,
      onboardingStep: PsychologistOnboardingStep.BACKGROUND_CHECK,
    },
    include: {
      specialisations: true,
      languages: true,
      documents: { orderBy: { createdAt: "desc" } },
      checks: true,
    },
  });
};

/** HR approve → APPROVED + PSYCHOLOGIST role (+ queue verification checks). */
export const approvePsychologistByHr = async (input: {
  psychologistProfileId: string;
  reviewerAccountId: string;
}) => {
  const profile = await prisma.psychologistProfile.findUnique({
    where: { id: input.psychologistProfileId },
    include: { account: { include: { roles: true } } },
  });
  if (!profile) fail(404, "Psychologist not found");
  if (profile.identityOnboardingBlocked) {
    fail(409, "Identity is blocked; cannot approve");
  }
  if (profile.hrApprovalStatus === PsychologistHrApprovalStatus.APPROVED) {
    fail(409, "Already approved");
  }
  if (!profile.applicationSubmittedAt) {
    fail(409, "Application has not been submitted for review");
  }

  await prisma.$transaction(async (tx) => {
    await tx.psychologistProfile.update({
      where: { id: profile.id },
      data: {
        hrApprovalStatus: PsychologistHrApprovalStatus.APPROVED,
        hrReviewedAt: new Date(),
        hrReviewedByAccountId: input.reviewerAccountId,
        hrRejectionReason: null,
        applicantNextAction: PsychologistApplicantNextAction.WAIT,
        applicantMessage: null,
        publicationStatus: PsychologistPublicationStatus.PENDING_VERIFICATION,
        onboardingStep: PsychologistOnboardingStep.DOCUMENTS,
      },
    });

    if (!profile.account.roles.some((r) => r.role === StaffRole.PSYCHOLOGIST)) {
      await tx.accountRole.create({
        data: { accountId: profile.accountId, role: StaffRole.PSYCHOLOGIST },
      });
    }

    for (const type of REQUIRED_VERIFICATION_CHECKS) {
      await tx.psychologistVerificationCheck.upsert({
        where: {
          psychologistProfileId_type: {
            psychologistProfileId: profile.id,
            type: type as VerificationCheckType,
          },
        },
        create: {
          psychologistProfileId: profile.id,
          type: type as VerificationCheckType,
          status: VerificationCheckStatus.QUEUED,
        },
        update: {},
      });
    }
  });

  await writeAuditLog({
    actorAccountId: input.reviewerAccountId,
    action: "PSYCHOLOGIST_HR_APPROVED",
    targetType: "PsychologistProfile",
    targetId: profile.id,
    metadata: { accountId: profile.accountId },
  });

  return loadStaffAccountBySuperTokensUserId(profile.account.superTokensUserId);
};

/**
 * HR reject.
 * allowResubmission=true → State 5 / 8A (RESUBMIT).
 * allowResubmission=false → non-resubmittable at HR stage (NONE + identity block).
 */
export const rejectPsychologistByHr = async (input: {
  psychologistProfileId: string;
  reviewerAccountId: string;
  reason: string;
  allowResubmission: boolean;
}) => {
  const profile = await prisma.psychologistProfile.findUnique({
    where: { id: input.psychologistProfileId },
    include: { account: { include: { roles: true } } },
  });
  if (!profile) fail(404, "Psychologist not found");
  if (profile.hrApprovalStatus === PsychologistHrApprovalStatus.APPROVED) {
    fail(409, "Cannot reject an already approved psychologist here; use final-bgv-reject or suspend");
  }

  const applicantSafe = input.reason.slice(0, 500);
  const updated = await prisma.psychologistProfile.update({
    where: { id: profile.id },
    data: {
      hrApprovalStatus: PsychologistHrApprovalStatus.REJECTED,
      hrReviewedAt: new Date(),
      hrReviewedByAccountId: input.reviewerAccountId,
      hrRejectionReason: applicantSafe,
      applicantMessage: applicantSafe,
      applicantNextAction: input.allowResubmission
        ? PsychologistApplicantNextAction.RESUBMIT
        : PsychologistApplicantNextAction.NONE,
      identityOnboardingBlocked: !input.allowResubmission,
      finalRejectionAt: input.allowResubmission ? null : new Date(),
      onboardingStep: input.allowResubmission
        ? PsychologistOnboardingStep.APPLY
        : PsychologistOnboardingStep.APPLY,
    },
    include: {
      specialisations: true,
      languages: true,
      documents: { orderBy: { createdAt: "desc" } },
      checks: true,
    },
  });

  await writeAuditLog({
    actorAccountId: input.reviewerAccountId,
    action: "PSYCHOLOGIST_HR_REJECTED",
    targetType: "PsychologistProfile",
    targetId: profile.id,
    metadata: {
      reason: input.reason.slice(0, 200),
      allowResubmission: input.allowResubmission,
    },
  });

  return updated;
};

/**
 * Final BGV failure (8B) — after HR approval / during verification.
 * Permanently blocks resubmit and re-onboarding for this identity.
 */
export const rejectPsychologistFinalBgv = async (input: {
  psychologistProfileId: string;
  reviewerAccountId: string;
  applicantSafeReason: string;
}) => {
  const profile = await prisma.psychologistProfile.findUnique({
    where: { id: input.psychologistProfileId },
  });
  if (!profile) fail(404, "Psychologist not found");
  if (profile.identityOnboardingBlocked && profile.applicantNextAction === PsychologistApplicantNextAction.NONE) {
    fail(409, "Already finally rejected");
  }

  const applicantSafe = input.applicantSafeReason.slice(0, 500);
  const updated = await prisma.psychologistProfile.update({
    where: { id: profile.id },
    data: {
      applicantNextAction: PsychologistApplicantNextAction.NONE,
      applicantMessage: applicantSafe,
      identityOnboardingBlocked: true,
      finalRejectionAt: new Date(),
      publicationStatus: PsychologistPublicationStatus.NEEDS_ATTENTION,
      accountStatus: PsychologistAccountStatus.DEACTIVATED,
    },
    include: {
      specialisations: true,
      languages: true,
      documents: { orderBy: { createdAt: "desc" } },
      checks: true,
    },
  });

  await writeAuditLog({
    actorAccountId: input.reviewerAccountId,
    action: "PSYCHOLOGIST_FINAL_BGV_REJECTED",
    targetType: "PsychologistProfile",
    targetId: profile.id,
    metadata: { reason: input.applicantSafeReason.slice(0, 200) },
  });

  return updated;
};

export const listHrPendingPsychologists = async (page: number, pageSize: number) => {
  const where = {
    hrApprovalStatus: {
      in: [
        PsychologistHrApprovalStatus.PENDING_APPROVAL,
        PsychologistHrApprovalStatus.REJECTED,
      ],
    },
    applicationSubmittedAt: { not: null },
    identityOnboardingBlocked: false,
  };
  const [total, items] = await Promise.all([
    prisma.psychologistProfile.count({ where }),
    prisma.psychologistProfile.findMany({
      where,
      include: {
        specialisations: true,
        languages: true,
        checks: true,
        account: { select: { id: true, email: true } },
      },
      orderBy: { applicationSubmittedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, items };
};
