import { StaffAccountContext } from "./accountLoader";

export const toStaffMeDto = (account: StaffAccountContext) => ({
  id: account.id,
  email: account.email,
  status: account.status,
  roles: account.roles.map((r) => r.role),
  hasPsychologistProfile: Boolean(account.psychologistProfile),
  hasAdminMembership: Boolean(
    account.adminMembership &&
      account.adminMembership.status === "ACTIVE" &&
      !account.adminMembership.revokedAt
  ),
});

export const toPsychologistProfileDto = (profile: {
  id: string;
  accountId: string;
  legalFullName: string | null;
  visibilityMode: string;
  displayName: string | null;
  publicPhotoObjectKey: string | null;
  avatarColor: string | null;
  avatarInitials: string | null;
  rciRegistrationNumber: string | null;
  highestDegree: string | null;
  yearsPractising: number | null;
  idDocumentType: string | null;
  aadhaarLast4: string | null;
  onboardingStep: string;
  applicationSubmittedAt: Date | null;
  publicationStatus: string;
  accountStatus: string;
  publishedAt: Date | null;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  specialisations?: { code: string }[];
  languages?: { code: string }[];
  checks?: { id: string; type: string; status: string; reason: string | null; reviewedAt: Date | null }[];
}) => ({
  id: profile.id,
  accountId: profile.accountId,
  legalFullName: profile.legalFullName,
  visibilityMode: profile.visibilityMode,
  displayName: profile.displayName,
  // Never expose raw storage keys on public-ish DTOs used by psych self-view — photo key is private ref.
  hasPublicPhoto: Boolean(profile.publicPhotoObjectKey),
  avatarColor: profile.avatarColor,
  avatarInitials: profile.avatarInitials,
  rciRegistrationNumber: profile.rciRegistrationNumber,
  highestDegree: profile.highestDegree,
  yearsPractising: profile.yearsPractising,
  idDocumentType: profile.idDocumentType,
  aadhaarLast4: profile.aadhaarLast4,
  onboardingStep: profile.onboardingStep,
  applicationSubmittedAt: profile.applicationSubmittedAt?.toISOString() ?? null,
  publicationStatus: profile.publicationStatus,
  accountStatus: profile.accountStatus,
  publishedAt: profile.publishedAt?.toISOString() ?? null,
  suspendedAt: profile.suspendedAt?.toISOString() ?? null,
  suspensionReason: profile.suspensionReason,
  specialisations: profile.specialisations?.map((s) => s.code) ?? [],
  languages: profile.languages?.map((l) => l.code) ?? [],
  checks:
    profile.checks?.map((c) => ({
      id: c.id,
      type: c.type,
      status: c.status,
      reason: c.reason,
      reviewedAt: c.reviewedAt?.toISOString() ?? null,
    })) ?? [],
});
