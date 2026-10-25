import {
  AccountStatus,
  BillingMode,
  CommunicationMode,
  PaymentProvider,
  PsychologistPresence,
  StaffRole,
  SubscriptionStatus,
  VerificationCheckStatus,
  VerificationCheckType,
} from "@prisma/client";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { REQUIRED_VERIFICATION_CHECKS } from "../src/modules/staff/permissions";
import { resetAuthTables, registerPayload } from "./helpers";
import { resetStaffTables } from "./staff.helpers";

const app = createApp();

const registerAndGetToken = async (): Promise<string> => {
  const res = await request(app)
    .post("/api/auth/register")
    .set("X-Client-Platform", "ios")
    .send(registerPayload({ alias: "Buyer" }));
  expect(res.status).toBe(201);
  return res.body.data.tokens.accessToken as string;
};

const seedLiveBookablePsychologist = async (displayName: string) => {
  const account = await prisma.account.create({
    data: {
      superTokensUserId: `st-${displayName}`,
      status: AccountStatus.ACTIVE,
      roles: { create: [{ role: StaffRole.PSYCHOLOGIST }] },
    },
  });
  return prisma.psychologistProfile.create({
    data: {
      accountId: account.id,
      displayName,
      publicationStatus: "LIVE",
      accountStatus: "ACTIVE",
      publishedAt: new Date(),
      presence: PsychologistPresence.ONLINE,
      acceptingNewClients: true,
      sessionModes: [CommunicationMode.CHAT, CommunicationMode.VOICE, CommunicationMode.VIDEO],
      specialisations: { create: [{ code: "STRESS" }] },
      languages: { create: [{ code: "ENGLISH" }] },
      checks: {
        create: REQUIRED_VERIFICATION_CHECKS.map((type) => ({
          type,
          status: VerificationCheckStatus.VERIFIED,
        })),
      },
    },
  });
};

describe("Chunk 3 Phase 1 — discovery & subscriptions", () => {
  beforeEach(async () => {
    await resetAuthTables();
    await resetStaffTables();
  });

  it("GET /api/psychologists requires authentication", async () => {
    const res = await request(app).get("/api/psychologists");
    expect(res.status).toBe(401);
    expect(res.body.status).toBe("fail");
  });

  it("lists only bookable LIVE psychologists with public DTO fields", async () => {
    const live = await seedLiveBookablePsychologist("Dr Live");
    await prisma.psychologistProfile.create({
      data: {
        accountId: (
          await prisma.account.create({
            data: { superTokensUserId: "st-hidden", roles: { create: [{ role: StaffRole.PSYCHOLOGIST }] } },
          })
        ).id,
        displayName: "Not Live",
        publicationStatus: "PENDING_VERIFICATION",
        checks: {
          create: [{ type: VerificationCheckType.IDENTITY, status: VerificationCheckStatus.QUEUED }],
        },
      },
    });

    const token = await registerAndGetToken();
    const res = await request(app).get("/api/psychologists").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].id).toBe(live.id);
    expect(res.body.data.items[0].publicName).toBe("Dr Live");
    expect(res.body.data.items[0].accountId).toBeUndefined();
    expect(res.body.data.items[0].aadhaarLast4).toBeUndefined();
    expect(res.body.data.items[0].checks).toBeUndefined();
  });

  it("GET /api/psychologists/:id returns 404 for ineligible psychologist", async () => {
    const token = await registerAndGetToken();
    const hidden = await prisma.psychologistProfile.create({
      data: {
        accountId: (
          await prisma.account.create({
            data: { superTokensUserId: "st-x", roles: { create: [{ role: StaffRole.PSYCHOLOGIST }] } },
          })
        ).id,
        publicationStatus: "VERIFIED_UNPUBLISHED",
      },
    });

    const res = await request(app)
      .get(`/api/psychologists/${hidden.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("GET /api/subscription-plans returns seeded plans without auth", async () => {
    const res = await request(app).get("/api/subscription-plans");
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(3);
    expect(res.body.data.items.some((p: { code: string }) => p.code === "MONTHLY")).toBe(true);
  });

  it("GET /api/subscriptions/me requires auth and returns entitlements", async () => {
    const unauth = await request(app).get("/api/subscriptions/me");
    expect(unauth.status).toBe(401);

    const token = await registerAndGetToken();
    const empty = await request(app).get("/api/subscriptions/me").set("Authorization", `Bearer ${token}`);
    expect(empty.status).toBe(200);
    expect(empty.body.data.subscription).toBeNull();
    expect(empty.body.data.entitlements.canBookPsychologist).toBe(false);

    const reg = await request(app)
      .post("/api/auth/register")
      .set("X-Client-Platform", "ios")
      .send(
        registerPayload({
          alias: "TrialUser",
          deviceId: "550e8400-e29b-41d4-a716-446655440010",
          recoveryKey: "river mango lantern quiet cedar monsoon pebble tulsi harbour velvet sparrow dawn",
        }),
      );
    expect(reg.status).toBe(201);
    const trialToken = reg.body.data.tokens.accessToken;
    const plan = await prisma.subscriptionPlan.findFirst({ where: { code: "MONTHLY" } });
    expect(plan).toBeTruthy();

    await prisma.subscription.create({
      data: {
        userId: reg.body.data.user.id,
        planId: plan!.id,
        billingMode: BillingMode.AUTOMATIC,
        status: SubscriptionStatus.TRIALING,
        provider: PaymentProvider.RAZORPAY,
        trialStartsAt: new Date(),
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const trial = await request(app).get("/api/subscriptions/me").set("Authorization", `Bearer ${trialToken}`);
    expect(trial.status).toBe(200);
    expect(trial.body.data.subscription.status).toBe("TRIALING");
    expect(trial.body.data.entitlements.canAccessSaathi).toBe(true);
    expect(trial.body.data.entitlements.canBookPsychologist).toBe(false);
  });
});
