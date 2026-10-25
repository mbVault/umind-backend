import { createHmac, timingSafeEqual } from "node:crypto";
import {
  OrderPurpose,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  PaymentStatusChangeSource,
  Prisma,
  RefundReason,
  WebhookProcessingStatus,
} from "@prisma/client";
import Stripe from "stripe";
import { fail } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { isRazorpayWebhookConfigured, isStripeWebhookConfigured, readPaymentEnv } from "./paymentConfig";
import { recordPaymentStatusChange } from "./paymentStatusService";
import { reservePendingRefund } from "./refundService";
import { confirmBookingFromVerifiedPayment } from "../bookings/bookingConfirmationService";
import { activateSubscriptionFromVerifiedPayment } from "../subscriptions/subscriptionActivationService";

export const verifyStripeWebhook = (rawBody: Buffer, signatureHeader: string | undefined): Stripe.Event => {
  if (!isStripeWebhookConfigured()) {
    fail(503, "Stripe webhook secret is not configured");
  }
  if (!signatureHeader) {
    fail(400, "Missing Stripe-Signature header");
  }
  const stripe = new Stripe(readPaymentEnv("STRIPE_SECRET_KEY") || "sk_test_placeholder");
  try {
    return stripe.webhooks.constructEvent(rawBody, signatureHeader, readPaymentEnv("STRIPE_WEBHOOK_SECRET"));
  } catch {
    fail(400, "Invalid Stripe webhook signature");
  }
};

export const verifyRazorpayWebhook = (rawBody: Buffer, signatureHeader: string | undefined): void => {
  if (!isRazorpayWebhookConfigured()) {
    fail(503, "Razorpay webhook secret is not configured");
  }
  if (!signatureHeader) {
    fail(400, "Missing X-Razorpay-Signature header");
  }
  const expected = createHmac("sha256", readPaymentEnv("RAZORPAY_WEBHOOK_SECRET")).update(rawBody).digest("hex");
  const received = signatureHeader.trim();
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    fail(400, "Invalid Razorpay webhook signature");
  }
};

const ingestWebhookEvent = async (input: {
  provider: PaymentProvider;
  providerEventId: string;
  eventType: string;
  payload: Prisma.InputJsonValue;
}): Promise<{ duplicate: boolean; id: string | null }> => {
  const existing = await prisma.paymentWebhookEvent.findUnique({
    where: {
      provider_providerEventId: {
        provider: input.provider,
        providerEventId: input.providerEventId,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return { duplicate: true, id: existing.id };
  }

  const row = await prisma.paymentWebhookEvent.create({
    data: {
      provider: input.provider,
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      payload: input.payload,
      processingStatus: WebhookProcessingStatus.RECEIVED,
    },
  });
  return { duplicate: false, id: row.id };
};

const markWebhookProcessed = async (id: string, error?: string): Promise<void> => {
  await prisma.paymentWebhookEvent.update({
    where: { id },
    data: {
      processingStatus: error ? WebhookProcessingStatus.FAILED : WebhookProcessingStatus.PROCESSED,
      processedAt: error ? undefined : new Date(),
      lastError: error ?? null,
    },
  });
};

const applyPaymentSuccess = async (input: {
  paymentId: string;
  providerPaymentId: string;
  providerEventId: string;
  providerStatus: string;
}): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: input.paymentId },
      include: {
        order: {
          include: {
            subscription: { include: { plan: true } },
            booking: true,
          },
        },
      },
    });
    if (!payment) {
      return;
    }
    if (payment.providerPaymentId && payment.providerPaymentId !== input.providerPaymentId) {
      fail(409, "Provider payment id mismatch for order");
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: { providerPaymentId: input.providerPaymentId },
    });

    await recordPaymentStatusChange(tx, {
      paymentId: payment.id,
      newStatus: PaymentStatus.SUCCEEDED,
      source: PaymentStatusChangeSource.WEBHOOK,
      providerEventId: input.providerEventId,
      providerStatus: input.providerStatus,
      paidAt: new Date(),
    });

    const refreshed = await tx.payment.findUnique({
      where: { id: payment.id },
      include: {
        order: {
          include: {
            subscription: { include: { plan: true } },
            booking: true,
          },
        },
      },
    });
    if (!refreshed) {
      return;
    }

    let bookingConfirmOutcome: Awaited<ReturnType<typeof confirmBookingFromVerifiedPayment>> | null = null;
    if (refreshed.order.purpose === OrderPurpose.PSYCHOLOGIST_BOOKING && refreshed.order.booking) {
      bookingConfirmOutcome = await confirmBookingFromVerifiedPayment(
        tx,
        refreshed.order,
        refreshed,
        refreshed.order.amountMinorUnits,
      );
    }

    if (refreshed.order.purpose === OrderPurpose.SUBSCRIPTION && refreshed.order.subscription) {
      await activateSubscriptionFromVerifiedPayment(tx, refreshed.order, refreshed);
    }

    if (payment.order.status === OrderStatus.PENDING || payment.order.status === OrderStatus.CREATED) {
      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: OrderStatus.COMPLETED },
      });
    }

    if (bookingConfirmOutcome === "expired_hold") {
      await reservePendingRefund(
        {
          paymentId: payment.id,
          refundPercentOfPayment: 100,
          reason: RefundReason.PAYMENT_AFTER_SLOT_RELEASED,
          reasonDetail: "Booking hold expired before payment confirmation",
          idempotencyKey: `payment_after_slot_released:${payment.id}`,
        },
        tx,
      );
    }
  });
};

