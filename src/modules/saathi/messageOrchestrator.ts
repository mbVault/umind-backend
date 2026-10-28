import { SaathiMessageRole, SaathiMessageStatus, User } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { resolveClientLocalDate } from "../../lib/localDates";
import { recommendAudioForUser } from "../audio/audioQuery";
import { getMoodNameForDate } from "../mood/moodService";
import { assembleSaathiContext, SaathiDiaryContext } from "./contextAssembly";
import { getOwnedConversation } from "./conversationService";
import { INDIA_CRISIS_RESOURCES } from "./crisisResources";
import { buildFirstReplyEmpathyText, pickFirstReplyAudio } from "./firstReply";
import { maybeUpsertConversationMemory } from "./memoryService";
import { getSaathiLlmProvider } from "./provider";
import { assertSaathiMessageRateLimit } from "./rateLimit";
import { assertSaathiAccess } from "./saathiAccess";
import { assessSafety, shouldPersistWellnessMemory } from "./safetyService";

const MAX_CONTENT = 4000;

export const sendSaathiMessage = async (input: {
  user: User;
  conversationId: string;
  content: string;
  diaryContext?: SaathiDiaryContext;
  clientLocalDate?: string | null;
  clientTimezone?: string | null;
  idempotencyKey?: string;
}) => {
  await assertSaathiAccess(input.user);
  assertSaathiMessageRateLimit(input.user.id);

  const content = input.content.trim();
  if (!content) {
    fail(400, "Validation failed", { content: ["Message cannot be empty"] });
  }
  if (content.length > MAX_CONTENT) {
    fail(400, "Validation failed", { content: [`Message must be at most ${MAX_CONTENT} characters`] });
  }

  let diaryContext: SaathiDiaryContext | undefined;
  if (input.diaryContext) {
    if (!input.user.shareDiaryWithSaathi) {
      fail(403, "Diary sharing with Saathi is disabled");
    }
    diaryContext = input.diaryContext;
  }

  const conversation = await getOwnedConversation(input.user.id, input.conversationId);

  const localDate = resolveClientLocalDate({
    localDate: input.clientLocalDate,
    timezone: input.clientTimezone,
  });
  const currentMood = await getMoodNameForDate(input.user.id, localDate);

  if (input.idempotencyKey) {
    const recent = await prisma.saathiMessage.findFirst({
      where: {
        conversationId: conversation.id,
        role: SaathiMessageRole.USER,
        content,
        status: SaathiMessageStatus.COMPLETED,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (recent) {
      const assistant = await prisma.saathiMessage.findFirst({
        where: {
          conversationId: conversation.id,
          role: SaathiMessageRole.ASSISTANT,
          status: SaathiMessageStatus.COMPLETED,
          createdAt: { gt: recent.createdAt },
        },
        orderBy: { createdAt: "asc" },
      });
      if (assistant) {
        return {
          userMessage: messageDto(recent),
          assistantMessage: messageDto(assistant),
          safetyLevel: "NORMAL" as const,
          crisisResources: [],
          audioRecommendations: [] as Awaited<ReturnType<typeof recommendAudioForUser>>,
          isFirstAssistantReply: false,
          deduped: true as const,
        };
      }
    }
  }

  const priorAssistantCount = await prisma.saathiMessage.count({
    where: {
      conversationId: conversation.id,
      role: SaathiMessageRole.ASSISTANT,
      status: SaathiMessageStatus.COMPLETED,
    },
  });
  const isFirstAssistantReply = priorAssistantCount === 0;

  const recentUser = await prisma.saathiMessage.findMany({
    where: {
      conversationId: conversation.id,
      role: SaathiMessageRole.USER,
      status: SaathiMessageStatus.COMPLETED,
    },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: { content: true },
  });

  const safety = assessSafety(
    content,
    recentUser.map((m) => m.content),
  );

  const userMessage = await prisma.saathiMessage.create({
    data: {
      conversationId: conversation.id,
      role: SaathiMessageRole.USER,
      content,
      status: SaathiMessageStatus.COMPLETED,
    },
  });

  const pendingAssistant = await prisma.saathiMessage.create({
    data: {
      conversationId: conversation.id,
      role: SaathiMessageRole.ASSISTANT,
      content: "",
      status: SaathiMessageStatus.PENDING,
    },
  });

  await prisma.saathiConversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  try {
    let reply: string;
    let safetyLevel = safety.level;
    let audioRecommendations: Awaited<ReturnType<typeof recommendAudioForUser>> = [];

    const crisisSafety =
      safety.level === "IMMEDIATE" || safety.level === "OUT_OF_SCOPE" || safety.level === "ELEVATED";

    if (crisisSafety) {
      reply = safety.suggestedReply ?? "I'm here with you.";
      // Crisis / out-of-scope: no audio push on first or later turns.
      audioRecommendations = [];
    } else if (isFirstAssistantReply) {
      // Product rule: first AI reply = matched listen + short empathy text.
      audioRecommendations = await pickFirstReplyAudio(input.user, content);
      const primaryTitle = audioRecommendations[0]?.title ?? null;
      const context = await assembleSaathiContext({
        user: input.user,
        conversationId: conversation.id,
        currentMood,
        diaryContext: diaryContext ?? null,
      });
      try {
        const llm = getSaathiLlmProvider();
        const generated = await llm.generateReply({
          userMessage: content,
          context,
          mode: "first",
          primaryAudioTitle: primaryTitle,
        });
        reply = generated.content;
      } catch {
        reply = buildFirstReplyEmpathyText({
          alias: input.user.alias,
          language: input.user.saathiLanguage,
          userMessage: content,
          audioTitle: primaryTitle,
        });
      }
      safetyLevel = "NORMAL";
    } else {
      const context = await assembleSaathiContext({
        user: input.user,
        conversationId: conversation.id,
        currentMood,
        diaryContext: diaryContext ?? null,
      });
      const llm = getSaathiLlmProvider();
      const generated = await llm.generateReply({
        userMessage: content,
        context,
        mode: "continue",
      });
      reply = generated.content;
      safetyLevel = "NORMAL";
      audioRecommendations = await recommendAudioForUser(input.user, { limit: 3 });
    }

    const assistantMessage = await prisma.saathiMessage.update({
      where: { id: pendingAssistant.id },
      data: {
        content: reply,
        status: SaathiMessageStatus.COMPLETED,
      },
    });

    if (conversation.title === "New chat" || !conversation.title) {
      const autoTitle = content.slice(0, 60) + (content.length > 60 ? "…" : "");
      await prisma.saathiConversation.update({
        where: { id: conversation.id },
        data: { title: autoTitle },
      });
    }

    // Never persist diary-derived memory; Reflect turns skip wellness memory entirely.
    await maybeUpsertConversationMemory({
      conversationId: conversation.id,
      userMessage: content,
      assistantMessage: reply,
      allowPersist: !diaryContext && shouldPersistWellnessMemory(safety),
    });

    const crisis = safetyLevel === "IMMEDIATE" || safetyLevel === "ELEVATED";

    return {
      userMessage: messageDto(userMessage),
      assistantMessage: messageDto(assistantMessage),
      safetyLevel,
      crisisResources: crisis ? INDIA_CRISIS_RESOURCES : [],
      audioRecommendations,
      isFirstAssistantReply,
      deduped: false as const,
    };
  } catch (err) {
    await prisma.saathiMessage.update({
      where: { id: pendingAssistant.id },
      data: {
        status: SaathiMessageStatus.FAILED,
        content: "",
      },
    });
    throw err;
  }
};

const messageDto = (m: {
  id: string;
  role: SaathiMessageRole;
  content: string;
  status: SaathiMessageStatus;
  createdAt: Date;
}) => ({
  id: m.id,
  role: m.role,
  content: m.content,
  status: m.status,
  createdAt: m.createdAt.toISOString(),
});
