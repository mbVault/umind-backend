import {
  BookingStatus,
  CommunicationMode,
  SessionRiskLevel,
  SessionStatus,
} from "@prisma/client";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { toClientRef } from "../src/modules/staff/clientRef";
import {
  SESSION_PRICE_TEST,
  confirmBookingWithSucceededPayment,
  seedLivePsychologist,
} from "./commerce.helpers";
import { resetAuthTables, registerPayload } from "./helpers";
import { resetStaffTables, seedRbacCatalog, staffAuthHeader } from "./staff.helpers";

const app = createApp();

const registerClient = async () => {
  const res = await request(app)
    .post("/api/auth/register")
    .set("X-Client-Platform", "ios")
    .send(registerPayload({ alias: "OpsMap" }));
  expect(res.status).toBe(201);
  return {
    token: res.body.data.tokens.accessToken as string,
    userId: res.body.data.user.id as string,
  };
};

const bindPsychAuth = async (psychAccountId: string, stId: string) => {
  await prisma.account.update({ where: { id: psychAccountId }, data: { superTokensUserId: stId } });
};

const createNearNowSession = async (psychId: string, userId: string) => {
  const start = new Date(Date.now() - 5 * 60 * 1000);
  const end = new Date(start.getTime() + 40 * 60 * 1000);
  const booking = await prisma.psychologistBooking.create({
    data: {
      userId,
      psychologistProfileId: psychId,
      scheduledStartAt: start,
      scheduledEndAt: end,
      communicationMode: CommunicationMode.VIDEO,
      status: BookingStatus.PENDING_PAYMENT,
      policyVersion: "v1",
      shareSaathiSummary: true,
      shareMoodHistory: false,
    },
  });
  await confirmBookingWithSucceededPayment({ userId, bookingId: booking.id });
  const session = await prisma.psychologistSession.findUniqueOrThrow({ where: { bookingId: booking.id } });
  return { booking, session };
};

