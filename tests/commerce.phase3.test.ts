import {
  BillingMode,
  OrderPurpose,
  PaymentProvider,
  PaymentStatus,
  SubscriptionStatus,
} from "@prisma/client";
import Stripe from "stripe";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import {
  clearTestPaymentProviderAdapters,
  setTestPaymentProviderAdapter,
} from "../src/modules/payments/providers";
import { PaymentProviderAdapter } from "../src/modules/payments/providers/payment-provider.interface";
import { resetAuthTables, registerPayload } from "./helpers";

const app = createApp();
const STRIPE_WEBHOOK_SECRET = "whsec_test_webhook_secret_for_vitest_only";

const mockRazorpayAdapter: PaymentProviderAdapter = {
  provider: PaymentProvider.RAZORPAY,
  async createCheckoutSession(input) {
    return {
      provider: PaymentProvider.RAZORPAY,
      providerReferenceId: "mock_rzp_order_1",
      client: {
        keyId: "mock_key_id",
        orderId: "mock_rzp_order_1",
        amount: input.amountMinorUnits,
        currency: input.currency.toUpperCase(),
      },
    };
  },
};

const registerAndGetToken = async (overrides: Record<string, unknown> = {}): Promise<{ token: string; userId: string }> => {
  const res = await request(app)
    .post("/api/auth/register")
    .set("X-Client-Platform", "ios")
    .send(registerPayload(overrides));
  expect(res.status).toBe(201);
  return { token: res.body.data.tokens.accessToken, userId: res.body.data.user.id };
};

