import {
  BillingMode,
  OrderPurpose,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  SubscriptionStatus,
} from "@prisma/client";
import Stripe from "stripe";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { getPaymentProviderStatus } from "../src/modules/payments/paymentConfig";
import { createOrderWithPayment } from "../src/modules/payments/paymentService";
import { selectPaymentProvider } from "../src/modules/payments/providerSelection";
import { resetAuthTables, registerPayload } from "./helpers";

const app = createApp();
const STRIPE_WEBHOOK_SECRET = "whsec_test_webhook_secret_for_vitest_only";

const registerAndGetToken = async (): Promise<{ token: string; userId: string }> => {
  const res = await request(app)
    .post("/api/auth/register")
    .set("X-Client-Platform", "ios")
    .send(registerPayload());
  expect(res.status).toBe(201);
  return { token: res.body.data.tokens.accessToken, userId: res.body.data.user.id };
};

describe("Chunk 3 Phase 2 — payments infrastructure", () => {
  beforeEach(async () => {
    await resetAuthTables();
    process.env.PAYMENT_DEV_COUNTRY = "IN";
    process.env.STRIPE_WEBHOOK_SECRET = "";
    process.env.STRIPE_SECRET_KEY = "";
  });

  const enableStripeWebhookTestEnv = (): void => {
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_phase2";
  };

  it("selects Razorpay for IN and Stripe for supported international countries in non-production", () => {
    expect(selectPaymentProvider("IN")).toBe(PaymentProvider.RAZORPAY);
    expect(selectPaymentProvider("US")).toBe(PaymentProvider.STRIPE);
  });

  it("reports missing provider credentials in test environment", () => {
    const status = getPaymentProviderStatus();
    expect(status.razorpay.configured).toBe(false);
    expect(status.stripe.configured).toBe(false);
  });

  it("createOrderWithPayment fails with 503 when provider is not configured", async () => {
    const { userId } = await registerAndGetToken();
    const plan = await prisma.subscriptionPlan.findFirst({ where: { code: "MONTHLY" } });
    const sub = await prisma.subscription.create({
      data: {
        userId,
        planId: plan!.id,
        billingMode: BillingMode.MANUAL,
        status: SubscriptionStatus.PENDING,
        provider: PaymentProvider.RAZORPAY,
      },
    });

    await expect(
      createOrderWithPayment({
        userId,
        purpose: OrderPurpose.SUBSCRIPTION,
        subscriptionId: sub.id,
        amountMinorUnits: plan!.priceMinorUnits,
        currency: plan!.currency,
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it("GET /api/orders/:orderId enforces ownership", async () => {
    const userA = await registerAndGetToken();
    const regB = await request(app)
      .post("/api/auth/register")
      .set("X-Client-Platform", "ios")
      .send(
        registerPayload({
          alias: "Other",
          deviceId: "550e8400-e29b-41d4-a716-446655440011",
          recoveryKey: "river mango lantern quiet cedar monsoon pebble tulsi harbour velvet sparrow dawn",
        }),
      );
    expect(regB.status).toBe(201);
    const userB = { token: regB.body.data.tokens.accessToken as string };

    const order = await prisma.order.create({
      data: {
        userId: userA.userId,
        purpose: OrderPurpose.SUBSCRIPTION,
        amountMinorUnits: 19900,
        currency: "INR",
        provider: PaymentProvider.RAZORPAY,
        status: OrderStatus.PENDING,
        subscriptionId: (
          await prisma.subscription.create({
            data: {
              userId: userA.userId,
              planId: (await prisma.subscriptionPlan.findFirst({ where: { code: "MONTHLY" } }))!.id,
              billingMode: BillingMode.MANUAL,
              status: SubscriptionStatus.PENDING,
              provider: PaymentProvider.RAZORPAY,
            },
          })
        ).id,
      },
    });

    const denied = await request(app)
      .get(`/api/orders/${order.id}`)
      .set("Authorization", `Bearer ${userB.token}`);
    expect(denied.status).toBe(404);

    const ok = await request(app)
      .get(`/api/orders/${order.id}`)
      .set("Authorization", `Bearer ${userA.token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.id).toBe(order.id);
  });

  it("rejects Stripe webhooks with invalid signatures", async () => {
    enableStripeWebhookTestEnv();
    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "bad")
      .send(JSON.stringify({ id: "evt_bad", type: "payment_intent.succeeded" }));
    expect(res.status).toBe(400);
  });

  it("processes Stripe payment_intent.succeeded idempotently", async () => {
    enableStripeWebhookTestEnv();
    const { userId } = await registerAndGetToken();
    const plan = await prisma.subscriptionPlan.findFirst({ where: { code: "MONTHLY" } });
    const sub = await prisma.subscription.create({
      data: {
        userId,
        planId: plan!.id,
        billingMode: BillingMode.MANUAL,
        status: SubscriptionStatus.PENDING,
        provider: PaymentProvider.STRIPE,
      },
    });
    const order = await prisma.order.create({
      data: {
        userId,
        purpose: OrderPurpose.SUBSCRIPTION,
        subscriptionId: sub.id,
        amountMinorUnits: 19900,
        currency: "INR",
        provider: PaymentProvider.STRIPE,
        status: OrderStatus.PENDING,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: PaymentProvider.STRIPE,
        amountMinorUnits: 19900,
        currency: "INR",
        status: PaymentStatus.PENDING,
        providerPaymentId: "pi_test_phase2",
      },
    });

    const event = {
      id: "evt_phase2_test_1",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_test_phase2",
          status: "succeeded",
          metadata: { paymentId: payment.id, orderId: order.id },
        },
      },
    };
    const payload = JSON.stringify(event);
    const header = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: STRIPE_WEBHOOK_SECRET,
    });

    const first = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", header)
      .send(payload);
    expect(first.status).toBe(200);

    const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(updated?.status).toBe(PaymentStatus.SUCCEEDED);

    const historyCount = await prisma.paymentStatusHistory.count({ where: { paymentId: payment.id } });

    const second = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", header)
      .send(payload);
    expect(second.status).toBe(200);

    const historyAfter = await prisma.paymentStatusHistory.count({ where: { paymentId: payment.id } });
    expect(historyAfter).toBe(historyCount);
  });
});
