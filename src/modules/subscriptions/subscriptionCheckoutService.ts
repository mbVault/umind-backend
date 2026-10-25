import {
  BillingMode,
  OrderPurpose,
  OrderStatus,
  PaymentProvider,
  SubscriptionStatus,
} from "@prisma/client";
import { fail } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { createOrderWithPayment, CreateOrderPaymentResult } from "../payments/paymentService";
import { selectPaymentProviderForCurrentEnvironment } from "../payments/providerSelection";

const BLOCKING_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
];

export type SubscriptionCheckoutInput = {
  userId: string;
  planId: string;
  idempotencyKey?: string;
};

export type SubscriptionCheckoutResult = CreateOrderPaymentResult & {
  subscription: {
    id: string;
    status: SubscriptionStatus;
    planId: string;
    planCode: string;
  };
};

export const startSubscriptionCheckout = async (
  input: SubscriptionCheckoutInput,
): Promise<SubscriptionCheckoutResult> => {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: input.planId } });
  if (!plan || !plan.isActive) {
    fail(404, "Subscription plan not found");
  }

  const blocking = await prisma.subscription.findFirst({
    where: { userId: input.userId, status: { in: BLOCKING_SUBSCRIPTION_STATUSES } },
  });
  if (blocking) {
    fail(409, "An active subscription already exists for this account");
  }

  const provider: PaymentProvider = selectPaymentProviderForCurrentEnvironment();

  let subscription = await prisma.subscription.findFirst({
    where: { userId: input.userId, status: SubscriptionStatus.PENDING },
    include: { plan: true },
  });

  if (subscription && subscription.planId !== plan.id) {
    fail(409, "A pending checkout for a different plan is already in progress");
  }

  if (!subscription) {
    subscription = await prisma.subscription.create({
      data: {
        userId: input.userId,
        planId: plan.id,
        billingMode: BillingMode.MANUAL,
        status: SubscriptionStatus.PENDING,
        provider,
      },
      include: { plan: true },
    });
  } else if (subscription.provider !== provider) {
    subscription = await prisma.subscription.update({
      where: { id: subscription.id },
      data: { provider },
      include: { plan: true },
    });
  }

  const pendingOrder = await prisma.order.findFirst({
    where: {
      subscriptionId: subscription.id,
      status: { in: [OrderStatus.CREATED, OrderStatus.PENDING] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (pendingOrder && !input.idempotencyKey) {
    fail(409, "Pending checkout already in progress; retry with the same Idempotency-Key");
  }

  if (pendingOrder && input.idempotencyKey && pendingOrder.idempotencyKey !== input.idempotencyKey) {
    fail(409, "Pending checkout already in progress for this subscription");
  }

  const checkout = await createOrderWithPayment({
    userId: input.userId,
    purpose: OrderPurpose.SUBSCRIPTION,
    subscriptionId: subscription.id,
    amountMinorUnits: plan.priceMinorUnits,
    currency: plan.currency,
    idempotencyKey: input.idempotencyKey,
    provider,
  });

  return {
    ...checkout,
    subscription: {
      id: subscription.id,
      status: subscription.status,
      planId: plan.id,
      planCode: plan.code,
    },
  };
};
