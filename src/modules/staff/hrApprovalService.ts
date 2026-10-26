import {
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
 * hrApprovalStatus stays PENDING_APPROVAL (or returns there after REJECTED).
 */
export const submitForHrReview = async (accountId: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);

  if (profile.hrApprovalStatus === PsychologistHrApprovalStatus.APPROVED) {
    fail(409, "Already approved by HR");
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
        publicationStatus: PsychologistPublicationStatus.PENDING_VERIFICATION,
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

/** HR reject → REJECTED, no Sign-in role. */
export const rejectPsychologistByHr = async (input: {
  psychologistProfileId: string;
  reviewerAccountId: string;
  reason: string;
}) => {
  const profile = await prisma.psychologistProfile.findUnique({
    where: { id: input.psychologistProfileId },
    include: { account: { include: { roles: true } } },
  });
  if (!profile) fail(404, "Psychologist not found");
  if (profile.hrApprovalStatus === PsychologistHrApprovalStatus.APPROVED) {
    fail(409, "Cannot reject an already approved psychologist here; use suspend instead");
  }

  const updated = await prisma.psychologistProfile.update({
    where: { id: profile.id },
    data: {
      hrApprovalStatus: PsychologistHrApprovalStatus.REJECTED,
      hrReviewedAt: new Date(),
      hrReviewedByAccountId: input.reviewerAccountId,
      hrRejectionReason: input.reason.slice(0, 500),
      onboardingStep: PsychologistOnboardingStep.APPLY,
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
    metadata: { reason: input.reason.slice(0, 200) },
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
