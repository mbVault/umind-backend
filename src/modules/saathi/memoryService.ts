import { prisma } from "../../lib/prisma";

const MAX_SUMMARY = 600;

/** Selective memory: only after enough completed turns; skips out-of-scope noise. */
export const maybeUpsertConversationMemory = async (input: {
  conversationId: string;
  userMessage: string;
  assistantMessage: string;
  allowPersist: boolean;
}): Promise<void> => {
  if (!input.allowPersist) {
    return;
  }

  const completedCount = await prisma.saathiMessage.count({
    where: { conversationId: input.conversationId, status: "COMPLETED" },
  });
  if (completedCount < 4) {
    return;
  }

  const summary = [
    `User shared: ${input.userMessage.slice(0, 200)}`,
    `Saathi reflected/suggested: ${input.assistantMessage.slice(0, 200)}`,
  ]
    .join(" | ")
    .slice(0, MAX_SUMMARY);

  await prisma.saathiMemory.upsert({
    where: { conversationId: input.conversationId },
    create: { conversationId: input.conversationId, summary },
    update: { summary },
  });
};
