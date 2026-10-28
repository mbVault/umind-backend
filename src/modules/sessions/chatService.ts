import {
  CommunicationMode,
  ParticipantRole,
  Prisma,
  PsychologistChatMessage,
  SessionStatus,
} from "@prisma/client";
import { fail } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { getOrCreatePsychologistProfile } from "../staff/psychologistService";

export const CHAT_CONTENT_MAX_CHARS = 4000;
export const CHAT_CLIENT_MESSAGE_ID_MAX_CHARS = 64;

type SessionWithBooking = Prisma.PsychologistSessionGetPayload<{
  include: { booking: true };
}>;

export type ChatParticipant =
  | { role: typeof ParticipantRole.CUSTOMER; userId: string }
  | { role: typeof ParticipantRole.PSYCHOLOGIST; psychologistProfileId: string; accountId: string };

export type ChatMessageDto = {
  id: string;
  sessionId: string;
  senderRole: ParticipantRole;
  senderUserId: string | null;
  senderPsychologistProfileId: string | null;
  content: string;
  clientMessageId: string;
  createdAt: string;
  readAt: string | null;
};

export type ChatHistoryPage = {
  items: ChatMessageDto[];
  nextCursor: string | null;
  hasMore: boolean;
};

type CursorPayload = { createdAt: string; id: string };

const encodeCursor = (createdAt: Date, id: string): string => {
  const payload: CursorPayload = { createdAt: createdAt.toISOString(), id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
};

const decodeCursor = (cursor: string): { createdAt: Date; id: string } => {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as CursorPayload;
    if (!parsed?.createdAt || !parsed?.id || typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") {
      fail(400, "Invalid pagination cursor");
    }
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      fail(400, "Invalid pagination cursor");
    }
    // id must be a UUID for our message ids
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)) {
      fail(400, "Invalid pagination cursor");
    }
    return { createdAt, id: parsed.id };
  } catch (err) {
    if (err && typeof err === "object" && "statusCode" in err) {
      throw err;
    }
    fail(400, "Invalid pagination cursor");
  }
};

export const toChatMessageDto = (row: PsychologistChatMessage): ChatMessageDto => ({
  id: row.id,
  sessionId: row.sessionId,
  senderRole: row.senderRole,
  senderUserId: row.senderUserId,
  senderPsychologistProfileId: row.senderPsychologistProfileId,
  content: row.content,
  clientMessageId: row.clientMessageId,
  createdAt: row.createdAt.toISOString(),
  readAt: row.readAt?.toISOString() ?? null,
});

const isPrismaUniqueViolation = (err: unknown): boolean =>
  typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002";

const normalizeClientMessageId = (raw: string): string => {
  if (typeof raw !== "string") {
    fail(400, "Invalid clientMessageId");
  }
  const id = raw.trim();
  if (!id) {
    fail(400, "clientMessageId is required");
  }
  if (id.length > CHAT_CLIENT_MESSAGE_ID_MAX_CHARS) {
    fail(400, `clientMessageId must be at most ${CHAT_CLIENT_MESSAGE_ID_MAX_CHARS} characters`);
  }
  return id;
};

const resolveSessionForParticipant = async (
  participant: ChatParticipant,
  sessionId: string,
): Promise<{ session: SessionWithBooking; psychologistProfileId?: string }> => {
  if (participant.role === ParticipantRole.CUSTOMER) {
    const session = await assertCustomerChatAccess(participant.userId, sessionId);
    return { session };
  }
  const { session, psychologistProfileId } = await assertPsychologistChatAccess(
    participant.accountId,
    sessionId,
  );
  return { session, psychologistProfileId };
};

const loadSessionWithBooking = async (sessionId: string): Promise<SessionWithBooking> => {
  const session = await prisma.psychologistSession.findUnique({
    where: { id: sessionId },
    include: { booking: true },
  });
  if (!session) {
    fail(404, "Session not found");
  }
  return session;
};

/** Authorize customer against session ownership (404 if not a participant). */
export const assertCustomerChatAccess = async (
  userId: string,
  sessionId: string,
): Promise<SessionWithBooking> => {
  const session = await loadSessionWithBooking(sessionId);
  if (session.booking.userId !== userId) {
    fail(404, "Session not found");
  }
  return session;
};

/** Authorize psychologist account against session ownership via profile. */
export const assertPsychologistChatAccess = async (
  accountId: string,
  sessionId: string,
): Promise<{ session: SessionWithBooking; psychologistProfileId: string }> => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const session = await loadSessionWithBooking(sessionId);
  if (session.booking.psychologistProfileId !== profile.id) {
    fail(404, "Session not found");
  }
  return { session, psychologistProfileId: profile.id };
};

/**
 * Normalize + validate message content for send (Phase 3 / future HTTP).
 * Phase 2 history does not call this.
 */
export const normalizeChatContent = (raw: string): string => {
  if (typeof raw !== "string") {
    fail(400, "Invalid message content");
  }
  if (raw.includes("\u0000")) {
    fail(400, "Invalid message content");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    fail(400, "Message cannot be empty");
  }
  if (trimmed.length > CHAT_CONTENT_MAX_CHARS) {
    fail(400, `Message must be at most ${CHAT_CONTENT_MAX_CHARS} characters`);
  }
  return trimmed;
};

export const assertChatSendAllowed = (session: SessionWithBooking): void => {
  if (session.booking.communicationMode !== CommunicationMode.CHAT) {
    fail(409, "Text chat is only available for CHAT sessions");
  }
  if (session.status !== SessionStatus.IN_PROGRESS) {
    fail(409, "Chat is only available while the session is in progress");
  }
};

