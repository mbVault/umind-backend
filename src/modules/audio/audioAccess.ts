import { AudioAccessTier, SubscriptionStatus, User } from "@prisma/client";
import { fail } from "../../lib/errors";
import { getSubscriptionMeForUser } from "../subscriptions/entitlementService";

export type AudioEntitlementSnapshot = {
  status: SubscriptionStatus | null;
  canAccessTrialContent: boolean;
  canAccessSubscriptionContent: boolean;
};

export const getAudioEntitlementSnapshot = async (userId: string): Promise<AudioEntitlementSnapshot> => {
  const me = await getSubscriptionMeForUser(userId);
  const status = me.subscription?.status ?? null;
  return {
    status,
    canAccessTrialContent: status === SubscriptionStatus.TRIALING || status === SubscriptionStatus.ACTIVE,
    canAccessSubscriptionContent: status === SubscriptionStatus.ACTIVE,
  };
};

export const userCanAccessAudioTier = (
  tier: AudioAccessTier,
  snap: AudioEntitlementSnapshot,
): boolean => {
  if (tier === AudioAccessTier.FREE) return true;
  if (tier === AudioAccessTier.TRIAL) return snap.canAccessTrialContent;
  return snap.canAccessSubscriptionContent;
};

export const assertCanPlayAudioTier = async (user: User, tier: AudioAccessTier): Promise<void> => {
  const snap = await getAudioEntitlementSnapshot(user.id);
  if (userCanAccessAudioTier(tier, snap)) return;

  if (tier === AudioAccessTier.SUBSCRIPTION) {
    fail(403, "This session needs an active paid subscription");
  }
  fail(403, "This session needs an active trial or subscription");
};