const applyPaymentFailure = async (input: {
  paymentId: string;
  providerPaymentId: string;
  providerEventId: string;
  providerStatus: string;
}): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
    if (!payment || payment.status === PaymentStatus.SUCCEEDED) {
      return;
    }

    await recordPaymentStatusChange(tx, {
      paymentId: payment.id,
      newStatus: PaymentStatus.FAILED,
      source: PaymentStatusChangeSource.WEBHOOK,
      providerEventId: input.providerEventId,
      providerStatus: input.providerStatus,
      failedAt: new Date(),
    });
  });
};

export const processStripeWebhook = async (rawBody: Buffer, signatureHeader: string | undefined): Promise<void> => {
  const event = verifyStripeWebhook(rawBody, signatureHeader);
  const ingest = await ingestWebhookEvent({
    provider: PaymentProvider.STRIPE,
    providerEventId: event.id,
    eventType: event.type,
    payload: event as unknown as Prisma.InputJsonValue,
  });
  if (ingest.duplicate) {
    return;
  }
  if (!ingest.id) {
    return;
  }

  try {
    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object as Stripe.PaymentIntent;
      const paymentId = intent.metadata?.paymentId;
      if (!paymentId) {
        throw new Error("Missing paymentId metadata on PaymentIntent");
      }
      await applyPaymentSuccess({
        paymentId,
        providerPaymentId: intent.id,
        providerEventId: event.id,
        providerStatus: intent.status,
      });
    } else if (event.type === "payment_intent.payment_failed") {
      const intent = event.data.object as Stripe.PaymentIntent;
      const paymentId = intent.metadata?.paymentId;
      if (paymentId) {
        await applyPaymentFailure({
          paymentId,
          providerPaymentId: intent.id,
          providerEventId: event.id,
          providerStatus: intent.status ?? "failed",
        });
      }
    }
    await markWebhookProcessed(ingest.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook processing failed";
    await markWebhookProcessed(ingest.id, message);
    throw err;
  }
};

type RazorpayWebhookPayload = {
  event?: string;
  id?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        status?: string;
        order_id?: string;
        notes?: Record<string, string>;
      };
    };
  };
};

export const processRazorpayWebhook = async (rawBody: Buffer, signatureHeader: string | undefined): Promise<void> => {
  verifyRazorpayWebhook(rawBody, signatureHeader);
  const parsed = JSON.parse(rawBody.toString("utf8")) as RazorpayWebhookPayload;
  const eventType = parsed.event ?? "unknown";
  const providerEventId = parsed.payload?.payment?.entity?.id ?? parsed.id ?? createHmac("sha256", rawBody).digest("hex");

  const ingest = await ingestWebhookEvent({
    provider: PaymentProvider.RAZORPAY,
    providerEventId,
    eventType,
    payload: parsed as Prisma.InputJsonValue,
  });
  if (ingest.duplicate || !ingest.id) {
    return;
  }

  try {
    const entity = parsed.payload?.payment?.entity;
    if (entity?.status === "captured" && entity.notes?.paymentId) {
      await applyPaymentSuccess({
        paymentId: entity.notes.paymentId,
        providerPaymentId: entity.id ?? providerEventId,
        providerEventId,
        providerStatus: entity.status,
      });
    } else if (entity?.status === "failed" && entity.notes?.paymentId) {
      await applyPaymentFailure({
        paymentId: entity.notes.paymentId,
        providerPaymentId: entity.id ?? providerEventId,
        providerEventId,
        providerStatus: entity.status,
      });
    }
    await markWebhookProcessed(ingest.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook processing failed";
    await markWebhookProcessed(ingest.id, message);
    throw err;
  }
};
