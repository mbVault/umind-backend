import {
  AdminRoleCode,
  CommunicationMode,
  ComplaintDecision,
  PayoutStatus,
} from "@prisma/client";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { ensureActiveSubscriptionForUser } from "../src/modules/bookings/bookingService";
import {
  confirmBookingWithSucceededPayment,
  createFutureSlot,
  seedLivePsychologist,
} from "./commerce.helpers";
import { resetAuthTables, registerPayload } from "./helpers";
import { createStaffAccount, resetStaffTables, seedRbacCatalog, staffAuthHeader } from "./staff.helpers";

const app = createApp();
const PAYOUT_GROSS = 100000;

describe("Chunk 3 Phase 6 — complaints, refunds, payouts", () => {
  beforeEach(async () => {
    await resetAuthTables();
    await resetStaffTables();
    await seedRbacCatalog();
    process.env.BOOKING_SESSION_PRICE_MINOR_UNITS = String(PAYOUT_GROSS);
    process.env.PAYOUT_PSYCHOLOGIST_SHARE_PERCENT = "60";
  });

  const register = async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .set("X-Client-Platform", "ios")
      .send(registerPayload());
    return { token: res.body.data.tokens.accessToken as string, userId: res.body.data.user.id as string };
  };

  it("creates provisional 60/40 payout after paid session completion", async () => {
    const psych = await seedLivePsychologist();
    const slot = await createFutureSlot(psych.id, 40);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);

    const book = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych.id, slotId: slot.id, communicationMode: CommunicationMode.VIDEO });
    const bookingId = book.body.data.booking.id as string;
    await confirmBookingWithSucceededPayment({ userId, bookingId, amountMinorUnits: PAYOUT_GROSS });

    const session = await prisma.psychologistSession.findUniqueOrThrow({ where: { bookingId } });
    const complete = await request(app)
      .post(`/api/sessions/${session.id}/complete`)
      .set("Authorization", `Bearer ${token}`);
    expect(complete.status).toBe(200);

    const payout = await prisma.psychologistPayout.findUnique({ where: { sessionId: session.id } });
    expect(payout?.grossAmountMinorUnits).toBe(PAYOUT_GROSS);
    expect(payout?.psychologistShareMinorUnits).toBe(60000);
    expect(payout?.platformShareMinorUnits).toBe(40000);
    expect(payout?.status).toBe(PayoutStatus.PENDING);
  });

  it("files complaint and staff resolves with full refund record", async () => {
    const psych = await seedLivePsychologist();
    const slot = await createFutureSlot(psych.id, 50);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);

    const book = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych.id, slotId: slot.id, communicationMode: CommunicationMode.CHAT });
    const bookingId = book.body.data.booking.id as string;
    await confirmBookingWithSucceededPayment({ userId, bookingId, amountMinorUnits: PAYOUT_GROSS });

    const session = await prisma.psychologistSession.findUniqueOrThrow({ where: { bookingId } });
    const payment = await prisma.payment.findFirstOrThrow({
      where: { order: { bookingId } },
    });

    const filed = await request(app)
      .post(`/api/sessions/${session.id}/complaints`)
      .set("Authorization", `Bearer ${token}`)
      .send({ category: "UNRESPONSIVE", description: "Psychologist did not respond during the session window" });
    expect(filed.status).toBe(201);

    await createStaffAccount({
      superTokensUserId: "st-safety-phase6",
      roles: ["ADMIN"],
      adminRoles: [AdminRoleCode.SAFETY_LEAD],
    });

    const resolved = await request(app)
      .post(`/api/v1/staff/admin/complaints/${filed.body.data.id}/resolve`)
      .set(staffAuthHeader("st-safety-phase6"))
      .send({ decision: ComplaintDecision.FULL_REFUND, rationale: "Verified service failure" });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.paymentRefundId).toBeTruthy();

    const refund = await prisma.paymentRefund.findFirst({ where: { paymentId: payment.id } });
    expect(refund?.amountMinorUnits).toBe(PAYOUT_GROSS);
    expect(refund?.reason).toBe("COMPLAINT_FULL");
  });
});
