import { BookingStatus, CommunicationMode, PaymentProvider, RefundReason } from "@prisma/client";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { ensureActiveSubscriptionForUser } from "../src/modules/bookings/bookingService";
import { clearTestPaymentProviderAdapters, setTestPaymentProviderAdapter } from "../src/modules/payments/providers";
import { PaymentProviderAdapter } from "../src/modules/payments/providers/payment-provider.interface";
import {
  SESSION_PRICE_TEST,
  confirmBookingWithSucceededPayment,
  createFutureSlot,
  seedLivePsychologist,
} from "./commerce.helpers";
import { resetAuthTables, registerPayload } from "./helpers";
import { resetStaffTables } from "./staff.helpers";

const app = createApp();

const mockAdapter: PaymentProviderAdapter = {
  provider: PaymentProvider.RAZORPAY,
  async createCheckoutSession(input) {
    return {
      provider: PaymentProvider.RAZORPAY,
      providerReferenceId: "mock",
      client: { orderId: "mock", amount: input.amountMinorUnits, currency: "INR" },
    };
  },
};

describe("Chunk 3 Phase 4b — cancel & reschedule policy", () => {
  beforeEach(async () => {
    await resetAuthTables();
    await resetStaffTables();
    process.env.BOOKING_SESSION_PRICE_MINOR_UNITS = String(SESSION_PRICE_TEST);
    process.env.PAYMENT_DEV_COUNTRY = "IN";
    setTestPaymentProviderAdapter(PaymentProvider.RAZORPAY, mockAdapter);
  });

  afterEach(() => {
    clearTestPaymentProviderAdapters();
  });

  const register = async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .set("X-Client-Platform", "ios")
      .send(registerPayload());
    expect(res.status).toBe(201);
    return { token: res.body.data.tokens.accessToken as string, userId: res.body.data.user.id as string };
  };

  it("within 24h of booking creation: cancel refunds 100% of session payment", async () => {
    const psych = await seedLivePsychologist();
    const slot = await createFutureSlot(psych.id, 48);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);

    const book = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych.id, slotId: slot.id, communicationMode: CommunicationMode.VIDEO });
    const bookingId = book.body.data.booking.id as string;
    await confirmBookingWithSucceededPayment({ userId, bookingId });

    const cancel = await request(app)
      .post(`/api/bookings/${bookingId}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.refund.refundPercent).toBe(100);
    expect(cancel.body.data.refund.amountMinorUnits).toBe(SESSION_PRICE_TEST);
  });

  it("after 24h from booking creation: cancel refunds 50% (late cancellation)", async () => {
    const psych = await seedLivePsychologist();
    const slot = await createFutureSlot(psych.id, 48);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);

    const book = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych.id, slotId: slot.id, communicationMode: CommunicationMode.VIDEO });
    const bookingId = book.body.data.booking.id as string;
    await confirmBookingWithSucceededPayment({ userId, bookingId });
    await prisma.psychologistBooking.update({
      where: { id: bookingId },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    const cancel = await request(app)
      .post(`/api/bookings/${bookingId}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.refund.refundPercent).toBe(50);
    expect(cancel.body.data.refund.amountMinorUnits).toBe(Math.floor(SESSION_PRICE_TEST / 2));

    const refund = await prisma.paymentRefund.findFirst({ where: { reason: RefundReason.CUSTOMER_LATE_CANCEL } });
    expect(refund?.amountMinorUnits).toBe(Math.floor(SESSION_PRICE_TEST / 2));
  });

  it("blocks customer reschedule inside initial 24h window", async () => {
    const psych = await seedLivePsychologist();
    const slot1 = await createFutureSlot(psych.id, 72);
    const slot2 = await createFutureSlot(psych.id, 96);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);

    const book = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych.id, slotId: slot1.id, communicationMode: CommunicationMode.CHAT });
    const bookingId = book.body.data.booking.id as string;
    await confirmBookingWithSucceededPayment({ userId, bookingId });

    const blocked = await request(app)
      .post(`/api/bookings/${bookingId}/reschedule`)
      .set("Authorization", `Bearer ${token}`)
      .send({ slotId: slot2.id });
    expect(blocked.status).toBe(409);
  });

  it("allows reschedule after 24h up to customer limit", async () => {
    const psych = await seedLivePsychologist();
    const slot1 = await createFutureSlot(psych.id, 72);
    const slot2 = await createFutureSlot(psych.id, 96);
    const slot3 = await createFutureSlot(psych.id, 120);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);

    const book = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych.id, slotId: slot1.id, communicationMode: CommunicationMode.CHAT });
    const bookingId = book.body.data.booking.id as string;
    await confirmBookingWithSucceededPayment({ userId, bookingId });
    await prisma.psychologistBooking.update({
      where: { id: bookingId },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    expect(
      (
        await request(app)
          .post(`/api/bookings/${bookingId}/reschedule`)
          .set("Authorization", `Bearer ${token}`)
          .send({ slotId: slot2.id })
      ).status,
    ).toBe(200);

    expect(
      (
        await request(app)
          .post(`/api/bookings/${bookingId}/reschedule`)
          .set("Authorization", `Bearer ${token}`)
          .send({ slotId: slot3.id })
      ).status,
    ).toBe(200);

    const third = await request(app)
      .post(`/api/bookings/${bookingId}/reschedule`)
      .set("Authorization", `Bearer ${token}`)
      .send({ slotId: slot2.id });
    expect(third.status).toBe(409);

    const row = await prisma.psychologistBooking.findUnique({ where: { id: bookingId } });
    expect(row?.customerRescheduleCount).toBe(2);
    expect(row?.status).toBe(BookingStatus.CONFIRMED);
  });
});