describe("Staff psychologist day-ops APIs (screens 6–11)", () => {
  beforeEach(async () => {
    await resetAuthTables();
    await resetStaffTables();
    await seedRbacCatalog();
    process.env.BOOKING_SESSION_PRICE_MINOR_UNITS = String(SESSION_PRICE_TEST);
  });

  it("dashboard + bookings list never expose userId", async () => {
    const psych = await seedLivePsychologist("Dr Dash");
    await bindPsychAuth(psych.accountId, "st-ops-dash");
    const { userId } = await registerClient();
    const { booking } = await createNearNowSession(psych.id, userId);
    const date = booking.scheduledStartAt.toISOString().slice(0, 10);

    const dash = await request(app)
      .get("/api/v1/staff/psychologist/me/dashboard")
      .query({ date })
      .set(staffAuthHeader("st-ops-dash"));
    expect(dash.status).toBe(200);
    expect(dash.body.data.todaySessionCount).toBeGreaterThanOrEqual(1);
    expect(dash.body.data.todayBookings[0].client.clientRef).toBeTruthy();
    expect(JSON.stringify(dash.body.data)).not.toContain(userId);

    const list = await request(app)
      .get("/api/v1/staff/psychologist/me/bookings")
      .query({ date })
      .set(staffAuthHeader("st-ops-dash"));
    expect(list.status).toBe(200);
    expect(list.body.data.items[0].id).toBe(booking.id);
    expect(list.body.data.items[0].client.userId).toBeUndefined();
  });

  it("brief honors share flags; safety-flags returns soft list", async () => {
    const psych = await seedLivePsychologist("Dr Brief");
    await bindPsychAuth(psych.accountId, "st-ops-brief");
    const { userId } = await registerClient();
    const { booking } = await createNearNowSession(psych.id, userId);

    const brief = await request(app)
      .get(`/api/v1/staff/psychologist/me/bookings/${booking.id}/brief`)
      .set(staffAuthHeader("st-ops-brief"));
    expect(brief.status).toBe(200);
    expect(brief.body.data.shareSaathiSummary).toBe(true);
    expect(brief.body.data.shareMoodHistory).toBe(false);
    expect(brief.body.data.moodHistory).toEqual([]);
    expect(brief.body.data.client.clientRef).toBe(toClientRef(psych.id, userId));

    const flags = await request(app)
      .get(`/api/v1/staff/psychologist/me/bookings/${booking.id}/safety-flags`)
      .set(staffAuthHeader("st-ops-brief"));
    expect(flags.status).toBe(200);
    expect(Array.isArray(flags.body.data.flags)).toBe(true);
  });

  it("session join stubs media, notes + complete + aftercare + clients + earnings work", async () => {
    const psych = await seedLivePsychologist("Dr Live");
    await bindPsychAuth(psych.accountId, "st-ops-live");
    const { userId } = await registerClient();
    const { booking, session } = await createNearNowSession(psych.id, userId);

    const join = await request(app)
      .post(`/api/v1/staff/psychologist/me/sessions/${session.id}/join`)
      .set(staffAuthHeader("st-ops-live"));
    expect(join.status).toBe(200);
    expect(join.body.data.sessionStatus).toBe(SessionStatus.IN_PROGRESS);
    expect(join.body.data.media.status).toBe("UNAVAILABLE");
    expect(join.body.data.media.joinToken).toBeNull();

    const notes = await request(app)
      .put(`/api/v1/staff/psychologist/me/sessions/${session.id}/notes`)
      .set(staffAuthHeader("st-ops-live"))
      .send({ privateNotes: "Focus on sleep", privateNoteTags: ["sleep"] });
    expect(notes.status).toBe(200);
    expect(notes.body.data.privateNotes).toContain("sleep");

    const complete = await request(app)
      .post(`/api/v1/staff/psychologist/me/sessions/${session.id}/complete`)
      .set(staffAuthHeader("st-ops-live"));
    expect(complete.status).toBe(200);
    expect(complete.body.data.sessionStatus).toBe(SessionStatus.COMPLETED);

    const after = await request(app)
      .put(`/api/v1/staff/psychologist/me/sessions/${session.id}/after-session`)
      .set(staffAuthHeader("st-ops-live"))
      .send({
        riskLevel: SessionRiskLevel.LOW,
        followUpRecommended: true,
        followUpNote: "Check sleep next week",
        clientFacingNote: "Try the breath track",
        recommendedAudioIds: [],
      });
    expect(after.status).toBe(200);
    expect(after.body.data.aftercareSubmittedAt).toBeTruthy();

    const clients = await request(app)
      .get("/api/v1/staff/psychologist/me/clients")
      .set(staffAuthHeader("st-ops-live"));
    expect(clients.status).toBe(200);
    expect(clients.body.data.items.length).toBe(1);
    const clientRow = clients.body.data.items[0];
    const clientRef = clientRow.clientRef as string;
    expect(clientRef).toBe(toClientRef(psych.id, userId));
    expect(clientRow).not.toHaveProperty("userId");
    expect(clientRow).not.toHaveProperty("id");
    expect(clientRow.alias).toBeTruthy();
    expect(clientRow.lifeStage).toBeTruthy();
    expect(Array.isArray(clientRow.startingFeelings)).toBe(true);
    expect(["IMPROVING", "STEADY", "WATCH"]).toContain(clientRow.trend);
    expect(["ACTIVE", "PAST"]).toContain(clientRow.relationship);

    const history = await request(app)
      .get(`/api/v1/staff/psychologist/me/clients/${clientRef}/history`)
      .set(staffAuthHeader("st-ops-live"));
    expect(history.status).toBe(200);
    expect(history.body.data.items[0].bookingId).toBe(booking.id);

    const month = new Date().toISOString().slice(0, 7);
    const earnings = await request(app)
      .get("/api/v1/staff/psychologist/me/earnings/summary")
      .query({ month })
      .set(staffAuthHeader("st-ops-live"));
    expect(earnings.status).toBe(200);
    expect(earnings.body.data.eligibleSessionCount).toBeGreaterThanOrEqual(1);
    expect(earnings.body.data.splitPercent).toBe(70);

    const weekly = await request(app)
      .get("/api/v1/staff/psychologist/me/earnings/weekly")
      .query({ month })
      .set(staffAuthHeader("st-ops-live"));
    expect(weekly.status).toBe(200);
    expect(Array.isArray(weekly.body.data.items)).toBe(true);

    const payouts = await request(app)
      .get("/api/v1/staff/psychologist/me/payouts")
      .set(staffAuthHeader("st-ops-live"));
    expect(payouts.status).toBe(200);
    expect(payouts.body.data.items.length).toBeGreaterThanOrEqual(1);

    const payoutId = payouts.body.data.items[0].id as string;
    const payout = await request(app)
      .get(`/api/v1/staff/psychologist/me/payouts/${payoutId}`)
      .set(staffAuthHeader("st-ops-live"));
    expect(payout.status).toBe(200);
    expect(payout.body.data.psychologistShareMinorUnits).toBeGreaterThan(0);
  });

  it("does not disturb client psychologists public contract", async () => {
    const psych = await seedLivePsychologist("Dr Public");
    const { token } = await registerClient();
    const res = await request(app).get("/api/psychologists").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items[0].id).toBe(psych.id);
    expect(res.body.data.items[0].clientRef).toBeUndefined();
    expect(res.body.data.items[0].presence).toBeUndefined();
    expect(res.body.data.items[0].privateNotes).toBeUndefined();
  });
});
