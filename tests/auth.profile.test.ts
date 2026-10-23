import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetAuthTables, registerPayload, TEST_RECOVERY_KEY } from "./helpers";

const app = createApp();

describe("Auth & Profile API", () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  it("registers a new account and returns tokens", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .set("X-Client-Platform", "ios")
      .send(registerPayload());

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("success");
    expect(res.body.data.tokens.accessToken).toBeTruthy();
    expect(res.body.data.tokens.refreshToken).toContain(".");
    expect(res.body.data.onboardingComplete).toBe(true);
  });

  it("rejects invalid recovery key length", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send(registerPayload({ recoveryKey: "one two three" }));

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("fail");
  });

  it("rejects duplicate registration for the same recovery key", async () => {
    await request(app).post("/api/auth/register").set("X-Client-Platform", "ios").send(registerPayload());

    const res = await request(app)
      .post("/api/auth/register")
      .set("X-Client-Platform", "ios")
      .send(registerPayload({ alias: "Other" }));

    expect(res.status).toBe(409);
  });

  it("recovers account and allows multiple device sessions", async () => {
    await request(app).post("/api/auth/register").set("X-Client-Platform", "ios").send(registerPayload());

    const device2 = "550e8400-e29b-41d4-a716-446655440002";
    const recover1 = await request(app)
      .post("/api/auth/recover")
      .set("X-Client-Platform", "android")
      .send({ recoveryKey: TEST_RECOVERY_KEY, deviceId: "550e8400-e29b-41d4-a716-446655440001" });

    const recover2 = await request(app)
      .post("/api/auth/recover")
      .set("X-Client-Platform", "android")
      .send({ recoveryKey: TEST_RECOVERY_KEY, deviceId: device2 });

    expect(recover1.status).toBe(200);
    expect(recover2.status).toBe(200);
    expect(recover1.body.data.tokens.refreshToken).not.toBe(recover2.body.data.tokens.refreshToken);

    const refresh1 = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: recover1.body.data.tokens.refreshToken });

    expect(refresh1.status).toBe(200);
  });

  it("rotates refresh token and revokes session on reuse of old refresh", async () => {
    const reg = await request(app).post("/api/auth/register").set("X-Client-Platform", "ios").send(registerPayload());

    const oldRefresh = reg.body.data.tokens.refreshToken;
    const rotated = await request(app).post("/api/auth/refresh").send({ refreshToken: oldRefresh });
    expect(rotated.status).toBe(200);

    const reuse = await request(app).post("/api/auth/refresh").send({ refreshToken: oldRefresh });
    expect(reuse.status).toBe(401);

    const stillValid = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: rotated.body.data.tokens.refreshToken });
    expect(stillValid.status).toBe(401);
  });

  it("logout revokes only the current session", async () => {
    const reg = await request(app).post("/api/auth/register").set("X-Client-Platform", "ios").send(registerPayload());

    const recover = await request(app)
      .post("/api/auth/recover")
      .set("X-Client-Platform", "android")
      .send({
        recoveryKey: TEST_RECOVERY_KEY,
        deviceId: "550e8400-e29b-41d4-a716-446655440002",
      });

    const logout = await request(app)
      .post("/api/auth/logout")
      .send({ refreshToken: reg.body.data.tokens.refreshToken });

    expect(logout.status).toBe(200);

    const refreshLoggedOut = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: reg.body.data.tokens.refreshToken });
    expect(refreshLoggedOut.status).toBe(401);

    const refreshOther = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: recover.body.data.tokens.refreshToken });
    expect(refreshOther.status).toBe(200);
  });

  it("returns session for valid access token", async () => {
    const reg = await request(app).post("/api/auth/register").set("X-Client-Platform", "ios").send(registerPayload());

    const session = await request(app)
      .get("/api/auth/session")
      .set("Authorization", `Bearer ${reg.body.data.tokens.accessToken}`);

    expect(session.status).toBe(200);
    expect(session.body.data.user.alias).toBe("Neela");
    expect(session.body.data.session.sessionId).toBeTruthy();
  });

  it("updates profile and preferences", async () => {
    const reg = await request(app).post("/api/auth/register").set("X-Client-Platform", "ios").send(registerPayload());
    const token = reg.body.data.tokens.accessToken;

    const profile = await request(app).get("/api/profile").set("Authorization", `Bearer ${token}`);
    expect(profile.status).toBe(200);
    expect(profile.body.data.lifeStage).toBe("STARTING_OUT");

    const patch = await request(app)
      .patch("/api/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ alias: "Sky" });

    expect(patch.status).toBe(200);
    expect(patch.body.data.alias).toBe("Sky");

    const prefs = await request(app)
      .patch("/api/profile/preferences")
      .set("Authorization", `Bearer ${token}`)
      .send({ lifeStage: "BUILDING" });

    expect(prefs.status).toBe(200);
    expect(prefs.body.data.lifeStage).toBe("BUILDING");

    const onboarding = await request(app)
      .put("/api/profile/onboarding")
      .set("Authorization", `Bearer ${token}`)
      .send({ startingFeelings: ["LOW", "LONELY"] });

    expect(onboarding.status).toBe(200);
    expect(onboarding.body.data.onboardingComplete).toBe(true);
  });

  it("rejects invalid recovery on recover", async () => {
    await request(app).post("/api/auth/register").set("X-Client-Platform", "ios").send(registerPayload());

    const res = await request(app)
      .post("/api/auth/recover")
      .send({
        recoveryKey: "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda wrong",
        deviceId: "550e8400-e29b-41d4-a716-446655440099",
      });

    expect(res.status).toBe(401);
  });

  it("rejects email-like alias", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .set("X-Client-Platform", "ios")
      .send(registerPayload({ alias: "user@example.com" }));

    expect(res.status).toBe(400);
  });

  it("requires deviceId for mobile register", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .set("X-Client-Platform", "ios")
      .send(registerPayload({ deviceId: undefined }));

    expect(res.status).toBe(400);
  });
});
