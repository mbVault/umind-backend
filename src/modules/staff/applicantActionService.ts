import {
  PsychologistApplicantNextAction,
  PsychologistHrApprovalStatus,
  PsychologistOnboardingStep,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { writeAuditLog } from "./auditService";

const profileInclude = {
  specialisations: true,
  languages: true,
  documents: { orderBy: { createdAt: "desc" as const } },
  checks: true,
} as const;

/**
 * Admin-driven applicant CTAs. Frontend must never infer these from free-text reasons.
 * NONE → final / non-resubmittable (also blocks re-onboarding).
 * RESUBMIT → State 5 / 8A correctable rejection.
 * CLARIFY / UPLOAD_DOC / CONTACT_SUPPORT / WAIT → explicit ops decisions.
 */
export const setApplicantNextAction = async (input: {
  psychologistProfileId: string;
  reviewerAccountId: string;
  nextAction: PsychologistApplicantNextAction;
  applicantSafeMessage: string;
}) => {
  const profile = await prisma.psychologistProfile.findUnique({
    where: { id: input.psychologistProfileId },
  });
  if (!profile) fail(404, "Psychologist not found");

  const message = input.applicantSafeMessage.trim().slice(0, 500);
  if (!message) fail(400, "Validation failed", { applicantSafeMessage: ["Required"] });

  if (profile.identityOnboardingBlocked && input.nextAction !== PsychologistApplicantNextAction.NONE) {
    fail(409, "Identity is finally blocked; only NONE remains valid");
  }

  const data: {
    applicantNextAction: PsychologistApplicantNextAction;
    applicantMessage: string;
    identityOnboardingBlocked?: boolean;
    finalRejectionAt?: Date | null;
    hrApprovalStatus?: PsychologistHrApprovalStatus;
    hrRejectionReason?: string | null;
    onboardingStep?: PsychologistOnboardingStep;
  } = {
    applicantNextAction: input.nextAction,
    applicantMessage: message,
  };

  switch (input.nextAction) {
    case PsychologistApplicantNextAction.NONE:
      data.identityOnboardingBlocked = true;
      data.finalRejectionAt = new Date();
      break;
    case PsychologistApplicantNextAction.RESUBMIT:
      data.identityOnboardingBlocked = false;
      data.finalRejectionAt = null;
      data.hrApprovalStatus = PsychologistHrApprovalStatus.REJECTED;
      data.hrRejectionReason = message;
      data.onboardingStep = PsychologistOnboardingStep.APPLY;
      break;
    case PsychologistApplicantNextAction.CONTACT_SUPPORT:
      // Soft hold — no identity block, no resubmit CTA.
      break;
    case PsychologistApplicantNextAction.CLARIFY:
    case PsychologistApplicantNextAction.UPLOAD_DOC:
    case PsychologistApplicantNextAction.WAIT:
      break;
    default:
      fail(400, "Unsupported next action");
  }

  const updated = await prisma.psychologistProfile.update({
    where: { id: profile.id },
    data,
    include: profileInclude,
  });

  await writeAuditLog({
    actorAccountId: input.reviewerAccountId,
    action: "PSYCHOLOGIST_APPLICANT_ACTION_SET",
    targetType: "PsychologistProfile",
    targetId: profile.id,
    metadata: {
      nextAction: input.nextAction,
      message: message.slice(0, 200),
    },
  });

  return updated;
};

/** Applicant acknowledges clarification with an applicant-safe note; returns to WAIT. */
export const submitClarificationResponse = async (input: {
  accountId: string;
  message: string;
}) => {
  const profile = await prisma.psychologistProfile.findUnique({
    where: { accountId: input.accountId },
  });
  if (!profile) fail(404, "Profile not found");
  if (profile.identityOnboardingBlocked || profile.applicantNextAction === PsychologistApplicantNextAction.NONE) {
    fail(403, "This application was finally rejected");
  }
  if (profile.applicantNextAction !== PsychologistApplicantNextAction.CLARIFY) {
    fail(409, "No clarification is currently requested");
  }

  const note = input.message.trim().slice(0, 500);
  if (note.length < 3) fail(400, "Validation failed", { message: ["Provide a short response"] });

  const updated = await prisma.psychologistProfile.update({
    where: { id: profile.id },
    data: {
      applicantNextAction: PsychologistApplicantNextAction.WAIT,
      applicantMessage: "Your response was received. Awaiting review.",
    },
    include: profileInclude,
  });

  await writeAuditLog({
    actorAccountId: input.accountId,
    action: "PSYCHOLOGIST_CLARIFICATION_RESPONSE",
    targetType: "PsychologistProfile",
    targetId: profile.id,
    metadata: { message: note.slice(0, 200) },
  });

  return updated;
};
