import {
  CommunicationMode,
  DocumentStatus,
  Prisma,
  PsychologistAccountStatus,
  PsychologistApplicantNextAction,
  PsychologistDocumentKind,
  PsychologistHrApprovalStatus,
  PsychologistOnboardingStep,
  PsychologistPresence,
  PsychologistPublicationStatus,
  VerificationCheckStatus,
  VerificationCheckType,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { REQUIRED_DOCUMENT_KINDS, REQUIRED_VERIFICATION_CHECKS } from "./permissions";
import { isValidRciNumber, looksLikeFullAadhaar, normalizeAadhaarLast4, normalizeRciNumber } from "./rci";
import { writeAuditLog } from "./auditService";

const profileInclude = {
  specialisations: true,
  languages: true,
  documents: { orderBy: { createdAt: "desc" as const } },
  checks: true,
} satisfies Prisma.PsychologistProfileInclude;

export const getOrCreatePsychologistProfile = async (accountId: string) => {
  const existing = await prisma.psychologistProfile.findUnique({
    where: { accountId },
    include: profileInclude,
  });
  if (existing) {
    return existing;
  }
  return prisma.psychologistProfile.create({
    data: { accountId },
    include: profileInclude,
  });
};

export const upsertApplicationDraft = async (
  accountId: string,
  input: {
    legalFullName?: string;
    rciRegistrationNumber?: string;
    highestDegree?: string;
    yearsPractising?: number;
    specialisations?: string[];
    languages?: string[];
    idDocumentType?: string;
    aadhaarLast4?: string;
  }
) => {
  const profile = await getOrCreatePsychologistProfile(accountId);

  if (
    profile.identityOnboardingBlocked ||
    profile.applicantNextAction === PsychologistApplicantNextAction.NONE
  ) {
    fail(403, "This application was finally rejected and cannot be edited");
  }

  if (
    profile.hrApprovalStatus === PsychologistHrApprovalStatus.REJECTED &&
    profile.applicantNextAction !== PsychologistApplicantNextAction.RESUBMIT
  ) {
    fail(403, "Resubmission is not permitted for this application");
  }

  if (
    profile.publicationStatus === PsychologistPublicationStatus.LIVE ||
    profile.publicationStatus === PsychologistPublicationStatus.PENDING_VERIFICATION
  ) {
    // Allow draft edits only before/after needs-attention; pending can still fix docs via reupload.
  }

  let rci: string | undefined;
  if (input.rciRegistrationNumber !== undefined) {
    rci = normalizeRciNumber(input.rciRegistrationNumber);
    if (!isValidRciNumber(rci)) {
      fail(400, "Validation failed", { rciRegistrationNumber: ["Invalid RCI registration number"] });
    }
  }

  let aadhaarLast4: string | null | undefined;
  if (input.aadhaarLast4 !== undefined) {
    if (looksLikeFullAadhaar(input.aadhaarLast4)) {
      fail(400, "Validation failed", { aadhaarLast4: ["Full Aadhaar numbers are not accepted"] });
    }
    const normalized = normalizeAadhaarLast4(input.aadhaarLast4);
    if (!normalized) {
      fail(400, "Validation failed", { aadhaarLast4: ["Provide exactly the last 4 digits"] });
    }
    aadhaarLast4 = normalized;
  }

  return prisma.$transaction(async (tx) => {
    await tx.psychologistProfile.update({
      where: { id: profile.id },
      data: {
        legalFullName: input.legalFullName ?? undefined,
        highestDegree: input.highestDegree ?? undefined,
        yearsPractising: input.yearsPractising ?? undefined,
        rciRegistrationNumber: rci ?? undefined,
        idDocumentType: (input.idDocumentType as never) ?? undefined,
        aadhaarLast4: aadhaarLast4 === undefined ? undefined : aadhaarLast4,
        onboardingStep: PsychologistOnboardingStep.APPLY,
      },
    });

    if (input.specialisations) {
      await tx.psychologistSpecialisation.deleteMany({ where: { psychologistProfileId: profile.id } });
      if (input.specialisations.length) {
        await tx.psychologistSpecialisation.createMany({
          data: input.specialisations.map((code) => ({
            psychologistProfileId: profile.id,
            code: code as never,
          })),
        });
      }
    }

    if (input.languages) {
      await tx.psychologistLanguage.deleteMany({ where: { psychologistProfileId: profile.id } });
      if (input.languages.length) {
        await tx.psychologistLanguage.createMany({
          data: input.languages.map((code) => ({
            psychologistProfileId: profile.id,
            code: code as never,
          })),
        });
      }
    }

    return tx.psychologistProfile.findUniqueOrThrow({
      where: { id: profile.id },
      include: profileInclude,
    });
  });
};

export const updatePsychologistPublicProfile = async (
  accountId: string,
  input: {
    visibilityMode?: string;
    displayName?: string;
    avatarColor?: string;
    avatarInitials?: string;
    publicPhotoObjectKey?: string | null;
  }
) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  return prisma.psychologistProfile.update({
    where: { id: profile.id },
    data: {
      visibilityMode: (input.visibilityMode as never) ?? undefined,
      displayName: input.displayName ?? undefined,
      avatarColor: input.avatarColor ?? undefined,
      avatarInitials: input.avatarInitials ?? undefined,
      publicPhotoObjectKey:
        input.publicPhotoObjectKey === undefined ? undefined : input.publicPhotoObjectKey,
      onboardingStep: PsychologistOnboardingStep.PROFILE,
    },
    include: profileInclude,
  });
};

