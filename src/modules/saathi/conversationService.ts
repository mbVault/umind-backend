import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";

const DEFAULT_TITLE = "New chat";

export const toConversationDto = (row: {
  id: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: row.id,
  title: row.title,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const createConversation = async (userId: string, title?: string | null) => {
  const row = await prisma.saathiConversation.create({
    data: {
      userId,
      title: title?.trim() || DEFAULT_TITLE,
    },
  });
  return toConversationDto(row);
};

export const listConversations = async (
  userId: string,
  input: { page: number; pageSize: number },
) => {
  const where = { userId };
  const [total, rows] = await Promise.all([
    prisma.saathiConversation.count({ where }),
    prisma.saathiConversation.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  return {
    items: rows.map(toConversationDto),
    page: input.page,
    pageSize: input.pageSize,
    total,
  };
};

export const getOwnedConversation = async (userId: string, conversationId: string) => {
  const row = await prisma.saathiConversation.findFirst({
    where: { id: conversationId, userId },
  });
  if (!row) {
    fail(404, "Conversation not found");
  }
  return row;
};

export const getConversationWithMessages = async (
  userId: string,
  conversationId: string,
  input: { page: number; pageSize: number },
) => {
  const conversation = await getOwnedConversation(userId, conversationId);

  const where: Prisma.SaathiMessageWhereInput = {
    conversationId,
    status: "COMPLETED",
  };

  const [total, messages] = await Promise.all([
    prisma.saathiMessage.count({ where }),
    prisma.saathiMessage.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  return {
    conversation: toConversationDto(conversation),
    messages: {
      items: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        status: m.status,
        createdAt: m.createdAt.toISOString(),
      })),
      page: input.page,
      pageSize: input.pageSize,
      total,
    },
  };
};

export const renameConversation = async (userId: string, conversationId: string, title: string) => {
  await getOwnedConversation(userId, conversationId);
  const row = await prisma.saathiConversation.update({
    where: { id: conversationId },
    data: { title: title.trim() },
  });
  return toConversationDto(row);
};

/** Deletes conversation; messages + memory cascade via FK. */
export const deleteConversation = async (userId: string, conversationId: string) => {
  await getOwnedConversation(userId, conversationId);
  await prisma.saathiConversation.delete({ where: { id: conversationId } });
  return { deleted: true as const };
};
