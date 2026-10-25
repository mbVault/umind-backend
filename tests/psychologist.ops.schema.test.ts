import {
  AccountStatus,
  BookingStatus,
  CommunicationMode,
  PsychologistPresence,
  SessionRiskLevel,
  SessionStatus,
  StaffRole,
  VerificationCheckStatus,
} from "@prisma/client";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { isPsychologistBookable } from "../src/modules/staff/psychologistService";
import { REQUIRED_VERIFICATION_CHECKS } from "../src/modules/staff/permissions";
import { resetAuthTables, registerPayload } from "./helpers";
import { resetStaffTables } from "./staff.helpers";
import { seedLivePsychologist, createFutureSlot, confirmBookingWithSucceededPayment } from "./commerce.helpers";

const app = createApp();

const registerUser = async () => {
  const res = await request(app)
    .post("/api/auth/register")
    .set("X-Client-Platform", "ios")
    .send(registerPayload({ alias: "OpsClient" }));
  expect(res.status).toBe(201);
  return res.body.data.user.id as string;
};

describe("Psychologist ops schema — fields, bookable gates, seeding", () => {
  beforeEach(async () => {
    await resetAuthTables();
    await resetStaffTables();
  });

  it("seedLivePsychologist persists Hours fields with bookable defaults", async () => {
    const psych = await seedLivePsychologist("Dr Ops");
    const loaded = await prisma.psychologistProfile.findUniqueOrThrow({
      where: { id: psych.id },
      include: { checks: true },
    });

    expect(loaded.presence).toBe(PsychologistPresence.ONLINE);
    expect(loaded.acceptingNewClients).toBe(true);
    expect(loaded.maxSessionsPerDay).toBe(8);
    expect(loaded.sessionModes).toEqual(
      expect.arrayContaining([CommunicationMode.CHAT, CommunicationMode.VOICE, CommunicationMode.VIDEO])
    );
    expect(loaded.weeklyHours).toMatchObject({
      mon: [{ start: "09:00", end: "17:00" }],
      sat: [],
    });
    expect(isPsychologistBookable(loaded)).toBe(true);
  });

  it("AWAY / not accepting / empty modes make LIVE psych unbookable", async () => {
    const psych = await seedLivePsychologist("Dr Gates");
    const base = await prisma.psychologistProfile.findUniqueOrThrow({
      where: { id: psych.id },
      include: { checks: true },
    });
    expect(isPsychologistBookable(base)).toBe(true);

    const away = { ...base, presence: PsychologistPresence.AWAY };
    expect(isPsychologistBookable(away)).toBe(false);

    const closed = { ...base, acceptingNewClients: false };
    expect(isPsychologistBookable(closed)).toBe(false);

    const noModes = { ...base, sessionModes: [] as CommunicationMode[] };
    expect(isPsychologistBookable(noModes)).toBe(false);
  });

  it("booking share flags and session aftercare columns round-trip", async () => {
    const psych = await seedLivePsychologist("Dr Aftercare");
    const slot = await createFutureSlot(psych.id, 5);
    const userId = await registerUser();

    const booking = await prisma.psychologistBooking.create({
      data: {
        userId,
        psychologistProfileId: psych.id,
        scheduledStartAt: slot.startsAt,
        scheduledEndAt: slot.endsAt,
        communicationMode: CommunicationMode.VIDEO,
        status: BookingStatus.PENDING_PAYMENT,
        policyVersion: "v1",
        shareSaathiSummary: true,
        shareMoodHistory: true,
      },
    });

    expect(booking.shareSaathiSummary).toBe(true);
    expect(booking.shareMoodHistory).toBe(true);

    await confirmBookingWithSucceededPayment({ userId, bookingId: booking.id });

    const audio = await prisma.audioTrack.create({
      data: {
        title: `ops-audio-${Date.now()}`,
        category: "STRESS",
        status: "PUBLISHED",
        accessTier: "FREE",
      },
    });

    const session = await prisma.psychologistSession.update({
      where: { bookingId: booking.id },
      data: {
        status: SessionStatus.COMPLETED,
        privateNotes: "Client reported sleep issues",
        privateNoteTags: ["sleep", "stress"],
        riskLevel: SessionRiskLevel.LOW,
        recommendedAudioIds: [audio.id],
        followUpRecommended: true,
        followUpNote: "Check in next week",
        clientFacingNote: "Try the breath track tonight",
        aftercareSubmittedAt: new Date(),
      },
    });

    expect(session.privateNotes).toContain("sleep");
    expect(session.privateNoteTags).toEqual(["sleep", "stress"]);
    expect(session.riskLevel).toBe(SessionRiskLevel.LOW);
    expect(session.recommendedAudioIds).toEqual([audio.id]);
    expect(session.followUpRecommended).toBe(true);
    expect(session.clientFacingNote).toContain("breath");
    expect(session.aftercareSubmittedAt).toBeTruthy();
  });

  it("migration defaults keep a minimal LIVE+verified profile bookable", async () => {
    const account = await prisma.account.create({
      data: {
        superTokensUserId: `st-minimal-${Date.now()}`,
        status: AccountStatus.ACTIVE,
        roles: { create: [{ role: StaffRole.PSYCHOLOGIST }] },
      },
    });
    const profile = await prisma.psychologistProfile.create({
      data: {
        accountId: account.id,
        displayName: "Minimal",
        publicationStatus: "LIVE",
        accountStatus: "ACTIVE",
        publishedAt: new Date(),
        // presence / acceptingNewClients use DB defaults; sessionModes must be set (default [])
        sessionModes: [CommunicationMode.CHAT],
        checks: {
          create: REQUIRED_VERIFICATION_CHECKS.map((type) => ({
            type,
            status: VerificationCheckStatus.VERIFIED,
          })),
        },
      },
      include: { checks: true },
    });

    expect(profile.presence).toBe(PsychologistPresence.ONLINE);
    expect(profile.acceptingNewClients).toBe(true);
    expect(isPsychologistBookable(profile)).toBe(true);
  });
});