export const submitPsychologistApplication = async (accountId: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);

  const errors: Record<string, string[]> = {};
  if (!profile.legalFullName?.trim()) errors.legalFullName = ["Required"];
  if (!profile.rciRegistrationNumber) errors.rciRegistrationNumber = ["Required"];
  else if (!isValidRciNumber(profile.rciRegistrationNumber)) {
    errors.rciRegistrationNumber = ["Invalid RCI registration number"];
  }
  if (!profile.highestDegree?.trim()) errors.highestDegree = ["Required"];
  if (profile.yearsPractising === null || profile.yearsPractising === undefined) {
    errors.yearsPractising = ["Required"];
  } else if (profile.yearsPractising < 0 || profile.yearsPractising > 50) {
    errors.yearsPractising = ["Must be between 0 and 50"];
  }
  if (!profile.specialisations.length) errors.specialisations = ["Select at least one"];
  if (!profile.languages.length) errors.languages = ["Select at least one"];
  if (!profile.idDocumentType) errors.idDocumentType = ["Required"];
  if (profile.idDocumentType === "AADHAAR" && !profile.aadhaarLast4) {
    errors.aadhaarLast4 = ["Required for Aadhaar"];
  }

  // REPLACED is historical; current active docs should be UPLOADED
  const activeUploaded = new Set(
    profile.documents.filter((d) => d.status === DocumentStatus.UPLOADED).map((d) => d.kind)
  );
  const missingDocs = REQUIRED_DOCUMENT_KINDS.filter((k) => !activeUploaded.has(k as PsychologistDocumentKind));
  if (missingDocs.length) {
    errors.documents = [`Missing uploaded documents: ${missingDocs.join(", ")}`];
  }

  if (Object.keys(errors).length) {
    fail(400, "Validation failed", errors);
  }

  return prisma.$transaction(async (tx) => {
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
        update: {
          status: VerificationCheckStatus.QUEUED,
          reason: null,
          reviewerAccountId: null,
          reviewedAt: null,
        },
      });
    }

    return tx.psychologistProfile.update({
      where: { id: profile.id },
      data: {
        applicationSubmittedAt: new Date(),
        publicationStatus: PsychologistPublicationStatus.PENDING_VERIFICATION,
        onboardingStep: PsychologistOnboardingStep.BACKGROUND_CHECK,
      },
      include: profileInclude,
    });
  });
};

const ALLOWED_CHECK_TRANSITIONS: Record<VerificationCheckStatus, VerificationCheckStatus[]> = {
  QUEUED: [VerificationCheckStatus.IN_PROGRESS],
  IN_PROGRESS: [VerificationCheckStatus.VERIFIED, VerificationCheckStatus.NEEDS_ATTENTION],
  VERIFIED: [VerificationCheckStatus.NEEDS_ATTENTION],
  NEEDS_ATTENTION: [VerificationCheckStatus.QUEUED, VerificationCheckStatus.IN_PROGRESS],
};

