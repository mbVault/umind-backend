import {
  AudioCategory,
  AudioLanguage,
  AudioPublishStatus,
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
    .send(
      registerPayload({
        alias,
        recoveryKey: `${alias} alpha beta gamma delta epsilon zeta eta theta iota kappa lambda`,
      }),
    );
  expect(res.status).toBe(201);
  return {
    token: res.body.data.tokens.accessToken as string,
    userId: res.body.data.user.id as string,
  };
};

const grantContentAccess = async (userId: string) => {
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

describe("Phase 2 mood / diary / privacy / audio", () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  it("lists seeded moods and upserts today's mood", async () => {
    const { token, userId } = await register("Mooder");
    const moods = await request(app).get("/api/moods").set("Authorization", `Bearer ${token}`);
    expect(moods.status).toBe(200);
    expect(moods.body.data.moods.map((m: { name: string }) => m.name)).toEqual([
      "Heavy",
      "Low",
      "Okay",
      "Calm",
      "Bright",
    ]);

    const calm = moods.body.data.moods.find((m: { name: string }) => m.name === "Calm");
    const put = await request(app)
      .put("/api/moods/today")
      .set("Authorization", `Bearer ${token}`)
      .send({ date: "2026-10-25", moodId: calm.id });
    expect(put.status).toBe(200);
    expect(put.body.data.mood.name).toBe("Calm");

    const heavy = moods.body.data.moods.find((m: { name: string }) => m.name === "Heavy");
    const put2 = await request(app)
      .put("/api/moods/today")
      .set("Authorization", `Bearer ${token}`)
      .send({ date: "2026-10-25", moodId: heavy.id });
    expect(put2.status).toBe(200);
    expect(put2.body.data.mood.name).toBe("Heavy");

    const count = await prisma.userMood.count({ where: { userId, date: new Date(Date.UTC(2026, 9, 25)) } });
    expect(count).toBe(1);

    const today = await request(app)
      .get("/api/moods/today")
      .query({ date: "2026-10-25" })
      .set("Authorization", `Bearer ${token}`);
    expect(today.body.data.mood.name).toBe("Heavy");
  });

  it("isolates mood/diary across users", async () => {
    const a = await register("Alice");
    const b = await register("Bob");
    const moods = await request(app).get("/api/moods").set("Authorization", `Bearer ${a.token}`);
    const okay = moods.body.data.moods.find((m: { name: string }) => m.name === "Okay");

    await request(app)
      .put("/api/moods/today")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ date: "2026-10-25", moodId: okay.id });

    const other = await request(app)
      .get("/api/moods/today")
      .query({ date: "2026-10-25" })
      .set("Authorization", `Bearer ${b.token}`);
    expect(other.body.data.mood).toBeNull();

    const cipher = Buffer.from("secret-diary").toString("base64");
    const nonce = Buffer.alloc(12, 7).toString("base64");
    await request(app)
      .put("/api/diary/2026-10-25")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ ciphertext: cipher, nonce, encryptionVersion: 1, schemaVersion: 1 });

    const miss = await request(app)
      .get("/api/diary/2026-10-25")
      .set("Authorization", `Bearer ${b.token}`);
    expect(miss.status).toBe(404);
  });

  it("stores diary as opaque ciphertext and rejects Reflect without consent", async () => {
    const { token, userId } = await register("Writer");
    await grantContentAccess(userId);

    const cipher = Buffer.from(JSON.stringify({ body: "plaintext must not sit in DB columns" })).toString("base64");
    const nonce = Buffer.alloc(12, 1).toString("base64");
    const put = await request(app)
      .put("/api/diary/2026-10-25")
      .set("Authorization", `Bearer ${token}`)
      .send({ ciphertext: cipher, nonce });
    expect(put.status).toBe(200);

    const row = await prisma.diaryEntry.findFirst({ where: { userId } });
    expect(row).toBeTruthy();
    expect(row!.ciphertext.toString("utf8")).not.toContain("plaintext must not");

    const conv = await request(app)
      .post("/api/saathi/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Reflect" });
    expect(conv.status).toBe(201);

    const blocked = await request(app)
      .post(`/api/saathi/conversations/${conv.body.data.id}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Client-Local-Date", "2026-10-25")
      .send({
        content: "Help me reflect",
        diaryContext: {
          entryDate: "2026-10-25",
          causes: ["Work"],
          body: "Overwhelmed today",
        },
      });
    expect(blocked.status).toBe(403);

    const consent = await request(app)
      .put("/api/privacy/consent")
      .set("Authorization", `Bearer ${token}`)
      .send({ shareDiaryWithSaathi: true, shareDiaryConsentVersion: 1 });
    expect(consent.status).toBe(200);
    expect(consent.body.data.shareDiaryWithSaathi).toBe(true);

    const ok = await request(app)
      .post(`/api/saathi/conversations/${conv.body.data.id}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Client-Local-Date", "2026-10-25")
      .send({
        content: "Help me reflect",
        diaryContext: {
          entryDate: "2026-10-25",
          causes: ["Work"],
          body: "Overwhelmed today",
        },
      });
    expect(ok.status).toBe(201);
    expect(ok.body.data.assistantMessage.content).toContain("Overwhelmed");

    const mem = await prisma.saathiMemory.findUnique({
      where: { conversationId: conv.body.data.id },
    });
    expect(mem).toBeNull();
  });

  it("passes today's mood into Saathi and hides unpublished audio", async () => {
    const { token, userId } = await register("Listener");
    await grantContentAccess(userId);

    const moods = await request(app).get("/api/moods").set("Authorization", `Bearer ${token}`);
    const heavy = moods.body.data.moods.find((m: { name: string }) => m.name === "Heavy");
    await request(app)
      .put("/api/moods/today")
      .set("Authorization", `Bearer ${token}`)
      .send({ date: "2026-10-25", moodId: heavy.id });

    const draft = await prisma.audioTrack.create({
      data: {
        title: "Draft only",
        category: AudioCategory.SLEEP,
        status: AudioPublishStatus.DRAFT,
        versions: {
          create: {
            language: AudioLanguage.ENGLISH,
            r2ObjectKey: "audio/draft/en/x",
            mimeType: "audio/mpeg",
            byteSize: 100,
          },
        },
      },
    });

    const published = await prisma.audioTrack.create({
      data: {
        title: "Sleep Wind-down",
        category: AudioCategory.SLEEP,
        status: AudioPublishStatus.PUBLISHED,
        versions: {
          create: {
            language: AudioLanguage.ENGLISH,
            r2ObjectKey: "audio/pub/en/y",
            mimeType: "audio/mpeg",
            byteSize: 100,
            durationSeconds: 300,
          },
        },
      },
    });

    // Seed a local object so head/play can work after we write bytes via storage put helper path
    const { objectStorage } = await import("../src/lib/objectStorage");
    if (objectStorage.putObject) {
      await objectStorage.putObject("audio/pub/en/y", Buffer.from("fake-mp3"), "audio/mpeg");
    }

    const list = await request(app)
      .get("/api/audio")
      .query({ language: "ENGLISH" })
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.items.some((i: { id: string }) => i.id === draft.id)).toBe(false);
    expect(list.body.data.items.some((i: { id: string }) => i.id === published.id)).toBe(true);

    const conv = await request(app)
      .post("/api/saathi/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    const msg = await request(app)
      .post(`/api/saathi/conversations/${conv.body.data.id}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Client-Local-Date", "2026-10-25")
      .send({ content: "I feel tired" });
    expect(msg.status).toBe(201);
    expect(msg.body.data.assistantMessage.content).toContain("Heavy");
    expect(msg.body.data.audioRecommendations.some((r: { trackId: string }) => r.trackId === published.id)).toBe(
      true,
    );
    expect(msg.body.data.audioRecommendations.some((r: { trackId: string }) => r.trackId === draft.id)).toBe(false);

    const play = await request(app)
      .post(`/api/audio/${published.id}/playback`)
      .set("Authorization", `Bearer ${token}`)
      .send({ language: "ENGLISH" });
    expect(play.status).toBe(200);
    expect(play.body.data.playbackUrl).toContain("/api/storage/objects");
  });
});
