import { Subscription, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export type ClientEntitlements = {
  canAccessSaathi: boolean;
  canAccessAudio: boolean;
  canBookPsychologist: boolean;
};

export type SubscriptionMeResponse = {
  subscription: {
    id: string;
    status: SubscriptionStatus;
    billingMode: string;
    planCode: string;
    planName: string;
    trialStartsAt: string | null;
    trialEndsAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelledAt: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  entitlements: ClientEntitlements;
};

const ACTIVE_CONTENT_STATUSES: SubscriptionStatus[] = [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE];

export const deriveEntitlements = (status: SubscriptionStatus | null): ClientEntitlements => {
  if (!status || !ACTIVE_CONTENT_STATUSES.includes(status)) {
    return {
      canAccessSaathi: false,
      canAccessAudio: false,
      canBookPsychologist: false,
    };
  }

  const contentOk = status === SubscriptionStatus.TRIALING || status === SubscriptionStatus.ACTIVE;
  return {
    canAccessSaathi: contentOk,
    canAccessAudio: contentOk,
    /** Psychologist booking requires paid ACTIVE subscription (no PAST_DUE grace). */
    canBookPsychologist: status === SubscriptionStatus.ACTIVE,
  };
};

const toSubscriptionDto = (sub: Subscription & { plan: { code: string; name: string } }) => ({
  id: sub.id,
  status: sub.status,
  billingMode: sub.billingMode,
  planCode: sub.plan.code,
  planName: sub.plan.name,
  trialStartsAt: sub.trialStartsAt?.toISOString() ?? null,
  trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
  currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
  currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
  cancelledAt: sub.cancelledAt?.toISOString() ?? null,
  cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
});

const ACCESS_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING];

/** Prefer access-granting subscription, then pending checkout, then latest row. */
export const getSubscriptionMeForUser = async (userId: string): Promise<SubscriptionMeResponse> => {
  let sub = await prisma.subscription.findFirst({
    where: { userId, status: { in: ACCESS_SUBSCRIPTION_STATUSES } },
    include: { plan: true },
    orderBy: { updatedAt: "desc" },
  });

  if (!sub) {
    sub = await prisma.subscription.findFirst({
      where: { userId, status: SubscriptionStatus.PENDING },
      include: { plan: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  if (!sub) {
    sub = await prisma.subscription.findFirst({
      where: { userId },
      include: { plan: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  if (!sub) {
    return {
      subscription: null,
      entitlements: deriveEntitlements(null),
    };
  }

  return {
    subscription: toSubscriptionDto(sub),
    entitlements: deriveEntitlements(sub.status),
  };
};