describe("Chunk 3 Phase 3 — subscription checkout", () => {
  beforeEach(async () => {
    await resetAuthTables();
    await prisma.subscriptionPlan.updateMany({ data: { isActive: true } });
    process.env.PAYMENT_DEV_COUNTRY = "IN";
    setTestPaymentProviderAdapter(PaymentProvider.RAZORPAY, mockRazorpayAdapter);
  });

  afterEach(() => {
    clearTestPaymentProviderAdapters();
    process.env.STRIPE_WEBHOOK_SECRET = "";
    process.env.STRIPE_SECRET_KEY = "";
  });

  const enableStripeWebhookTestEnv = (): void => {
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_phase3";
  };

  it("POST /api/subscriptions/checkout requires auth", async () => {
    const plan = await prisma.subscriptionPlan.findFirst({ where: { code: "MONTHLY" } });
    const res = await request(app).post("/api/subscriptions/checkout").send({ planId: plan!.id });
    expect(res.status).toBe(401);
  });

  it("creates checkout from authoritative plan price (mocked provider)", async () => {
    const { token } = await registerAndGetToken();
    const plan = await prisma.subscriptionPlan.findFirst({ where: { code: "MONTHLY" } });
    expect(plan!.priceMinorUnits).toBe(19900);

    const res = await request(app)
      .post("/api/subscriptions/checkout")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "checkout-phase3-1")
      .send({ planId: plan!.id });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("success");
    expect(res.body.data.order.amountMinorUnits).toBe(19900);
    expect(res.body.data.order.currency).toBe("INR");
    expect(res.body.data.provider).toBe("RAZORPAY");
    expect(res.body.data.checkout.orderId).toBe("mock_rzp_order_1");
    expect(res.body.data.checkout.keySecret).toBeUndefined();
    expect(res.body.data.subscription.status).toBe("PENDING");

    const me = await request(app).get("/api/subscriptions/me").set("Authorization", `Bearer ${token}`);
    expect(me.body.data.subscription.status).toBe("PENDING");
    expect(me.body.data.entitlements.canBookPsychologist).toBe(false);
  });

  it("rejects client-supplied price, currency, and provider fields", async () => {
    const { token } = await registerAndGetToken();
    const plan = await prisma.subscriptionPlan.findFirst({ where: { code: "MONTHLY" } });

    const res = await request(app)
      .post("/api/subscriptions/checkout")
      .set("Authorization", `Bearer ${token}`)
      .send({
        planId: plan!.id,
        priceMinorUnits: 1,
        currency: "USD",
        provider: "STRIPE",
      });

    expect(res.status).toBe(400);
  });

  it("returns 404 for inactive or unknown plan", async () => {
    const { token } = await registerAndGetToken();
    const plan = await prisma.subscriptionPlan.findFirst({ where: { code: "YEARLY" } });
    await prisma.subscriptionPlan.update({ where: { id: plan!.id }, data: { isActive: false } });

    const inactive = await request(app)
      .post("/api/subscriptions/checkout")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "inactive-plan")
      .send({ planId: plan!.id });
    expect(inactive.status).toBe(404);

    const unknown = await request(app)
      .post("/api/subscriptions/checkout")
      .set("Authorization", `Bearer ${token}`)
      .send({ planId: "550e8400-e29b-41d4-a716-446655440099" });
    expect(unknown.status).toBe(404);
  });

  it("returns 503 when payment provider is not configured and no mock adapter", async () => {
    clearTestPaymentProviderAdapters();
    const { token } = await registerAndGetToken();
    const plan = await prisma.subscriptionPlan.findFirst({ where: { code: "QUARTERLY" } });

    const res = await request(app)
      .post("/api/subscriptions/checkout")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "no-provider")
      .send({ planId: plan!.id });

    expect(res.status).toBe(503);
  });

  it("blocks checkout when user already has TRIALING access", async () => {
    const { token, userId } = await registerAndGetToken();
    const plan = await prisma.subscriptionPlan.findFirst({ where: { code: "MONTHLY" } });
    await prisma.subscription.create({
      data: {
        userId,
        planId: plan!.id,
        billingMode: BillingMode.AUTOMATIC,
        status: SubscriptionStatus.TRIALING,
        provider: PaymentProvider.RAZORPAY,
        trialStartsAt: new Date(),
        trialEndsAt: new Date(Date.now() + 7 * 86400000),
      },
    });

    const res = await request(app)
      .post("/api/subscriptions/checkout")
      .set("Authorization", `Bearer ${token}`)
      .send({ planId: plan!.id });
    expect(res.status).toBe(409);
  });

  it("another user cannot access another user's order from checkout", async () => {
    const userA = await registerAndGetToken();
    const userB = await registerAndGetToken({
      alias: "Other",
      deviceId: "550e8400-e29b-41d4-a716-446655440012",
      recoveryKey: "river mango lantern quiet cedar monsoon pebble tulsi harbour velvet sparrow dawn",
    });
    const plan = await prisma.subscriptionPlan.findFirst({ where: { code: "MONTHLY" } });

    const checkout = await request(app)
      .post("/api/subscriptions/checkout")
      .set("Authorization", `Bearer ${userA.token}`)
      .set("Idempotency-Key", "user-a-order")
      .send({ planId: plan!.id });
    expect(checkout.status).toBe(201);
    const orderId = checkout.body.data.order.id as string;

    const denied = await request(app)
      .get(`/api/orders/${orderId}`)
      .set("Authorization", `Bearer ${userB.token}`);
    expect(denied.status).toBe(404);
  });

  it("retries with the same Idempotency-Key return the same order", async () => {
    const { token } = await registerAndGetToken();
    const plan = await prisma.subscriptionPlan.findFirst({ where: { code: "MONTHLY" } });

    const first = await request(app)
      .post("/api/subscriptions/checkout")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "idem-phase3")
      .send({ planId: plan!.id });
    const second = await request(app)
      .post("/api/subscriptions/checkout")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "idem-phase3")
      .send({ planId: plan!.id });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.order.id).toBe(first.body.data.order.id);

    const orderCount = await prisma.order.count({ where: { idempotencyKey: "idem-phase3" } });
    expect(orderCount).toBe(1);
  });

  it("verified Stripe payment success activates subscription once", async () => {
    enableStripeWebhookTestEnv();
    const { token, userId } = await registerAndGetToken();
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
        amountMinorUnits: plan!.priceMinorUnits,
        currency: plan!.currency,
        provider: PaymentProvider.STRIPE,
        status: "PENDING",
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: PaymentProvider.STRIPE,
        amountMinorUnits: plan!.priceMinorUnits,
        currency: plan!.currency,
        status: PaymentStatus.PENDING,
        providerPaymentId: "pi_phase3_sub",
      },
    });

    const event = {
      id: "evt_phase3_activate",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_phase3_sub",
          status: "succeeded",
          metadata: { paymentId: payment.id, orderId: order.id },
        },
      },
    };
    const payload = JSON.stringify(event);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_WEBHOOK_SECRET });

    const first = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", header)
      .send(payload);
    expect(first.status).toBe(200);

    const activated = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(activated?.status).toBe(SubscriptionStatus.ACTIVE);
    expect(activated?.currentPeriodStart).toBeTruthy();
    expect(activated?.currentPeriodEnd).toBeTruthy();
    expect(activated?.trialStartsAt).toBeNull();

    const me = await request(app).get("/api/subscriptions/me").set("Authorization", `Bearer ${token}`);
    expect(me.body.data.entitlements.canBookPsychologist).toBe(true);

    const second = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", header)
      .send(payload);
    expect(second.status).toBe(200);

    const afterDup = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(afterDup?.status).toBe(SubscriptionStatus.ACTIVE);
    expect(afterDup?.currentPeriodStart?.toISOString()).toBe(activated?.currentPeriodStart?.toISOString());
  });

  it("failed payment webhook does not activate subscription", async () => {
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
        amountMinorUnits: plan!.priceMinorUnits,
        currency: plan!.currency,
        provider: PaymentProvider.STRIPE,
        status: "PENDING",
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: PaymentProvider.STRIPE,
        amountMinorUnits: plan!.priceMinorUnits,
        currency: plan!.currency,
        status: PaymentStatus.PENDING,
        providerPaymentId: "pi_phase3_fail",
      },
    });

    const event = {
      id: "evt_phase3_fail",
      type: "payment_intent.payment_failed",
      data: {
        object: {
          id: "pi_phase3_fail",
          status: "failed",
          metadata: { paymentId: payment.id, orderId: order.id },
        },
      },
    };
    const payload = JSON.stringify(event);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_WEBHOOK_SECRET });

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", header)
      .send(payload);
    expect(res.status).toBe(200);

    const stillPending = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(stillPending?.status).toBe(SubscriptionStatus.PENDING);
  });

  it("POST /api/subscriptions/cancel is not implemented pending product rule", async () => {
    const { token } = await registerAndGetToken();
    const res = await request(app)
      .post("/api/subscriptions/cancel")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(501);
  });
});
