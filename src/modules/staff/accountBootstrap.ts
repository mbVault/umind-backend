import { AccountStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { loadStaffAccountBySuperTokensUserId, StaffAccountContext } from "./accountLoader";
import { getOrCreatePsychologistProfile } from "./psychologistService";

/**
 * Onboard me: SuperTokens identity → Account (no PSYCHOLOGIST role) + Profile
 * with hrApprovalStatus = PENDING_APPROVAL. Sign in after HR APPROVED + role grant.
 */
export const ensureApplicantAccount = async (input: {
  superTokensUserId: string;
  email?: string | null;
}): Promise<StaffAccountContext> => {
  const existing = await prisma.account.findUnique({
    where: { superTokensUserId: input.superTokensUserId },
  });

  if (!existing) {
    await prisma.account.create({
      data: {
        superTokensUserId: input.superTokensUserId,
        email: input.email?.trim().toLowerCase() || null,
        status: AccountStatus.ACTIVE,
      },
    });
  } else if (existing.deletedAt || existing.status === AccountStatus.DELETED) {
    fail(403, "Staff account is not available");
  } else if (existing.status === AccountStatus.DISABLED) {
    fail(403, "Staff account is disabled");
  } else if (input.email && !existing.email) {
    await prisma.account.update({
      where: { id: existing.id },
      data: { email: input.email.trim().toLowerCase() },
    });
  }

  const account = await loadStaffAccountBySuperTokensUserId(input.superTokensUserId);
  const profile = await getOrCreatePsychologistProfile(account.id);
  if (profile.identityOnboardingBlocked) {
    fail(403, "This identity cannot start a new application. Contact support if you need help.");
  }
  return loadStaffAccountBySuperTokensUserId(input.superTokensUserId);
};