/**
 * Cursor-paginated history. Without cursor: latest `limit` messages (ascending).
 * With cursor: older messages strictly before that point (ascending).
 * History is readable for authorized participants regardless of session status/mode.
 */
export const listSessionChatMessages = async (input: {
  sessionId: string;
  limit: number;
  cursor?: string;
}): Promise<ChatHistoryPage> => {
  const take = input.limit;

  const cursorPoint = input.cursor ? decodeCursor(input.cursor) : null;

  const where: Prisma.PsychologistChatMessageWhereInput = {
    sessionId: input.sessionId,
    ...(cursorPoint
      ? {
          OR: [
            { createdAt: { lt: cursorPoint.createdAt } },
            {
              createdAt: cursorPoint.createdAt,
              id: { lt: cursorPoint.id },
            },
          ],
        }
      : {}),
  };

  // Fetch newest-first page (or older-than-cursor), then reverse to chronological ascending.
  const rowsDesc = await prisma.psychologistChatMessage.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
  });

  const hasMore = rowsDesc.length > take;
  const pageDesc = hasMore ? rowsDesc.slice(0, take) : rowsDesc;
  const itemsAsc = [...pageDesc].reverse();

  const oldest = itemsAsc[0];
  const nextCursor = hasMore && oldest ? encodeCursor(oldest.createdAt, oldest.id) : null;

  return {
    items: itemsAsc.map(toChatMessageDto),
    nextCursor,
    hasMore,
  };
};

export const listChatMessagesForCustomer = async (
  userId: string,
  sessionId: string,
  query: { limit: number; cursor?: string },
): Promise<ChatHistoryPage> => {
  await assertCustomerChatAccess(userId, sessionId);
  return listSessionChatMessages({ sessionId, limit: query.limit, cursor: query.cursor });
};

export const listChatMessagesForPsychologist = async (
  accountId: string,
  sessionId: string,
  query: { limit: number; cursor?: string },
): Promise<ChatHistoryPage> => {
  await assertPsychologistChatAccess(accountId, sessionId);
  return listSessionChatMessages({ sessionId, limit: query.limit, cursor: query.cursor });
};

/**
 * Persist a chat message for an authenticated participant.
 * Idempotent on (sessionId, senderRole, clientMessageId).
 * Caller must only broadcast after this succeeds.
 */
export const sendChatMessage = async (input: {
  participant: ChatParticipant;
  sessionId: string;
  clientMessageId: string;
  content: string;
}): Promise<ChatMessageDto> => {
  const clientMessageId = normalizeClientMessageId(input.clientMessageId);
  const content = normalizeChatContent(input.content);
  const { session, psychologistProfileId } = await resolveSessionForParticipant(
    input.participant,
    input.sessionId,
  );
  assertChatSendAllowed(session);

  const senderRole = input.participant.role;
  const senderUserId =
    senderRole === ParticipantRole.CUSTOMER ? input.participant.userId : null;
  const senderPsychologistProfileId =
    senderRole === ParticipantRole.PSYCHOLOGIST
      ? psychologistProfileId ?? input.participant.psychologistProfileId
      : null;

  const existing = await prisma.psychologistChatMessage.findUnique({
    where: {
      sessionId_senderRole_clientMessageId: {
        sessionId: input.sessionId,
        senderRole,
        clientMessageId,
      },
    },
  });
  if (existing) {
    return toChatMessageDto(existing);
  }

  try {
    const row = await prisma.psychologistChatMessage.create({
      data: {
        sessionId: input.sessionId,
        senderRole,
        senderUserId,
        senderPsychologistProfileId,
        content,
        clientMessageId,
      },
    });
    return toChatMessageDto(row);
  } catch (err) {
    // Race: concurrent retry hit unique after our findUnique miss.
    if (!isPrismaUniqueViolation(err)) {
      throw err;
    }
    const raced = await prisma.psychologistChatMessage.findUnique({
      where: {
        sessionId_senderRole_clientMessageId: {
          sessionId: input.sessionId,
          senderRole,
          clientMessageId,
        },
      },
    });
    if (!raced) {
      throw err;
    }
    return toChatMessageDto(raced);
  }
};

/** Recipient marks a message read. Sender cannot forge. Idempotent if already set. */
export const markChatMessageRead = async (input: {
  participant: ChatParticipant;
  sessionId: string;
  messageId: string;
}): Promise<ChatMessageDto> => {
  await resolveSessionForParticipant(input.participant, input.sessionId);

  const message = await prisma.psychologistChatMessage.findFirst({
    where: { id: input.messageId, sessionId: input.sessionId },
  });
  if (!message) {
    fail(404, "Message not found");
  }

  const isOwnMessage =
    (input.participant.role === ParticipantRole.CUSTOMER &&
      message.senderRole === ParticipantRole.CUSTOMER) ||
    (input.participant.role === ParticipantRole.PSYCHOLOGIST &&
      message.senderRole === ParticipantRole.PSYCHOLOGIST);

  if (isOwnMessage) {
    fail(403, "Cannot mark your own message as read");
  }

  if (message.readAt) {
    return toChatMessageDto(message);
  }

  const updated = await prisma.psychologistChatMessage.updateMany({
    where: { id: message.id, sessionId: input.sessionId, readAt: null },
    data: { readAt: new Date() },
  });

  const refreshed = await prisma.psychologistChatMessage.findUniqueOrThrow({
    where: { id: message.id },
  });
  // If another concurrent update won the race, still return persisted row.
  void updated;
  return toChatMessageDto(refreshed);
};

export const sessionChatRoom = (sessionId: string): string => `psych-session:${sessionId}`;
