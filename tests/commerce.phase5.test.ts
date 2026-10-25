import {
  AttendanceEventType,
  BookingStatus,
  CommunicationMode,
  SessionStatus,
} from "@prisma/client";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { ensureActiveSubscriptionForUser } from "../src/modules/bookings/bookingService";
import {
  SESSION_PRICE_TEST,
  confirmBookingWithSucceededPayment,
  createFutureSlot,
  seedLivePsychologist,
} from "./commerce.helpers";
import { resetAuthTables, registerPayload } from "./helpers";
import { resetStaffTables } from "./staff.helpers";

const app = createApp();

describe("Chunk 3 Phase 5 — sessions & attendance", () => {
  beforeEach(async () => {
    await resetAuthTables();
    await resetStaffTables();
    process.env.BOOKING_SESSION_PRICE_MINOR_UNITS = String(SESSION_PRICE_TEST);
  });

  afterEach(() => {
    process.env.SESSION_PSYCH_NO_SHOW_GRACE_MINUTES = "2";
  });

  const register = async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .set("X-Client-Platform", "ios")
      .send(registerPayload());
    return { token: res.body.data.tokens.accessToken as string, userId: res.body.data.user.id as string };
  };

  it("records customer join and completes session", async () => {
    const psych = await seedLivePsychologist();
    const slot = await createFutureSlot(psych.id, 24);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);

    const book = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych.id, slotId: slot.id, communicationMode: CommunicationMode.VIDEO });
    const bookingId = book.body.data.booking.id as string;
    await confirmBookingWithSucceededPayment({ userId, bookingId });

    const session = await prisma.psychologistSession.findUniqueOrThrow({ where: { bookingId } });

    const join = await request(app)
      .post(`/api/sessions/${session.id}/attendance`)
      .set("Authorization", `Bearer ${token}`)
      .send({ eventType: AttendanceEventType.JOINED });
    expect(join.status).toBe(200);

    const complete = await request(app)
      .post(`/api/sessions/${session.id}/complete`)
      .set("Authorization", `Bearer ${token}`);
    expect(complete.status).toBe(200);

    const updated = await prisma.psychologistSession.findUnique({ where: { id: session.id } });
    expect(updated?.status).toBe(SessionStatus.COMPLETED);
  });

  it("marks psychologist no-show after grace when psych never joined", async () => {
    const psych = await seedLivePsychologist();
    const slot = await createFutureSlot(psych.id, 24);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);

    const book = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych.id, slotId: slot.id, communicationMode: CommunicationMode.VOICE });
    const bookingId = book.body.data.booking.id as string;
    await confirmBookingWithSucceededPayment({ userId, bookingId });

    const startsAt = new Date(Date.now() - 5 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 40 * 60 * 1000);
    await prisma.psychologistBooking.update({
      where: { id: bookingId },
      data: { scheduledStartAt: startsAt, scheduledEndAt: endsAt, status: BookingStatus.CONFIRMED },
    });
    const session = await prisma.psychologistSession.findUniqueOrThrow({ where: { bookingId } });

    const evalRes = await request(app)
      .post(`/api/sessions/${session.id}/evaluate-psychologist-no-show`)
      .set("Authorization", `Bearer ${token}`);
    expect(evalRes.status).toBe(200);
    expect(evalRes.body.data.markedNoShow).toBe(true);

    const booking = await prisma.psychologistBooking.findUnique({ where: { id: bookingId } });
    expect(booking?.status).toBe(BookingStatus.NO_SHOW);
  });

  it("stores customer recording consent", async () => {
    const psych = await seedLivePsychologist();
    const slot = await createFutureSlot(psych.id, 30);
    const { token, userId } = await register();
    await ensureActiveSubscriptionForUser(userId);

    const book = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych.id, slotId: slot.id, communicationMode: CommunicationMode.VIDEO });
    const bookingId = book.body.data.booking.id as string;
    await confirmBookingWithSucceededPayment({ userId, bookingId });

    const session = await prisma.psychologistSession.findUniqueOrThrow({ where: { bookingId } });

    const res = await request(app)
      .post(`/api/sessions/${session.id}/recording-consent`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    const consent = await prisma.sessionRecordingConsent.findUnique({
      where: { sessionId_participantRole: { sessionId: session.id, participantRole: "CUSTOMER" } },
    });
    expect(consent?.userId).toBe(userId);
  });
});
