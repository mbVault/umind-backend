import {
  BookingStatus,
  CommunicationMode,
  PsychologistPresence,
  StaffRole,
  VerificationCheckStatus,
} from "@prisma/client";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { ensureActiveSubscriptionForUser } from "../src/modules/bookings/bookingService";
import { seedAvailabilitySlotsForPsychologist } from "../src/modules/bookings/availabilityService";
import {
  SESSION_PRICE_TEST,
  confirmBookingWithSucceededPayment,
  createFutureSlot,
  seedLivePsychologist,
} from "./commerce.helpers";
import { resetAuthTables, registerPayload } from "./helpers";
import { createStaffAccount, resetStaffTables, seedRbacCatalog, staffAuthHeader } from "./staff.helpers";

const app = createApp();

const registerClient = async () => {
  const res = await request(app)
    .post("/api/auth/register")
    .set("X-Client-Platform", "ios")
    .send(registerPayload({ alias: "HoursClient" }));
  expect(res.status).toBe(201);
  return {
    token: res.body.data.tokens.accessToken as string,
    userId: res.body.data.user.id as string,
  };
};

describe("Staff psychologist Hours + presence (client-safe)", () => {
  beforeEach(async () => {
    await resetAuthTables();
    await resetStaffTables();
    await seedRbacCatalog();
    process.env.BOOKING_SESSION_PRICE_MINOR_UNITS = String(SESSION_PRICE_TEST);
  });

  afterEach(() => {
    process.env.BOOKING_SESSION_PRICE_MINOR_UNITS = String(SESSION_PRICE_TEST);
  });

  it("PATCH /me/presence AWAY hides psych from client discovery without touching public DTO shape", async () => {
    const psych = await seedLivePsychologist("Dr Presence");
    const account = await prisma.account.findUniqueOrThrow({ where: { id: psych.accountId } });
    // Align SuperTokens test header with account
    await prisma.account.update({
      where: { id: account.id },
      data: { superTokensUserId: "st-hours-presence" },
    });

    const { token } = await registerClient();
    const before = await request(app).get("/api/psychologists").set("Authorization", `Bearer ${token}`);
    expect(before.status).toBe(200);
    expect(before.body.data.total).toBe(1);
    expect(before.body.data.items[0].presence).toBeUndefined();
    expect(before.body.data.items[0].sessionModes).toBeUndefined();
    expect(before.body.data.items[0].weeklyHours).toBeUndefined();

    const away = await request(app)
      .patch("/api/v1/staff/psychologist/me/presence")
      .set(staffAuthHeader("st-hours-presence"))
      .send({ presence: "AWAY" });
    expect(away.status).toBe(200);
    expect(away.body.data.presence).toBe(PsychologistPresence.AWAY);

    const after = await request(app).get("/api/psychologists").set("Authorization", `Bearer ${token}`);
    expect(after.status).toBe(200);
    expect(after.body.data.total).toBe(0);

    const detail = await request(app)
      .get(`/api/psychologists/${psych.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(404);
  });

  it("PATCH /me/hours updates ops fields; GET /me includes them", async () => {
    const psychAccount = await createStaffAccount({
      superTokensUserId: "st-hours-patch",
      roles: [StaffRole.PSYCHOLOGIST],
    });
    await prisma.psychologistProfile.create({
      data: {
        accountId: psychAccount.id,
        displayName: "Hours Doc",
        publicationStatus: "LIVE",
        accountStatus: "ACTIVE",
        publishedAt: new Date(),
        sessionModes: [CommunicationMode.CHAT],
        checks: {
          create: [
            { type: "IDENTITY", status: VerificationCheckStatus.VERIFIED },
            { type: "RCI_REGISTRATION", status: VerificationCheckStatus.VERIFIED },
            { type: "DEGREE", status: VerificationCheckStatus.VERIFIED },
            { type: "YEARS_OF_EXPERIENCE", status: VerificationCheckStatus.VERIFIED },
          ],
        },
      },
    });

    const res = await request(app)
      .patch("/api/v1/staff/psychologist/me/hours")
      .set(staffAuthHeader("st-hours-patch"))
      .send({
        acceptingNewClients: false,
        maxSessionsPerDay: 3,
        sessionModes: ["CHAT", "VOICE"],
        weeklyHours: {
          mon: [{ start: "10:00", end: "14:00" }],
          tue: [],
          wed: [],
          thu: [],
          fri: [{ start: "09:00", end: "12:00" }],
          sat: [],
          sun: [],
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.data.acceptingNewClients).toBe(false);
    expect(res.body.data.maxSessionsPerDay).toBe(3);
    expect(res.body.data.sessionModes).toEqual(["CHAT", "VOICE"]);
    expect(res.body.data.weeklyHours.mon[0].start).toBe("10:00");

    const me = await request(app)
      .get("/api/v1/staff/psychologist/me")
      .set(staffAuthHeader("st-hours-patch"));
    expect(me.status).toBe(200);
    expect(me.body.data.maxSessionsPerDay).toBe(3);
  });

  it("PUT /me/availability never deletes slots under CONFIRMED bookings", async () => {
    const psych = await seedLivePsychologist("Dr Slots");
    await prisma.account.update({
      where: { id: psych.accountId },
      data: { superTokensUserId: "st-hours-slots" },
    });

    const heldSlot = await createFutureSlot(psych.id, 10);
    const openSlot = await createFutureSlot(psych.id, 20);
    const { userId } = await registerClient();

    const booking = await prisma.psychologistBooking.create({
      data: {
        userId,
        psychologistProfileId: psych.id,
        scheduledStartAt: heldSlot.startsAt,
        scheduledEndAt: heldSlot.endsAt,
        communicationMode: CommunicationMode.VIDEO,
        status: BookingStatus.PENDING_PAYMENT,
        policyVersion: "v1",
      },
    });
    await confirmBookingWithSucceededPayment({ userId, bookingId: booking.id });

    const put = await request(app)
      .put("/api/v1/staff/psychologist/me/availability")
      .set(staffAuthHeader("st-hours-slots"))
      .send({
        replaceOpenSlots: [
          // omit both existing; only open should be deletable
        ],
      });
    expect(put.status).toBe(200);
    expect(put.body.data.protectedSlots.some((s: { id: string }) => s.id === heldSlot.id)).toBe(true);
    expect(put.body.data.deletedOpenCount).toBe(1);

    const stillThere = await prisma.psychologistAvailabilitySlot.findUnique({ where: { id: heldSlot.id } });
    expect(stillThere).toBeTruthy();
    const openGone = await prisma.psychologistAvailabilitySlot.findUnique({ where: { id: openSlot.id } });
    expect(openGone).toBeNull();
  });

  it("rejects client booking when mode not in sessionModes; still allows valid mode", async () => {
    const psych = await seedLivePsychologist("Dr Modes");
    await prisma.psychologistProfile.update({
      where: { id: psych.id },
      data: { sessionModes: [CommunicationMode.CHAT] },
    });
    await seedAvailabilitySlotsForPsychologist({
      psychologistProfileId: psych.id,
      daysAhead: 3,
      slotsPerDay: 2,
    });

    const { token, userId } = await registerClient();
    await ensureActiveSubscriptionForUser(userId);

    const from = new Date().toISOString();
    const to = new Date(Date.now() + 7 * 86400000).toISOString();
    const avail = await request(app)
      .get(`/api/psychologists/${psych.id}/availability`)
      .query({ from, to })
      .set("Authorization", `Bearer ${token}`);
    expect(avail.status).toBe(200);
    const slotId = avail.body.data.items[0].id as string;

    const bad = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych.id, slotId, communicationMode: CommunicationMode.VIDEO });
    expect(bad.status).toBe(400);

    const good = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ psychologistProfileId: psych.id, slotId, communicationMode: CommunicationMode.CHAT });
    expect(good.status).toBe(201);
  });

  it("enforces maxSessionsPerDay on new client bookings", async () => {
    const psych = await seedLivePsychologist("Dr Cap");
    await prisma.psychologistProfile.update({
      where: { id: psych.id },
      data: { maxSessionsPerDay: 1 },
    });

    const slot1 = await createFutureSlot(psych.id, 30);
    const slot2 = await createFutureSlot(psych.id, 31);
    // Same UTC day
    const day = new Date(Date.now() + 40 * 60 * 60 * 1000);
    day.setUTCHours(10, 0, 0, 0);
    const slotA = await prisma.psychologistAvailabilitySlot.create({
      data: {
        psychologistProfileId: psych.id,
        startsAt: day,
        endsAt: new Date(day.getTime() + 40 * 60 * 1000),
      },
    });
    const slotBStart = new Date(day.getTime() + 2 * 60 * 60 * 1000);
    const slotB = await prisma.psychologistAvailabilitySlot.create({
      data: {
        psychologistProfileId: psych.id,
        startsAt: slotBStart,
        endsAt: new Date(slotBStart.getTime() + 40 * 60 * 1000),
      },
    });
    void slot1;
    void slot2;

    const { token, userId } = await registerClient();
    await ensureActiveSubscriptionForUser(userId);

    const first = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({
        psychologistProfileId: psych.id,
        slotId: slotA.id,
        communicationMode: CommunicationMode.VIDEO,
      });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({
        psychologistProfileId: psych.id,
        slotId: slotB.id,
        communicationMode: CommunicationMode.VIDEO,
      });
    expect(second.status).toBe(409);
  });
});
