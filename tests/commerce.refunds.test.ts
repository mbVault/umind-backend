import {
  AdminRoleCode,
  BookingStatus,
  CommunicationMode,
  ComplaintDecision,
  ComplaintStatus,
  OrderPurpose,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  RefundReason,
  RefundStatus,
} from "@prisma/client";
import Stripe from "stripe";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { cancelBookingByCustomer } from "../src/modules/bookings/bookingLifecycleService";
import { ensureActiveSubscriptionForUser } from "../src/modules/bookings/bookingService";
import { cancelBookingByPsychologist } from "../src/modules/bookings/psychologistFaultResolutionService";
import {
  clearTestPaymentProviderAdapters,
  setTestPaymentProviderAdapter,
} from "../src/modules/payments/providers";
import { PaymentProviderAdapter } from "../src/modules/payments/providers/payment-provider.interface";
import { processStripeWebhook } from "../src/modules/payments/webhookProcessor";
import { reservePendingRefund } from "../src/modules/payments/refundService";
import { resolveSessionComplaint } from "../src/modules/sessions/complaintService";
import {
  SESSION_PRICE_TEST,
  confirmBookingWithSucceededPayment,
  createFutureSlot,
  seedLivePsychologist,
} from "./commerce.helpers";
import { resetAuthTables, registerPayload } from "./helpers";
import { createStaffAccount, resetStaffTables, seedRbacCatalog, staffAuthHeader } from "./staff.helpers";

const app = createApp();
const STRIPE_WEBHOOK_SECRET = "whsec_refund_policy_test_secret";

const mockAdapter: PaymentProviderAdapter = {
  provider: PaymentProvider.RAZORPAY,
  async createCheckoutSession(input) {
    return {
      provider: PaymentProvider.RAZORPAY,
      providerReferenceId: "mock_refund",
      client: { orderId: "mock_refund", amount: input.amountMinorUnits, currency: "INR" },
    };
  },
};

