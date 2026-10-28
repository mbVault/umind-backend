import { BillingMode, Subscription, SubscriptionStatus } from "@prisma/client";
import { fail } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { selectPaymentProviderForCurrentEnvironment } from "../payments/providerSelection";

export const FREE_TRIAL_DAYS = 7;

export const SUBSCRIPTION_PLAN_CODES = ["YEARLY", "QUARTERLY", "MONTHLY"] as const;
export type SubscriptionPlanCode = (typeof SUBSCRIPTION_PLAN_CODES)[number];

export type FreeTrialSubscriptionDto = {
  id: string;
  status: SubscriptionStatus;
  planId: string;
  planCode: string;
  trialStartsAt: string;
  trialEndsAt: string;
};

const toDto = (
  sub: Subscription & { plan: { code: string } },
): FreeTrialSubscriptionDto => {
  if (!sub.trialStartsAt || !sub.trialEndsAt) {
    fail(500, "Trial subscription is missing trial dates");
  }
  return {
    id: sub.id,
    status: sub.status,
    planId: sub.planId,
    planCode: sub.plan.code,
    trialStartsAt: sub.trialStartsAt.toISOString(),
    trialEndsAt: sub.trialEndsAt.toISOString(),
  };
};

/**
 * Starts a 7-day free trial for the chosen plan.
 * Idempotent: returns existing TRIALING/ACTIVE access; upgrades a PENDING checkout to TRIALING.
 */
export const startFreeTrialForUser = async (
  userId: string,
  planCode: SubscriptionPlanCode,
): Promise<FreeTrialSubscriptionDto> => {
  const plan = await prisma.subscriptionPlan.findFirst({
    where: { code: planCode, isActive: true },
  });
  if (!plan) {
    fail(404, "Subscription plan not found");
  }

  const existingAccess = await prisma.subscription.findFirst({
    where: {
      userId,
      status: { in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE] },
    },
    include: { plan: true },
    orderBy: { updatedAt: "desc" },
  });
  if (existingAccess) {
    if (existingAccess.status === SubscriptionStatus.ACTIVE) {
      return {
        id: existingAccess.id,
        status: existingAccess.status,
        planId: existingAccess.planId,
        planCode: existingAccess.plan.code,
        trialStartsAt: existingAccess.trialStartsAt?.toISOString() ?? existingAccess.createdAt.toISOString(),
        trialEndsAt: existingAccess.trialEndsAt?.toISOString() ?? existingAccess.createdAt.toISOString(),
      };
    }
    return toDto(existingAccess);
  }

  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const provider = selectPaymentProviderForCurrentEnvironment();

  const pending = await prisma.subscription.findFirst({
    where: { userId, status: SubscriptionStatus.PENDING },
    include: { plan: true },
    orderBy: { updatedAt: "desc" },
  });

  if (pending) {
    const updated = await prisma.subscription.update({
      where: { id: pending.id },
      data: {
        planId: plan.id,
        status: SubscriptionStatus.TRIALING,
        billingMode: BillingMode.MANUAL,
        provider,
        trialStartsAt: now,
        trialEndsAt,
      },
      include: { plan: true },
    });
    return toDto(updated);
  }

  const created = await prisma.subscription.create({
    data: {
      userId,
      planId: plan.id,
      billingMode: BillingMode.MANUAL,
      status: SubscriptionStatus.TRIALING,
      provider,
      trialStartsAt: now,
      trialEndsAt,
    },
    include: { plan: true },
  });
  return toDto(created);
};
