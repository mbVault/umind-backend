import { OrderPurpose, OrderStatus, PaymentStatus, Prisma, SubscriptionStatus } from "@prisma/client";
import { fail } from "../../lib/errors";

type OrderWithSubscription = {
  id: string;
  purpose: OrderPurpose;
  subscriptionId: string | null;
  status: OrderStatus;
  amountMinorUnits: number;
  subscription: {
    id: string;
    status: SubscriptionStatus;
    plan: { durationDays: number };
  } | null;
};

/**
 * Activates a subscription after verified payment success (webhook or other server-side confirmation).
 * Idempotent: safe for duplicate/out-of-order events; never downgrades ACTIVE/TRIALING access.
 */
export const activateSubscriptionFromVerifiedPayment = async (
  tx: Prisma.TransactionClient,
  order: OrderWithSubscription,
  payment: { status: PaymentStatus; amountMinorUnits: number },
): Promise<void> => {
  if (order.purpose !== OrderPurpose.SUBSCRIPTION || !order.subscriptionId || !order.subscription) {
    return;
  }

  if (payment.status !== PaymentStatus.SUCCEEDED) {
    return;
  }

  if (payment.amountMinorUnits !== order.amountMinorUnits) {
    fail(409, "Payment amount does not match order");
  }

  const sub = order.subscription;

  if (sub.status === SubscriptionStatus.ACTIVE || sub.status === SubscriptionStatus.PAST_DUE) {
    return;
  }

  if (sub.status === SubscriptionStatus.TRIALING) {
    /** Trial → paid conversion timing is a product decision; do not auto-flip trial rows. */
    return;
  }

  if (sub.status !== SubscriptionStatus.PENDING) {
    return;
  }

  const now = new Date();
  const periodEnd = new Date(now.getTime() + sub.plan.durationDays * 24 * 60 * 60 * 1000);

  await tx.subscription.update({
    where: { id: sub.id },
    data: {
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      /** trialStartsAt / trialEndsAt unchanged — trial start trigger not defined in Phase 3 */
    },
  });
};
