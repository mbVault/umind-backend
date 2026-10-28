import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { env } from "../config/env";
import { HttpError } from "../lib/errors";
import { ParticipantRole } from "@prisma/client";
import {
  assertCustomerChatAccess,
  assertPsychologistChatAccess,
  markChatMessageRead,
  sendChatMessage,
  sessionChatRoom,
  type ChatMessageDto,
  type ChatParticipant,
} from "../modules/sessions/chatService";
import { authenticateSocket } from "./socketAuth";

const sendPayloadSchema = z
  .object({
    sessionId: z.string().uuid(),
    clientMessageId: z.string().min(1).max(64),
    content: z.string(),
  })
  .strict();

const readPayloadSchema = z
  .object({
    sessionId: z.string().uuid(),
    messageId: z.string().uuid(),
  })
  .strict();

const joinPayloadSchema = z
  .object({
    sessionId: z.string().uuid(),
  })
  .strict();

type AckOk<T> = { ok: true; data: T };
type AckFail = { ok: false; code: number; message: string };
type Ack<T> = AckOk<T> | AckFail;

type SocketData = {
  principal: ChatParticipant;
};

const toAckFail = (err: unknown): AckFail => {
  if (err instanceof HttpError) {
    return { ok: false, code: err.statusCode, message: err.message };
  }
  console.error("[socket/chat] unexpected error", err instanceof Error ? err.name : "unknown");
  return { ok: false, code: 500, message: "Internal server error" };
};

const getPrincipal = (socket: Socket): ChatParticipant => {
  return (socket.data as SocketData).principal;
};

const assertJoinAccess = async (principal: ChatParticipant, sessionId: string): Promise<void> => {
  if (principal.role === ParticipantRole.CUSTOMER) {
    await assertCustomerChatAccess(principal.userId, sessionId);
    return;
  }
  await assertPsychologistChatAccess(principal.accountId, sessionId);
};

export const attachChatSocket = (httpServer: HttpServer): Server => {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN === "*" ? "*" : env.CORS_ORIGIN.split(","),
      credentials: true,
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Client-Platform",
        "X-Test-SuperTokens-User-Id",
      ],
    },
    path: "/socket.io",
  });

  io.use(async (socket, next) => {
    try {
      const principal = await authenticateSocket(socket);
      (socket.data as SocketData).principal = principal;
      next();
    } catch (err) {
      const fail = toAckFail(err);
      next(new Error(`${fail.code}:${fail.message}`));
    }
  });

  io.on("connection", (socket) => {
    socket.on("session:join", async (raw, ack?: (res: Ack<{ sessionId: string; room: string }>) => void) => {
      try {
        const payload = joinPayloadSchema.parse(raw);
        const principal = getPrincipal(socket);
        await assertJoinAccess(principal, payload.sessionId);
        const room = sessionChatRoom(payload.sessionId);
        await socket.join(room);
        ack?.({ ok: true, data: { sessionId: payload.sessionId, room } });
      } catch (err) {
        ack?.(toAckFail(err instanceof z.ZodError ? new HttpError(400, "Validation failed") : err));
      }
    });

    socket.on("message:send", async (raw, ack?: (res: Ack<{ message: ChatMessageDto }>) => void) => {
      try {
        const payload = sendPayloadSchema.parse(raw);
        const principal = getPrincipal(socket);
        const message = await sendChatMessage({
          participant: principal,
          sessionId: payload.sessionId,
          clientMessageId: payload.clientMessageId,
          content: payload.content,
        });
        const room = sessionChatRoom(payload.sessionId);
        await socket.join(room);
        // Persist-then-broadcast: emit only after successful write / idempotent fetch.
        io.to(room).emit("message:new", message);
        ack?.({ ok: true, data: { message } });
      } catch (err) {
        ack?.(toAckFail(err instanceof z.ZodError ? new HttpError(400, "Validation failed") : err));
      }
    });

    socket.on("message:read", async (raw, ack?: (res: Ack<{ message: ChatMessageDto }>) => void) => {
      try {
        const payload = readPayloadSchema.parse(raw);
        const principal = getPrincipal(socket);
        const message = await markChatMessageRead({
          participant: principal,
          sessionId: payload.sessionId,
          messageId: payload.messageId,
        });
        const room = sessionChatRoom(payload.sessionId);
        await socket.join(room);
        io.to(room).emit("message:read", message);
        ack?.({ ok: true, data: { message } });
      } catch (err) {
        ack?.(toAckFail(err instanceof z.ZodError ? new HttpError(400, "Validation failed") : err));
      }
    });
  });

  return io;
};