export const startVerificationCheck = async (psychologistId: string, checkId: string, reviewerAccountId: string) => {
  const check = await prisma.psychologistVerificationCheck.findFirst({
    where: { id: checkId, psychologistProfileId: psychologistId },
  });
  if (!check) fail(404, "Verification check not found");

  const allowed = ALLOWED_CHECK_TRANSITIONS[check.status];
  if (!allowed.includes(VerificationCheckStatus.IN_PROGRESS)) {
    fail(409, `Cannot start check from status ${check.status}`);
  }

  const updated = await prisma.psychologistVerificationCheck.update({
    where: { id: check.id },
    data: {
      status: VerificationCheckStatus.IN_PROGRESS,
      reviewerAccountId,
    },
  });

  await writeAuditLog({
    actorAccountId: reviewerAccountId,
    action: "CHECK_STATUS_CHANGED",
    targetType: "PsychologistVerificationCheck",
    targetId: check.id,
    metadata: { from: check.status, to: VerificationCheckStatus.IN_PROGRESS },
  });

  return updated;
};

export const decideVerificationCheck = async (
  psychologistId: string,
  checkId: string,
  reviewerAccountId: string,
  decision: "VERIFIED" | "NEEDS_ATTENTION",
  reason?: string
) => {
  if (decision === "NEEDS_ATTENTION" && !reason?.trim()) {
    fail(400, "Validation failed", { reason: ["Reason is required when check needs attention"] });
  }

  const check = await prisma.psychologistVerificationCheck.findFirst({
    where: { id: checkId, psychologistProfileId: psychologistId },
  });
  if (!check) fail(404, "Verification check not found");

  const next = decision as VerificationCheckStatus;
  if (!ALLOWED_CHECK_TRANSITIONS[check.status].includes(next)) {
    fail(409, `Cannot move check from ${check.status} to ${next}`);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.psychologistVerificationCheck.update({
      where: { id: check.id },
      data: {
        status: next,
        reason: reason?.trim() || null,
        reviewerAccountId,
        reviewedAt: new Date(),
      },
    });

    const checks = await tx.psychologistVerificationCheck.findMany({
      where: { psychologistProfileId: psychologistId },
    });
    const allVerified = REQUIRED_VERIFICATION_CHECKS.every((t) =>
      checks.some((c) => c.type === t && c.status === VerificationCheckStatus.VERIFIED)
    );
    const anyNeedsAttention = checks.some((c) => c.status === VerificationCheckStatus.NEEDS_ATTENTION);

    let publicationStatus: PsychologistPublicationStatus | undefined;
    if (anyNeedsAttention) {
      publicationStatus = PsychologistPublicationStatus.NEEDS_ATTENTION;
    } else if (allVerified) {
      publicationStatus = PsychologistPublicationStatus.VERIFIED_UNPUBLISHED;
    } else {
      publicationStatus = PsychologistPublicationStatus.PENDING_VERIFICATION;
    }

    await tx.psychologistProfile.update({
      where: { id: psychologistId },
      data: {
        publicationStatus,
        ...(anyNeedsAttention
          ? {
              applicantNextAction: PsychologistApplicantNextAction.CLARIFY,
              applicantMessage: reason?.trim()?.slice(0, 500) || null,
            }
          : allVerified
            ? {
                applicantNextAction: PsychologistApplicantNextAction.WAIT,
                applicantMessage: null,
              }
            : {}),
      },
    });

    await writeAuditLog({
      tx,
      actorAccountId: reviewerAccountId,
      action: "CHECK_STATUS_CHANGED",
      targetType: "PsychologistVerificationCheck",
      targetId: check.id,
      metadata: { from: check.status, to: next, reason: reason ?? null },
    });

    return updated;
  });
};

