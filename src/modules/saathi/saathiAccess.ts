import { User, UserStatus } from "@prisma/client";
import { fail } from "../../lib/errors";
import { getSubscriptionMeForUser } from "../subscriptions/entitlementService";

export const assertSaathiAccess = async (user: User): Promise<void> => {
  if (user.status !== UserStatus.ACTIVE || user.deletedAt) {
    fail(403, "Account is not eligible for Saathi");
  }

  const { entitlements } = await getSubscriptionMeForUser(user.id);
  if (!entitlements.canAccessSaathi) {
    fail(403, "Saathi requires an active trial or subscription");
  }
};
