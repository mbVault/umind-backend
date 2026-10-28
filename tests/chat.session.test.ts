import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  BookingStatus,
  CommunicationMode,
  ParticipantRole,
  SessionStatus,
} from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { attachChatSocket } from "../src/socket";
import {
  SESSION_PRICE_TEST,
  confirmBookingWithSucceededPayment,
  seedLivePsychologist,
} from "./commerce.helpers";
import { registerPayload, resetAuthTables } from "./helpers";
import { resetStaffTables, seedRbacCatalog, staffAuthHeader } from "./staff.helpers";

const app = createApp();
let httpServer: HttpServer;
let baseUrl: string;

const connectCustomer = (accessToken: string): Promise<ClientSocket> =>
  new Promise((resolve, reject) => {
    const socket = ioc(baseUrl, {
      path: "/socket.io",
      transports: ["websocket"],
      auth: { type: "customer", accessToken },
      autoConnect: true,
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });

const connectStaff = (testSuperTokensUserId: string): Promise<ClientSocket> =>
  new Promise((resolve, reject) => {
    const socket = ioc(baseUrl, {
      path: "/socket.io",
      transports: ["websocket"],
      auth: { type: "staff", testSuperTokensUserId },
      autoConnect: true,
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });

const emitAck = <T>(
  socket: ClientSocket,
  event: string,
  payload: unknown,
): Promise<{ ok: true; data: T } | { ok: false; code: number; message: string }> =>
  new Promise((resolve, reject) => {
    socket
      .timeout(5000)
      .emit(event, payload, (err: Error | null, res: unknown) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(res as { ok: true; data: T } | { ok: false; code: number; message: string });
      });
  });

const registerClient = async (alias = "ChatUser") => {
  const res = await request(app)
    .post("/api/auth/register")
    .set("X-Client-Platform", "ios")
    .send(
      registerPayload({
        alias,
        recoveryKey: `${alias} alpha beta gamma delta epsilon zeta eta theta iota kappa lambda`,
        deviceId: crypto.randomUUID(),
      }),
    );
  expect(res.status).toBe(201);
  return {
    token: res.body.data.tokens.accessToken as string,
    userId: res.body.data.user.id as string,
  };
};

const bindPsychAuth = async (psychAccountId: string, stId: string) => {
  await prisma.account.update({ where: { id: psychAccountId }, data: { superTokensUserId: stId } });
};

const createChatSession = async (input: {
  psychId: string;
  userId: string;
  status?: SessionStatus;
  mode?: CommunicationMode;
  /** Offset start from "now - 5m" to avoid booking overlap exclusion. */
  slotOffsetMinutes?: number;
}) => {
  const start = new Date(Date.now() - 5 * 60 * 1000 + (input.slotOffsetMinutes ?? 0) * 60 * 1000);
  const end = new Date(start.getTime() + 40 * 60 * 1000);
  const booking = await prisma.psychologistBooking.create({
    data: {
      userId: input.userId,
      psychologistProfileId: input.psychId,
      scheduledStartAt: start,
      scheduledEndAt: end,
      communicationMode: input.mode ?? CommunicationMode.CHAT,
      status: BookingStatus.PENDING_PAYMENT,
      policyVersion: "v1",
    },
  });
  await confirmBookingWithSucceededPayment({ userId: input.userId, bookingId: booking.id });
  const session = await prisma.psychologistSession.update({
    where: { bookingId: booking.id },
    data: {
      status: input.status ?? SessionStatus.IN_PROGRESS,
      actualStartedAt: new Date(),
    },
  });
  return { booking, session };
};

beforeEach(async () => {
  await resetAuthTables();
  await resetStaffTables();
  await seedRbacCatalog();
  process.env.BOOKING_SESSION_PRICE_MINOR_UNITS = String(SESSION_PRICE_TEST);
});

beforeEach(async () => {
  if (!httpServer) {
    httpServer = createServer(app);
    attachChatSocket(httpServer);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }
});

afterAll(async () => {
  if (httpServer) {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("Psychologist–client chat HTTP history", () => {
  it("authorized client and psychologist can retrieve messages; strangers cannot", async () => {
    const psych = await seedLivePsychologist("Dr Chat");
    await bindPsychAuth(psych.accountId, "st-chat-hist");
    const client = await registerClient("HistA");
    const other = await registerClient("HistB");
    const { session } = await createChatSession({ psychId: psych.id, userId: client.userId });

    await prisma.psychologistChatMessage.create({
      data: {
        sessionId: session.id,
        senderRole: ParticipantRole.CUSTOMER,
        senderUserId: client.userId,
        content: "hello from history",
        clientMessageId: "hist-msg-1",
      },
    });

    const okClient = await request(app)
      .get(`/api/sessions/${session.id}/messages`)
      .set("Authorization", `Bearer ${client.token}`);
    expect(okClient.status).toBe(200);
    expect(okClient.body.data.items).toHaveLength(1);
    expect(okClient.body.data.items[0].content).toBe("hello from history");

    const okPsych = await request(app)
      .get(`/api/v1/staff/psychologist/me/sessions/${session.id}/messages`)
      .set(staffAuthHeader("st-chat-hist"));
    expect(okPsych.status).toBe(200);
    expect(okPsych.body.data.items).toHaveLength(1);

    const denied = await request(app)
      .get(`/api/sessions/${session.id}/messages`)
      .set("Authorization", `Bearer ${other.token}`);
    expect(denied.status).toBe(404);

    const otherPsych = await seedLivePsychologist("Dr Other");
    await bindPsychAuth(otherPsych.accountId, "st-chat-other");
    const deniedPsych = await request(app)
      .get(`/api/v1/staff/psychologist/me/sessions/${session.id}/messages`)
      .set(staffAuthHeader("st-chat-other"));
    expect(deniedPsych.status).toBe(404);
  });

  it("keeps message history isolated across two sessions for the same pair", async () => {
    const psych = await seedLivePsychologist("Dr Iso");
    await bindPsychAuth(psych.accountId, "st-chat-iso");
    const client = await registerClient("IsoUser");
    const a = await createChatSession({ psychId: psych.id, userId: client.userId, slotOffsetMinutes: 0 });
    const b = await createChatSession({ psychId: psych.id, userId: client.userId, slotOffsetMinutes: 60 });

    await prisma.psychologistChatMessage.createMany({
      data: [
        {
          sessionId: a.session.id,
          senderRole: ParticipantRole.CUSTOMER,
          senderUserId: client.userId,
          content: "session-a",
          clientMessageId: "iso-a",
        },
        {
          sessionId: b.session.id,
          senderRole: ParticipantRole.CUSTOMER,
          senderUserId: client.userId,
          content: "session-b",
          clientMessageId: "iso-b",
        },
      ],
    });

    const histA = await request(app)
      .get(`/api/sessions/${a.session.id}/messages`)
      .set("Authorization", `Bearer ${client.token}`);
    const histB = await request(app)
      .get(`/api/sessions/${b.session.id}/messages`)
      .set("Authorization", `Bearer ${client.token}`);
    expect(histA.body.data.items.map((m: { content: string }) => m.content)).toEqual(["session-a"]);
    expect(histB.body.data.items.map((m: { content: string }) => m.content)).toEqual(["session-b"]);
  });

  it("paginates history stably with cursor", async () => {
    const psych = await seedLivePsychologist("Dr Page");
    await bindPsychAuth(psych.accountId, "st-chat-page");
    const client = await registerClient("PageUser");
    const { session } = await createChatSession({ psychId: psych.id, userId: client.userId });

    const base = Date.now();
    for (let i = 0; i < 5; i += 1) {
      await prisma.psychologistChatMessage.create({
        data: {
          sessionId: session.id,
          senderRole: ParticipantRole.CUSTOMER,
          senderUserId: client.userId,
          content: `m${i}`,
          clientMessageId: `page-${i}`,
          createdAt: new Date(base + i * 1000),
        },
      });
    }

    const page1 = await request(app)
      .get(`/api/sessions/${session.id}/messages`)
      .query({ limit: 2 })
      .set("Authorization", `Bearer ${client.token}`);
    expect(page1.status).toBe(200);
    expect(page1.body.data.items.map((m: { content: string }) => m.content)).toEqual(["m3", "m4"]);
    expect(page1.body.data.hasMore).toBe(true);
    expect(page1.body.data.nextCursor).toBeTruthy();

    const page2 = await request(app)
      .get(`/api/sessions/${session.id}/messages`)
      .query({ limit: 2, cursor: page1.body.data.nextCursor })
      .set("Authorization", `Bearer ${client.token}`);
    expect(page2.body.data.items.map((m: { content: string }) => m.content)).toEqual(["m1", "m2"]);
    expect(page2.body.data.hasMore).toBe(true);

    const page3 = await request(app)
      .get(`/api/sessions/${session.id}/messages`)
      .query({ limit: 2, cursor: page2.body.data.nextCursor })
      .set("Authorization", `Bearer ${client.token}`);
    expect(page3.body.data.items.map((m: { content: string }) => m.content)).toEqual(["m0"]);
    expect(page3.body.data.hasMore).toBe(false);
    expect(page3.body.data.nextCursor).toBeNull();
  });
});

describe("Psychologist–client chat Socket.IO", () => {
  const sockets: ClientSocket[] = [];

  afterEach(() => {
    while (sockets.length) {
      const s = sockets.pop();
      s?.disconnect();
    }
  });

  const track = async (factory: () => Promise<ClientSocket>) => {
    const s = await factory();
    sockets.push(s);
    return s;
  };

  it("client and psychologist can send; peer receives message:new with same id", async () => {
    const psych = await seedLivePsychologist("Dr LiveChat");
    await bindPsychAuth(psych.accountId, "st-chat-live");
    const client = await registerClient("LiveUser");
    const { session } = await createChatSession({ psychId: psych.id, userId: client.userId });

    const customerSocket = await track(() => connectCustomer(client.token));
    const psychSocket = await track(() => connectStaff("st-chat-live"));

    await emitAck(customerSocket, "session:join", { sessionId: session.id });
    await emitAck(psychSocket, "session:join", { sessionId: session.id });

    const received = new Promise<Record<string, unknown>>((resolve) => {
      psychSocket.once("message:new", (msg) => resolve(msg as Record<string, unknown>));
    });

    const ack = await emitAck<{ message: { id: string; content: string; clientMessageId: string } }>(
      customerSocket,
      "message:send",
      {
        sessionId: session.id,
        clientMessageId: "live-1",
        content: "hi doctor",
      },
    );
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;

    const peerMsg = await received;
    expect(peerMsg.id).toBe(ack.data.message.id);
    expect(peerMsg.content).toBe("hi doctor");

    const hist = await request(app)
      .get(`/api/sessions/${session.id}/messages`)
      .set("Authorization", `Bearer ${client.token}`);
    expect(hist.body.data.items).toHaveLength(1);
  });

  it("retry with same clientMessageId does not duplicate", async () => {
    const psych = await seedLivePsychologist("Dr Idem");
    await bindPsychAuth(psych.accountId, "st-chat-idem");
    const client = await registerClient("IdemUser");
    const { session } = await createChatSession({ psychId: psych.id, userId: client.userId });
    const socket = await track(() => connectCustomer(client.token));

    const first = await emitAck<{ message: { id: string } }>(socket, "message:send", {
      sessionId: session.id,
      clientMessageId: "idem-1",
      content: "once",
    });
    const second = await emitAck<{ message: { id: string } }>(socket, "message:send", {
      sessionId: session.id,
      clientMessageId: "idem-1",
      content: "once",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data.message.id).toBe(first.data.message.id);

    const count = await prisma.psychologistChatMessage.count({ where: { sessionId: session.id } });
    expect(count).toBe(1);
  });

  it("rejects send when session is not IN_PROGRESS or mode is not CHAT", async () => {
    const psych = await seedLivePsychologist("Dr Gate");
    await bindPsychAuth(psych.accountId, "st-chat-gate");
    const client = await registerClient("GateUser");
    const scheduled = await createChatSession({
      psychId: psych.id,
      userId: client.userId,
      status: SessionStatus.SCHEDULED,
      slotOffsetMinutes: 0,
    });
    const voice = await createChatSession({
      psychId: psych.id,
      userId: client.userId,
      mode: CommunicationMode.VOICE,
      status: SessionStatus.IN_PROGRESS,
      slotOffsetMinutes: 60,
    });
    const socket = await track(() => connectCustomer(client.token));

    const a = await emitAck(socket, "message:send", {
      sessionId: scheduled.session.id,
      clientMessageId: "gate-1",
      content: "nope",
    });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.code).toBe(409);

    const b = await emitAck(socket, "message:send", {
      sessionId: voice.session.id,
      clientMessageId: "gate-2",
      content: "nope",
    });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe(409);
  });

  it("unassigned psychologist cannot join or send", async () => {
    const psych = await seedLivePsychologist("Dr Owner");
    await bindPsychAuth(psych.accountId, "st-chat-owner");
    const other = await seedLivePsychologist("Dr Intruder");
    await bindPsychAuth(other.accountId, "st-chat-intruder");
    const client = await registerClient("OwnUser");
    const { session } = await createChatSession({ psychId: psych.id, userId: client.userId });

    const intruder = await track(() => connectStaff("st-chat-intruder"));
    const join = await emitAck(intruder, "session:join", { sessionId: session.id });
    expect(join.ok).toBe(false);

    const send = await emitAck(intruder, "message:send", {
      sessionId: session.id,
      clientMessageId: "bad-1",
      content: "hack",
    });
    expect(send.ok).toBe(false);
  });

  it("recipient can mark read; sender cannot forge", async () => {
    const psych = await seedLivePsychologist("Dr Read");
    await bindPsychAuth(psych.accountId, "st-chat-read");
    const client = await registerClient("ReadUser");
    const { session } = await createChatSession({ psychId: psych.id, userId: client.userId });

    const customerSocket = await track(() => connectCustomer(client.token));
    const psychSocket = await track(() => connectStaff("st-chat-read"));

    const sent = await emitAck<{ message: { id: string; readAt: string | null } }>(
      customerSocket,
      "message:send",
      {
        sessionId: session.id,
        clientMessageId: "read-1",
        content: "please read",
      },
    );
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const forged = await emitAck(customerSocket, "message:read", {
      sessionId: session.id,
      messageId: sent.data.message.id,
    });
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.code).toBe(403);

    const marked = await emitAck<{ message: { id: string; readAt: string | null } }>(
      psychSocket,
      "message:read",
      {
        sessionId: session.id,
        messageId: sent.data.message.id,
      },
    );
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    expect(marked.data.message.readAt).toBeTruthy();

    const again = await emitAck<{ message: { readAt: string | null } }>(psychSocket, "message:read", {
      sessionId: session.id,
      messageId: sent.data.message.id,
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.data.message.readAt).toBe(marked.data.message.readAt);
  });

  it("rejects unauthenticated socket connections", async () => {
    await expect(
      new Promise<ClientSocket>((resolve, reject) => {
        const socket = ioc(baseUrl, {
          path: "/socket.io",
          transports: ["websocket"],
          auth: { type: "customer" },
          autoConnect: true,
        });
        socket.on("connect", () => resolve(socket));
        socket.on("connect_error", (err) => reject(err));
      }),
    ).rejects.toBeTruthy();
  });
});