export const isPsychologistBookable = (profile: {
  publicationStatus: PsychologistPublicationStatus;
  accountStatus: PsychologistAccountStatus;
  checks: { type: VerificationCheckType; status: VerificationCheckStatus }[];
  presence?: PsychologistPresence;
  acceptingNewClients?: boolean;
  sessionModes?: CommunicationMode[];
}): boolean => {
  if (profile.publicationStatus !== PsychologistPublicationStatus.LIVE) return false;
  if (profile.accountStatus !== PsychologistAccountStatus.ACTIVE) return false;
  if (profile.presence !== undefined && profile.presence !== PsychologistPresence.ONLINE) return false;
  if (profile.acceptingNewClients === false) return false;
  if (profile.sessionModes !== undefined && profile.sessionModes.length === 0) return false;
  return REQUIRED_VERIFICATION_CHECKS.every((t) =>
    profile.checks.some((c) => c.type === t && c.status === VerificationCheckStatus.VERIFIED)
  );
};

export const publishPsychologist = async (psychologistId: string, actorAccountId: string) => {
  const profile = await prisma.psychologistProfile.findUnique({
    where: { id: psychologistId },
    include: { checks: true },
  });
  if (!profile) fail(404, "Psychologist not found");
  if (profile.accountStatus !== PsychologistAccountStatus.ACTIVE) {
    fail(409, "Psychologist account is not active");
  }
  const allVerified = REQUIRED_VERIFICATION_CHECKS.every((t) =>
    profile.checks.some((c) => c.type === t && c.status === VerificationCheckStatus.VERIFIED)
  );
  if (!allVerified) {
    fail(409, "All four verification checks must be VERIFIED before publication");
  }

  const updated = await prisma.psychologistProfile.update({
    where: { id: psychologistId },
    data: {
      publicationStatus: PsychologistPublicationStatus.LIVE,
      publishedAt: new Date(),
      // Avoid LIVE + empty modes (bookable gate would hide the psych from clients).
      ...(profile.sessionModes.length === 0
        ? {
            sessionModes: [
              CommunicationMode.CHAT,
              CommunicationMode.VOICE,
              CommunicationMode.VIDEO,
            ],
          }
        : {}),
    },
    include: profileInclude,
  });

  await writeAuditLog({
    actorAccountId,
    action: "PROFILE_APPROVED_GO_LIVE",
    targetType: "PsychologistProfile",
    targetId: psychologistId,
  });

  return updated;
};

export const suspendPsychologist = async (psychologistId: string, actorAccountId: string, reason: string) => {
  if (!reason.trim()) fail(400, "Validation failed", { reason: ["Required"] });
  const profile = await prisma.psychologistProfile.findUnique({ where: { id: psychologistId } });
  if (!profile) fail(404, "Psychologist not found");

  const updated = await prisma.psychologistProfile.update({
    where: { id: psychologistId },
    data: {
      accountStatus: PsychologistAccountStatus.SUSPENDED,
      suspendedAt: new Date(),
      suspensionReason: reason.trim(),
    },
    include: profileInclude,
  });

  await writeAuditLog({
    actorAccountId,
    action: "PSYCH_PAUSED",
    targetType: "PsychologistProfile",
    targetId: psychologistId,
    metadata: { reason: reason.trim() },
  });

  return updated;
};

export const reactivatePsychologist = async (psychologistId: string, actorAccountId: string) => {
  const profile = await prisma.psychologistProfile.findUnique({
    where: { id: psychologistId },
    include: { checks: true },
  });
  if (!profile) fail(404, "Psychologist not found");

  // Do not auto-republish — return to verified unpublished or pending based on checks.
  const allVerified = REQUIRED_VERIFICATION_CHECKS.every((t) =>
    profile.checks.some((c) => c.type === t && c.status === VerificationCheckStatus.VERIFIED)
  );

  const updated = await prisma.psychologistProfile.update({
    where: { id: psychologistId },
    data: {
      accountStatus: PsychologistAccountStatus.ACTIVE,
      suspendedAt: null,
      suspensionReason: null,
      publicationStatus: allVerified
        ? PsychologistPublicationStatus.VERIFIED_UNPUBLISHED
        : profile.publicationStatus === PsychologistPublicationStatus.LIVE
          ? PsychologistPublicationStatus.VERIFIED_UNPUBLISHED
          : profile.publicationStatus,
    },
    include: profileInclude,
  });

  await writeAuditLog({
    actorAccountId,
    action: "PSYCH_RESUMED",
    targetType: "PsychologistProfile",
    targetId: psychologistId,
  });

  return updated;
};
