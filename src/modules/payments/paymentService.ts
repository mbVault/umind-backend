import { OrderPurpose, OrderStatus, PaymentProvider, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { assertProviderConfigured } from "./paymentConfig";
import { getPaymentProviderAdapter, hasTestPaymentProviderAdapter } from "./providers";
import { selectPaymentProviderForCurrentEnvironment } from "./providerSelection";
export type CreateOrderPaymentInput = {
  userId: string;
  purpose: OrderPurpose;
  amountMinorUnits: number;
  currency: string;
  bookingId?: string;
  subscriptionId?: string;
  idempotencyKey?: string;
  provider?: PaymentProvider;
};

export type CreateOrderPaymentResult = {
  order: {
    id: string;
    status: OrderStatus;
    purpose: OrderPurpose;
    amountMinorUnits: number;
    currency: string;
    provider: PaymentProvider;
  };
  payment: {
    id: string;
    status: PaymentStatus;
  };
  checkout: Record<string, unknown>;
  provider: PaymentProvider;
};

const assertOrderTargets = (input: CreateOrderPaymentInput): void => {
  if (input.purpose === OrderPurpose.PSYCHOLOGIST_BOOKING && !input.bookingId) {
    fail(400, "bookingId is required for psychologist booking orders");
  }
  if (input.purpose === OrderPurpose.SUBSCRIPTION && !input.subscriptionId) {
    fail(400, "subscriptionId is required for subscription orders");
  }
  if (input.purpose === OrderPurpose.PSYCHOLOGIST_BOOKING && input.subscriptionId) {
    fail(400, "Order cannot reference both booking and subscription");
  }
};

export const createOrderWithPayment = async (input: CreateOrderPaymentInput): Promise<CreateOrderPaymentResult> => {
  assertOrderTargets(input);

  const provider = input.provider ?? selectPaymentProviderForCurrentEnvironment();
  if (!hasTestPaymentProviderAdapter(provider)) {
    assertProviderConfigured(provider);
  }

  if (input.idempotencyKey) {
    const existing = await prisma.order.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (existing && existing.userId === input.userId) {
      const payment = existing.payments[0];
      if (!payment) {
        fail(409, "Existing idempotent order has no payment row");
      }
      return {
        order: {
          id: existing.id,
          status: existing.status,
          purpose: existing.purpose,
          amountMinorUnits: existing.amountMinorUnits,
          currency: existing.currency,
          provider: existing.provider,
        },
        payment: { id: payment.id, status: payment.status },
        checkout: {
          note: "Idempotent replay — provider checkout was already created for this order",
          providerOrderId: existing.providerOrderId,
        },
        provider: existing.provider,
      };
    }
  }

  const adapter = getPaymentProviderAdapter(provider);

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        userId: input.userId,
        purpose: input.purpose,
        bookingId: input.bookingId,
        subscriptionId: input.subscriptionId,
        amountMinorUnits: input.amountMinorUnits,
        currency: input.currency.toUpperCase(),
        provider,
        status: OrderStatus.PENDING,
        idempotencyKey: input.idempotencyKey,
      },
    });

    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        provider,
        amountMinorUnits: input.amountMinorUnits,
        currency: input.currency.toUpperCase(),
        status: PaymentStatus.PENDING,
      },
    });

    const session = await adapter.createCheckoutSession({
      amountMinorUnits: input.amountMinorUnits,
      currency: input.currency,
      receiptReference: order.id,
      metadata: {
        orderId: order.id,
        paymentId: payment.id,
        userId: input.userId,
        purpose: input.purpose,
      },
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        providerOrderId:
          provider === PaymentProvider.RAZORPAY ? session.providerReferenceId : order.providerOrderId,
      },
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        providerPaymentId:
          provider === PaymentProvider.STRIPE ? session.providerReferenceId : payment.providerPaymentId,
      },
    });

    return {
      order: {
        id: order.id,
        status: order.status,
        purpose: order.purpose,
        amountMinorUnits: order.amountMinorUnits,
        currency: order.currency,
        provider: order.provider,
      },
      payment: { id: payment.id, status: payment.status },
      checkout: session.client,
      provider,
    };
  });
};

export type OrderDetailForUser = {
  id: string;
  status: OrderStatus;
  purpose: OrderPurpose;
  amountMinorUnits: number;
  currency: string;
  provider: PaymentProvider;
  providerOrderId: string | null;
  payments: {
    id: string;
    status: PaymentStatus;
    providerPaymentId: string | null;
    paidAt: string | null;
    failedAt: string | null;
  }[];
};

export const getOrderForUser = async (userId: string, orderId: string): Promise<OrderDetailForUser> => {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: { payments: { orderBy: { createdAt: "desc" } } },
  });
  if (!order) {
    fail(404, "Order not found");
  }

  return {
    id: order.id,
    status: order.status,
    purpose: order.purpose,
    amountMinorUnits: order.amountMinorUnits,
    currency: order.currency,
    provider: order.provider,
    providerOrderId: order.providerOrderId,
    payments: order.payments.map((p) => ({
      id: p.id,
      status: p.status,
      providerPaymentId: p.providerPaymentId,
      paidAt: p.paidAt?.toISOString() ?? null,
      failedAt: p.failedAt?.toISOString() ?? null,
    })),
  };
};
