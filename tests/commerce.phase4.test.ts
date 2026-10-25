import { CommunicationMode, PaymentProvider } from "@prisma/client";
import Stripe from "stripe";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { seedAvailabilitySlotsForPsychologist } from "../src/modules/bookings/availabilityService";
import { ensureActiveSubscriptionForUser } from "../src/modules/bookings/bookingService";
import {
  clearTestPaymentProviderAdapters,
  setTestPaymentProviderAdapter,
} from "../src/modules/payments/providers";
import { PaymentProviderAdapter } from "../src/modules/payments/providers/payment-provider.interface";
import { SESSION_PRICE_TEST, seedLivePsychologist } from "./commerce.helpers";
import { resetAuthTables, registerPayload } from "./helpers";
import { resetStaffTables } from "./staff.helpers";

const app = createApp();
const STRIPE_WEBHOOK_SECRET = "whsec_test_webhook_secret_for_vitest_only";

const mockRazorpayAdapter: PaymentProviderAdapter = {
  provider: PaymentProvider.RAZORPAY,
  async createCheckoutSession(input) {
    return {
      provider: PaymentProvider.RAZORPAY,
      providerReferenceId: "mock_booking_order",
      client: { keyId: "mock_key", orderId: "mock_booking_order", amount: input.amountMinorUnits, currency: "INR" },
    };
  },
};

const registerUser = async () => {
  const res = await request(app)
    .post("/api/auth/register")
    .set("X-Client-Platform", "ios")
    .send(registerPayload());
  expect(res.status).toBe(201);
  return { token: res.body.data.tokens.accessToken as string, userId: res.body.data.user.id as string };
};

describe("Chunk 3 Phase 4 — booking with seeded availability", () => {
  beforeEach(async () => {
    await resetAuthTables();
    await resetStaffTables();
    process.env.BOOKING_SESSION_PRICE_MINOR_UNITS = String(SESSION_PRICE_TEST);
    process.env.PAYMENT_DEV_COUNTRY = "IN";
    setTestPaymentProviderAdapter(PaymentProvider.RAZORPAY, mockRazorpayAdapter);
  });

  afterEach(() => {
    clearTestPaymentProviderAdapters();
    process.env.STRIPE_WEBHOOK_SECRET = "";
    process.env.STRIPE_SECRET_KEY = "";
  });

  it("creates PENDING_PAYMENT booking with separate session fee", async () => {
    const psych = await seedLivePsychologist();
    await seedAvailabilitySlotsForPsychologist({ psychologistProfileId: psych.id, daysAhead: 3, slotsPerDay: 2 });
    const { token, userId } = await registerUser();
    await ensureActiveSubscriptionForUser(userId);

    const from = new Date().toISOString();
    const to = new Date(Date.now() + 7 * 86400000).toISOString();
    const avail = await request(app)
      .get(`/api/psychologists/${psych.id}/availability`)
      .query({ from, to })
      .set("Authorization", `Bearer ${token}`);
    const slotId = avail.body.data.items[0].id as string;

    const book = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych.id, slotId, communicationMode: CommunicationMode.VIDEO });
    expect(book.status).toBe(201);
    expect(book.body.data.booking.status).toBe("PENDING_PAYMENT");
    expect(book.body.data.booking.requiresPayment).toBe(true);

    const session = await prisma.psychologistSession.findUnique({ where: { bookingId: book.body.data.booking.id } });
    expect(session).toBeNull();
  });

  it("returns 403 without ACTIVE subscription entitlement", async () => {
    const psych = await seedLivePsychologist();
    await seedAvailabilitySlotsForPsychologist({ psychologistProfileId: psych.id, daysAhead: 2, slotsPerDay: 1 });
    const { token } = await registerUser();
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 7 * 86400000).toISOString();
    const avail = await request(app)
      .get(`/api/psychologists/${psych.id}/availability`)
      .query({ from, to })
      .set("Authorization", `Bearer ${token}`);
    const slotId = avail.body.data.items[0].id as string;
    const book = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych.id, slotId, communicationMode: CommunicationMode.CHAT });
    expect(book.status).toBe(403);
  });

  it("confirms booking via webhook after session checkout", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_phase4";
    const psych = await seedLivePsychologist();
    await seedAvailabilitySlotsForPsychologist({ psychologistProfileId: psych.id, daysAhead: 2, slotsPerDay: 1 });
    const { token, userId } = await registerUser();
    await ensureActiveSubscriptionForUser(userId);

    const from = new Date().toISOString();
    const to = new Date(Date.now() + 7 * 86400000).toISOString();
    const avail = await request(app)
      .get(`/api/psychologists/${psych.id}/availability`)
      .query({ from, to })
      .set("Authorization", `Bearer ${token}`);
    const slotId = avail.body.data.items[0].id as string;

    const book = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych.id, slotId, communicationMode: CommunicationMode.VIDEO });
    const bookingId = book.body.data.booking.id as string;

    const checkout = await request(app)
      .post(`/api/bookings/${bookingId}/checkout`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "booking-paid-1");
    expect(checkout.status).toBe(201);
    expect(checkout.body.data.order.amountMinorUnits).toBe(SESSION_PRICE_TEST);

    const payment = await prisma.payment.findFirst({ where: { orderId: checkout.body.data.order.id } });
    const event = {
      id: "evt_phase4_booking",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: payment!.providerPaymentId ?? "pi_booking",
          status: "succeeded",
          metadata: { paymentId: payment!.id, orderId: checkout.body.data.order.id },
        },
      },
    };
    const payload = JSON.stringify(event);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_WEBHOOK_SECRET });
    await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", header)
      .send(payload);

    const confirmed = await prisma.psychologistBooking.findUnique({ where: { id: bookingId } });
    expect(confirmed?.status).toBe("CONFIRMED");
  });
});