describe("Refund policy — business logic", () => {
  beforeEach(async () => {
    await resetAuthTables();
    await resetStaffTables();
    await seedRbacCatalog();
    process.env.BOOKING_SESSION_PRICE_MINOR_UNITS = String(SESSION_PRICE_TEST);
    process.env.PAYMENT_DEV_COUNTRY = "IN";
    setTestPaymentProviderAdapter(PaymentProvider.RAZORPAY, mockAdapter);
  });

  afterEach(() => {
    clearTestPaymentProviderAdapters();
    process.env.STRIPE_WEBHOOK_SECRET = "";
    process.env.STRIPE_SECRET_KEY = "";
  });

  const register = async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .set("X-Client-Platform", "ios")
      .send(registerPayload());
    expect(res.status).toBe(201);
    return { token: res.body.data.tokens.accessToken as string, userId: res.body.data.user.id as string };
  };

  const bookConfirmed = async (token: string, userId: string, psychId: string, slotId: string) => {
    const book = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psychId, slotId, communicationMode: CommunicationMode.VIDEO });
    const bookingId = book.body.data.booking.id as string;
    await confirmBookingWithSucceededPayment({ userId, bookingId });
    return bookingId;
  };

  it("1–2: cancellation within 24h → 100%, after 24h → 50%", async () => {
    const psych = await seedLivePsychologist();
    const slot = await createFutureSlot(psych.id, 48);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);

    const earlyId = await bookConfirmed(token, userId, psych.id, slot.id);
    const earlyCancel = await request(app)
      .post(`/api/bookings/${earlyId}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(earlyCancel.body.data.refund.refundPercent).toBe(100);
    expect(earlyCancel.body.data.refund.amountMinorUnits).toBe(SESSION_PRICE_TEST);

    const slot2 = await createFutureSlot(psych.id, 72);
    const lateId = await bookConfirmed(token, userId, psych.id, slot2.id);
    await prisma.psychologistBooking.update({
      where: { id: lateId },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    const lateCancel = await request(app)
      .post(`/api/bookings/${lateId}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(lateCancel.body.data.refund.refundPercent).toBe(50);
    expect(lateCancel.body.data.refund.amountMinorUnits).toBe(Math.floor(SESSION_PRICE_TEST / 2));
  });

  it("3: cancellation window uses booking.createdAt, not session start proximity", async () => {
    const psych = await seedLivePsychologist();
    const slotSoon = await createFutureSlot(psych.id, 2);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);
    const bookingId = await bookConfirmed(token, userId, psych.id, slotSoon.id);
    await prisma.psychologistBooking.update({
      where: { id: bookingId },
      data: { createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000) },
    });

    const cancel = await request(app)
      .post(`/api/bookings/${bookingId}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(cancel.body.data.refund.refundPercent).toBe(50);
  });

  it("4: unpaid PENDING_PAYMENT cancel → ₹0 refund", async () => {
    const psych = await seedLivePsychologist();
    const slot = await createFutureSlot(psych.id, 40);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);
    const book = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych.id, slotId: slot.id, communicationMode: CommunicationMode.CHAT });
    const bookingId = book.body.data.booking.id as string;
    expect(book.body.data.booking.status).toBe(BookingStatus.PENDING_PAYMENT);

    const cancel = await cancelBookingByCustomer({ userId, bookingId });
    expect(cancel.refund).toBeNull();
    const refunds = await prisma.paymentRefund.count();
    expect(refunds).toBe(0);
  });

  it("5: delayed succeeded payment is reconciled before cancellation refund", async () => {
    const psych = await seedLivePsychologist();
    const slot = await createFutureSlot(psych.id, 40);
    const { userId } = await register();
    await ensureActiveSubscriptionForUser(userId);

    const booking = await prisma.psychologistBooking.create({
      data: {
        userId,
        psychologistProfileId: psych.id,
        scheduledStartAt: slot.startsAt,
        scheduledEndAt: slot.endsAt,
        communicationMode: CommunicationMode.VIDEO,
        status: BookingStatus.PENDING_PAYMENT,
        policyVersion: "test",
        policySnapshot: {},
      },
    });
    const order = await prisma.order.create({
      data: {
        userId,
        purpose: OrderPurpose.PSYCHOLOGIST_BOOKING,
        bookingId: booking.id,
        amountMinorUnits: SESSION_PRICE_TEST,
        currency: "INR",
        provider: PaymentProvider.RAZORPAY,
        status: OrderStatus.PENDING,
      },
    });
    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: PaymentProvider.RAZORPAY,
        amountMinorUnits: SESSION_PRICE_TEST,
        currency: "INR",
        status: PaymentStatus.SUCCEEDED,
        paidAt: new Date(),
        providerPaymentId: "pay_delayed_webhook",
      },
    });

    const result = await cancelBookingByCustomer({ userId, bookingId: booking.id });
    expect(result.refund?.refundPercent).toBe(100);
    expect(result.refund?.amountMinorUnits).toBe(SESSION_PRICE_TEST);

    const refreshed = await prisma.psychologistBooking.findUnique({ where: { id: booking.id } });
    expect(refreshed?.status).toBe(BookingStatus.CANCELLED);
  });

  it("6: support FULL_REFUND after prior partial respects remaining balance", async () => {
    const psych = await seedLivePsychologist();
    const slot = await createFutureSlot(psych.id, 40);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);
    const bookingId = await bookConfirmed(token, userId, psych.id, slot.id);
    const session = await prisma.psychologistSession.findUniqueOrThrow({ where: { bookingId } });
    const payment = await prisma.payment.findFirstOrThrow({ where: { order: { bookingId } } });

    const safety = await createStaffAccount({
      superTokensUserId: "st-refund-partial",
      roles: ["ADMIN"],
      adminRoles: [AdminRoleCode.SAFETY_LEAD],
    });
    void safety;

    const c1 = await request(app)
      .post(`/api/sessions/${session.id}/complaints`)
      .set("Authorization", `Bearer ${token}`)
      .send({ category: "UNRESPONSIVE", description: "Psychologist was silent for most of the session" });
    await request(app)
      .post(`/api/v1/staff/admin/complaints/${c1.body.data.id}/resolve`)
      .set(staffAuthHeader("st-refund-partial"))
      .send({ decision: ComplaintDecision.PARTIAL_REFUND, partialRefundPercent: 40, rationale: "Partial service failure" });

    const partial = await prisma.paymentRefund.findFirst({ where: { paymentId: payment.id } });
    expect(partial?.amountMinorUnits).toBe(Math.floor(SESSION_PRICE_TEST * 0.4));

    const c2 = await request(app)
      .post(`/api/sessions/${session.id}/complaints`)
      .set("Authorization", `Bearer ${token}`)
      .send({ category: "DISRUPTED", description: "Session ended abruptly without explanation" });
    await request(app)
      .post(`/api/v1/staff/admin/complaints/${c2.body.data.id}/resolve`)
      .set(staffAuthHeader("st-refund-partial"))
      .send({ decision: ComplaintDecision.FULL_REFUND, rationale: "Remaining balance refund" });

    const refunds = await prisma.paymentRefund.findMany({ where: { paymentId: payment.id } });
    const total = refunds.reduce((s, r) => s + r.amountMinorUnits, 0);
    expect(total).toBe(SESSION_PRICE_TEST);
    const fullRefund = refunds.find((r) => r.reason === RefundReason.COMPLAINT_FULL);
    expect(fullRefund?.amountMinorUnits).toBe(SESSION_PRICE_TEST - (partial?.amountMinorUnits ?? 0));
  });

  it("7: mixed refund reasons cannot exceed original payment", async () => {
    const psych = await seedLivePsychologist();
    const slot = await createFutureSlot(psych.id, 40);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);
    const bookingId = await bookConfirmed(token, userId, psych.id, slot.id);
    const payment = await prisma.payment.findFirstOrThrow({ where: { order: { bookingId } } });

    await reservePendingRefund({
      paymentId: payment.id,
      reason: RefundReason.CUSTOMER_LATE_CANCEL,
      refundPercentOfPayment: 50,
      idempotencyKey: "mix:late_cancel",
    });

    const session = await prisma.psychologistSession.findUniqueOrThrow({ where: { bookingId } });
    const complaint = await prisma.sessionComplaint.create({
      data: {
        sessionId: session.id,
        userId,
        category: "OTHER",
        description: "Quality issue after partial cancel refund",
        status: ComplaintStatus.OPEN,
      },
    });
    await createStaffAccount({
      superTokensUserId: "st-mix-refund",
      roles: ["ADMIN"],
      adminRoles: [AdminRoleCode.SAFETY_LEAD],
    });
    const reviewer = await prisma.account.findFirst({ where: { superTokensUserId: "st-mix-refund" } });
    await resolveSessionComplaint({
      reviewerAccountId: reviewer!.id,
      complaintId: complaint.id,
      decision: ComplaintDecision.FULL_REFUND,
      rationale: "Top up remaining",
    });

    const total = (await prisma.paymentRefund.findMany({ where: { paymentId: payment.id } })).reduce(
      (s, r) => s + r.amountMinorUnits,
      0,
    );
    expect(total).toBe(SESSION_PRICE_TEST);
  });

  it("8: concurrent refund requests cannot over-refund", async () => {
    const psych = await seedLivePsychologist();
    const slot = await createFutureSlot(psych.id, 40);
    const { userId } = await register();
    await ensureActiveSubscriptionForUser(userId);
    const booking = await prisma.psychologistBooking.create({
      data: {
        userId,
        psychologistProfileId: psych.id,
        scheduledStartAt: slot.startsAt,
        scheduledEndAt: slot.endsAt,
        communicationMode: CommunicationMode.VIDEO,
        status: BookingStatus.CONFIRMED,
        policyVersion: "t",
        policySnapshot: {},
      },
    });
    const order = await prisma.order.create({
      data: {
        userId,
        purpose: OrderPurpose.PSYCHOLOGIST_BOOKING,
        bookingId: booking.id,
        amountMinorUnits: SESSION_PRICE_TEST,
        currency: "INR",
        provider: PaymentProvider.RAZORPAY,
        status: OrderStatus.COMPLETED,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: PaymentProvider.RAZORPAY,
        amountMinorUnits: SESSION_PRICE_TEST,
        currency: "INR",
        status: PaymentStatus.SUCCEEDED,
        paidAt: new Date(),
      },
    });

    const results = await Promise.all([
      reservePendingRefund({
        paymentId: payment.id,
        reason: RefundReason.ADMIN_ADJUSTMENT,
        refundPercentOfPayment: 100,
        idempotencyKey: "concurrent:a",
      }),
      reservePendingRefund({
        paymentId: payment.id,
        reason: RefundReason.OTHER,
        refundPercentOfPayment: 100,
        idempotencyKey: "concurrent:b",
      }),
    ]);

    const amounts = results.filter(Boolean).map((r) => r!.amountMinorUnits);
    expect(amounts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(SESSION_PRICE_TEST);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(SESSION_PRICE_TEST);
  });

  it("9: duplicate refund requests with same idempotency key are idempotent", async () => {
    const psych = await seedLivePsychologist();
    const slot = await createFutureSlot(psych.id, 40);
    const { userId } = await register();
    await ensureActiveSubscriptionForUser(userId);
    const booking = await prisma.psychologistBooking.create({
      data: {
        userId,
        psychologistProfileId: psych.id,
        scheduledStartAt: slot.startsAt,
        scheduledEndAt: slot.endsAt,
        communicationMode: CommunicationMode.VIDEO,
        status: BookingStatus.CONFIRMED,
        policyVersion: "t",
        policySnapshot: {},
      },
    });
    const order = await prisma.order.create({
      data: {
        userId,
        purpose: OrderPurpose.PSYCHOLOGIST_BOOKING,
        bookingId: booking.id,
        amountMinorUnits: SESSION_PRICE_TEST,
        currency: "INR",
        provider: PaymentProvider.RAZORPAY,
        status: OrderStatus.COMPLETED,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: PaymentProvider.RAZORPAY,
        amountMinorUnits: SESSION_PRICE_TEST,
        currency: "INR",
        status: PaymentStatus.SUCCEEDED,
        paidAt: new Date(),
      },
    });

    const first = await reservePendingRefund({
      paymentId: payment.id,
      reason: RefundReason.CUSTOMER_CANCEL,
      refundPercentOfPayment: 100,
      idempotencyKey: "dup:customer_cancel:1",
    });
    const second = await reservePendingRefund({
      paymentId: payment.id,
      reason: RefundReason.CUSTOMER_CANCEL,
      refundPercentOfPayment: 100,
      idempotencyKey: "dup:customer_cancel:1",
    });
    expect(second?.id).toBe(first?.id);
    expect(await prisma.paymentRefund.count({ where: { paymentId: payment.id } })).toBe(1);
  });

  it("10: NO_REFUND complaint creates no monetary refund", async () => {
    const psych = await seedLivePsychologist();
    const slot = await createFutureSlot(psych.id, 40);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);
    const bookingId = await bookConfirmed(token, userId, psych.id, slot.id);
    const session = await prisma.psychologistSession.findUniqueOrThrow({ where: { bookingId } });

    await createStaffAccount({
      superTokensUserId: "st-no-refund",
      roles: ["ADMIN"],
      adminRoles: [AdminRoleCode.SAFETY_LEAD],
    });

    const filed = await request(app)
      .post(`/api/sessions/${session.id}/complaints`)
      .set("Authorization", `Bearer ${token}`)
      .send({ category: "OTHER", description: "Minor inconvenience only, no refund warranted" });
    const resolved = await request(app)
      .post(`/api/v1/staff/admin/complaints/${filed.body.data.id}/resolve`)
      .set(staffAuthHeader("st-no-refund"))
      .send({ decision: ComplaintDecision.NO_REFUND, rationale: "Insufficient evidence" });
    expect(resolved.body.data.paymentRefundId).toBeNull();
    expect(await prisma.paymentRefund.count()).toBe(0);
  });

  it("11: FREE_RESCHEDULE stays open until replacement slot is secured", async () => {
    const psych = await seedLivePsychologist();
    const psych2 = await seedLivePsychologist("Dr Two");
    const slot = await createFutureSlot(psych.id, 40);
    const replacementSlot = await createFutureSlot(psych2.id, 50);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);
    const bookingId = await bookConfirmed(token, userId, psych.id, slot.id);
    const session = await prisma.psychologistSession.findUniqueOrThrow({ where: { bookingId } });

    await createStaffAccount({
      superTokensUserId: "st-free-resched",
      roles: ["ADMIN"],
      adminRoles: [AdminRoleCode.SAFETY_LEAD],
    });

    const filed = await request(app)
      .post(`/api/sessions/${session.id}/complaints`)
      .set("Authorization", `Bearer ${token}`)
      .send({ category: "NOT_DELIVERED", description: "Session was not delivered as booked" });
    const pending = await request(app)
      .post(`/api/v1/staff/admin/complaints/${filed.body.data.id}/resolve`)
      .set(staffAuthHeader("st-free-resched"))
      .send({ decision: ComplaintDecision.FREE_RESCHEDULE, rationale: "Offer replacement session" });
    expect(pending.body.data.status).toBe(ComplaintStatus.UNDER_REVIEW);
    expect(pending.body.data.replacementBookingId).toBeNull();

    const secured = await request(app)
      .post(`/api/complaints/${filed.body.data.id}/secure-free-reschedule`)
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych2.id, slotId: replacementSlot.id });
    expect(secured.status).toBe(200);
    expect(secured.body.data.replacementBookingId).toBeTruthy();

    const closed = await prisma.sessionComplaint.findUniqueOrThrow({ where: { id: filed.body.data.id } });
    expect(closed.status).toBe(ComplaintStatus.RESOLVED);
    expect(closed.replacementBookingId).toBe(secured.body.data.replacementBookingId);
  });

  it("12: late payment after slot release does not confirm booking; full refund path", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_refunds";

    const psych = await seedLivePsychologist();
    const slot = await createFutureSlot(psych.id, 40);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);

    const book = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych.id, slotId: slot.id, communicationMode: CommunicationMode.VIDEO });
    const bookingId = book.body.data.booking.id as string;

    await prisma.psychologistBooking.update({
      where: { id: bookingId },
      data: { reservationExpiresAt: new Date(Date.now() - 60_000) },
    });

    const order = await prisma.order.create({
      data: {
        userId,
        purpose: OrderPurpose.PSYCHOLOGIST_BOOKING,
        bookingId,
        amountMinorUnits: SESSION_PRICE_TEST,
        currency: "INR",
        provider: PaymentProvider.STRIPE,
        status: OrderStatus.PENDING,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: PaymentProvider.STRIPE,
        amountMinorUnits: SESSION_PRICE_TEST,
        currency: "INR",
        status: PaymentStatus.PENDING,
        providerPaymentId: "pi_late_pay",
      },
    });

    const event = {
      id: "evt_late_pay_refund",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_late_pay",
          status: "succeeded",
          metadata: { paymentId: payment.id, orderId: order.id },
        },
      },
    };
    const payload = JSON.stringify(event);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_WEBHOOK_SECRET });
    await processStripeWebhook(Buffer.from(payload), header);
    await processStripeWebhook(Buffer.from(payload), header);

    const booking = await prisma.psychologistBooking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe(BookingStatus.EXPIRED);

    const refunds = await prisma.paymentRefund.findMany({
      where: { paymentId: payment.id, reason: RefundReason.PAYMENT_AFTER_SLOT_RELEASED },
    });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amountMinorUnits).toBe(SESSION_PRICE_TEST);
    expect(refunds[0].status).toBe(RefundStatus.PENDING);
  });

  it("psychologist no-show: customer may choose full refund or free reschedule", async () => {
    const psych = await seedLivePsychologist();
    const psych2 = await seedLivePsychologist("Alt Psych");
    const slot = await createFutureSlot(psych.id, 24);
    const slotC = await createFutureSlot(psych2.id, 80);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);
    const bookingId = await bookConfirmed(token, userId, psych.id, slot.id);
    const startsAt = new Date(Date.now() - 5 * 60 * 1000);
    await prisma.psychologistBooking.update({
      where: { id: bookingId },
      data: { scheduledStartAt: startsAt, scheduledEndAt: new Date(startsAt.getTime() + 40 * 60 * 1000) },
    });
    const session = await prisma.psychologistSession.findUniqueOrThrow({ where: { bookingId } });

    process.env.SESSION_PSYCH_NO_SHOW_GRACE_MINUTES = "0";
    await request(app)
      .post(`/api/sessions/${session.id}/evaluate-psychologist-no-show`)
      .set("Authorization", `Bearer ${token}`);

    const refundChoice = await request(app)
      .post(`/api/sessions/${session.id}/psychologist-fault-remedy`)
      .set("Authorization", `Bearer ${token}`)
      .send({ remedy: "FULL_REFUND" });
    expect(refundChoice.status).toBe(200);
    expect(refundChoice.body.data.refund.amountMinorUnits).toBe(SESSION_PRICE_TEST);

    const psychB = await seedLivePsychologist("NoShow B");
    const slotB = await createFutureSlot(psychB.id, 30);
    const res2 = await request(app)
      .post("/api/auth/register")
      .set("X-Client-Platform", "ios")
      .send(
        registerPayload({
          alias: "SecondUser",
          deviceId: "550e8400-e29b-41d4-a716-446655440099",
          recoveryKey: "second user recovery key phrase alpha beta gamma delta epsilon zeta eta",
        }),
      );
    expect(res2.status).toBe(201);
    const token2 = res2.body.data.tokens.accessToken as string;
    const userId2 = res2.body.data.user.id as string;
    await ensureActiveSubscriptionForUser(userId2);
    const bookingId2 = await bookConfirmed(token2, userId2, psychB.id, slotB.id);
    const startsAt2 = new Date(Date.now() - 5 * 60 * 1000);
    await prisma.psychologistBooking.update({
      where: { id: bookingId2 },
      data: { scheduledStartAt: startsAt2, scheduledEndAt: new Date(startsAt2.getTime() + 40 * 60 * 1000) },
    });
    const session2 = await prisma.psychologistSession.findUniqueOrThrow({ where: { bookingId: bookingId2 } });
    await request(app)
      .post(`/api/sessions/${session2.id}/evaluate-psychologist-no-show`)
      .set("Authorization", `Bearer ${token2}`);

    const rescheduleChoice = await request(app)
      .post(`/api/sessions/${session2.id}/psychologist-fault-remedy`)
      .set("Authorization", `Bearer ${token2}`)
      .send({
        remedy: "FREE_RESCHEDULE",
        psychologistProfileId: psych2.id,
        slotId: slotC.id,
      });
    expect(rescheduleChoice.status).toBe(200);
    expect(rescheduleChoice.body.data.replacementBookingId).toBeTruthy();
  });

  it("psychologist cancellation enables customer remedy choice (not auto-assigned psych)", async () => {
    const psych = await seedLivePsychologist();
    const psych2 = await seedLivePsychologist("Replacement");
    const slot = await createFutureSlot(psych.id, 40);
    const replSlot = await createFutureSlot(psych2.id, 55);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);
    const bookingId = await bookConfirmed(token, userId, psych.id, slot.id);
    const session = await prisma.psychologistSession.findUniqueOrThrow({ where: { bookingId } });

    await cancelBookingByPsychologist({ bookingId, reason: "Psychologist unavailable" });

    const res = await request(app)
      .post(`/api/sessions/${session.id}/psychologist-fault-remedy`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        remedy: "FREE_RESCHEDULE",
        psychologistProfileId: psych2.id,
        slotId: replSlot.id,
      });
    expect(res.status).toBe(200);
    const replacement = await prisma.psychologistBooking.findUniqueOrThrow({
      where: { id: res.body.data.replacementBookingId },
    });
    expect(replacement.psychologistProfileId).toBe(psych2.id);
    expect(replacement.isFreeProviderReschedule).toBe(true);
  });
});
