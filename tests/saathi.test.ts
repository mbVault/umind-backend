import {
  BillingMode,
  PaymentProvider,
  SubscriptionStatus,
} from "@prisma/client";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { resetAuthTables, registerPayload } from "./helpers";

const app = createApp();

const register = async (alias = "Neela") => {
  const res = await request(app)
    .post("/api/auth/register")
    .set("X-Client-Platform", "ios")
    .send(registerPayload({ alias, recoveryKey: `${alias} alpha beta gamma delta epsilon zeta eta theta iota kappa lambda` }));
  expect(res.status).toBe(201);
  return {
    token: res.body.data.tokens.accessToken as string,
    userId: res.body.data.user.id as string,
  };
};

const grantSaathiAccess = async (userId: string) => {
  let plan = await prisma.subscriptionPlan.findFirst({ where: { code: "MONTHLY", isActive: true } });
  if (!plan) {
    plan = await prisma.subscriptionPlan.create({
      data: {
        code: "MONTHLY",
        name: "Monthly",
        priceMinorUnits: 19900,
        currency: "INR",
        interval: "MONTHLY",
        durationDays: 30,
        isActive: true,
      },
    });
  }
  await prisma.subscription.create({
    data: {
      userId,
      planId: plan.id,
      billingMode: BillingMode.MANUAL,
      status: SubscriptionStatus.TRIALING,
      provider: PaymentProvider.RAZORPAY,
      trialStartsAt: new Date(),
      trialEndsAt: new Date(Date.now() + 7 * 86400000),
    },
  });
};

describe("Saathi API", () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  it("rejects unauthenticated access", async () => {
    const res = await request(app).get("/api/saathi/conversations");
    expect(res.status).toBe(401);
  });

  it("rejects users without Saathi entitlement", async () => {
    const { token } = await register("NoSub");
    const res = await request(app)
      .post("/api/saathi/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it("creates, lists, renames, messages, and deletes a conversation", async () => {
    const { token, userId } = await register("Chatty");
    await grantSaathiAccess(userId);

    const created = await request(app)
      .post("/api/saathi/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Evening check-in" });
    expect(created.status).toBe(201);
    expect(created.body.data.title).toBe("Evening check-in");
    const conversationId = created.body.data.id as string;

    const listed = await request(app)
      .get("/api/saathi/conversations")
      .set("Authorization", `Bearer ${token}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.items).toHaveLength(1);

    const renamed = await request(app)
      .patch(`/api/saathi/conversations/${conversationId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Sleep talk" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.title).toBe("Sleep talk");

    const sent = await request(app)
      .post(`/api/saathi/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "Kal se neend nahi aa rahi, dil tez chal raha hai." });
    expect(sent.status).toBe(201);
    expect(sent.body.data.userMessage.role).toBe("USER");
    expect(sent.body.data.assistantMessage.role).toBe("ASSISTANT");
    expect(sent.body.data.assistantMessage.status).toBe("COMPLETED");
    expect(sent.body.data.assistantMessage.content.length).toBeGreaterThan(10);
    expect(sent.body.data.audioRecommendations).toEqual([]);
    expect(sent.body.data.safetyLevel).toBe("NORMAL");

    const detail = await request(app)
      .get(`/api/saathi/conversations/${conversationId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.messages.items).toHaveLength(2);

    const deleted = await request(app)
      .delete(`/api/saathi/conversations/${conversationId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleted.status).toBe(200);

    const messagesLeft = await prisma.saathiMessage.count({ where: { conversationId } });
    expect(messagesLeft).toBe(0);
  });

  it("blocks access to another user's conversation", async () => {
    const a = await register("OwnerA");
    const b = await register("OwnerB");
    await grantSaathiAccess(a.userId);
    await grantSaathiAccess(b.userId);

    const created = await request(app)
      .post("/api/saathi/conversations")
      .set("Authorization", `Bearer ${a.token}`)
      .send({});
    const conversationId = created.body.data.id as string;

    const res = await request(app)
      .get(`/api/saathi/conversations/${conversationId}`)
      .set("Authorization", `Bearer ${b.token}`);
    expect(res.status).toBe(404);
  });

  it("returns IMMEDIATE safety path with crisis resources", async () => {
    const { token, userId } = await register("Safe");
    await grantSaathiAccess(userId);

    const created = await request(app)
      .post("/api/saathi/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    const conversationId = created.body.data.id as string;

    const sent = await request(app)
      .post(`/api/saathi/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "I want to kill myself tonight" });
    expect(sent.status).toBe(201);
    expect(sent.body.data.safetyLevel).toBe("IMMEDIATE");
    expect(sent.body.data.crisisResources.length).toBeGreaterThan(0);
    expect(sent.body.data.assistantMessage.content).toContain("14416");
    expect(sent.body.data.audioRecommendations).toEqual([]);
  });

  it("keeps out-of-scope replies without writing wellness memory", async () => {
    const { token, userId } = await register("Scope");
    await grantSaathiAccess(userId);

    const created = await request(app)
      .post("/api/saathi/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    const conversationId = created.body.data.id as string;

    const sent = await request(app)
      .post(`/api/saathi/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "Recommend me a movie for Saturday night" });
    expect(sent.status).toBe(201);
    expect(sent.body.data.safetyLevel).toBe("OUT_OF_SCOPE");

    const memory = await prisma.saathiMemory.findUnique({ where: { conversationId } });
    expect(memory).toBeNull();
  });
});
