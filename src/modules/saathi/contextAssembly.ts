import { User } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export type SaathiDiaryContext = {
  entryDate: string;
  causes: string[];
  prompt?: string;
  body: string;
};

export type SaathiContextPackage = {
  profile: {
    alias: string;
    lifeStage: string;
    gender: string;
    city: string;
    startingFeelings: string[];
    saathiLanguage: string;
    saathiCheckIn: string;
    unwindHabits: string[];
  };
  currentMood: string | null;
  diaryContext: SaathiDiaryContext | null;
  currentMessages: { role: "USER" | "ASSISTANT"; content: string }[];
  crossChatMemories: { conversationId: string; summary: string }[];
  safetyInstructions: string[];
};

const MAX_CURRENT_MESSAGES = 20;
const MAX_CROSS_CHAT_MEMORIES = 5;
const MAX_MEMORY_CHARS = 400;

export const assembleSaathiContext = async (input: {
  user: User;
  conversationId: string;
  currentMood: string | null;
  diaryContext?: SaathiDiaryContext | null;
}): Promise<SaathiContextPackage> => {
  const current = await prisma.saathiMessage.findMany({
    where: {
      conversationId: input.conversationId,
      status: "COMPLETED",
    },
    orderBy: { createdAt: "desc" },
    take: MAX_CURRENT_MESSAGES,
    select: { role: true, content: true },
  });

  const memories = await prisma.saathiMemory.findMany({
    where: {
      conversation: { userId: input.user.id },
      NOT: { conversationId: input.conversationId },
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_CROSS_CHAT_MEMORIES,
    select: { conversationId: true, summary: true },
  });

  const moodLine = input.currentMood
    ? `The user's mood check-in for today is "${input.currentMood}". Adapt tone gently to that state; never treat it as a diagnosis.`
    : "No mood check-in for today — do not invent one.";

  const diaryLine = input.diaryContext
    ? "The user explicitly reflected one diary entry in this turn. Use only that entry; do not invent other diary content. Do not ask to store it."
    : "No diary entry was shared this turn.";

  return {
    profile: {
      alias: input.user.alias,
      lifeStage: input.user.lifeStage,
      gender: input.user.gender,
      city: input.user.city,
      startingFeelings: input.user.startingFeelings,
      saathiLanguage: input.user.saathiLanguage,
      saathiCheckIn: input.user.saathiCheckIn,
      unwindHabits: input.user.unwindHabits,
    },
    currentMood: input.currentMood,
    diaryContext: input.diaryContext ?? null,
    currentMessages: current.reverse().map((m) => ({
      role: m.role,
      content: m.content,
    })),
    crossChatMemories: memories.map((m) => ({
      conversationId: m.conversationId,
      summary: m.summary.slice(0, MAX_MEMORY_CHARS),
    })),
    safetyInstructions: [
      "You are Saathi, U Mind's mental-wellness companion — not a doctor or therapist.",
      "Never diagnose, prescribe, or claim active human monitoring.",
      "Stay in mental-wellness scope; refuse trivia, marriage predictions, media recs, coding help.",
      "Respond in the user's preferred language when possible (Hindi, English, or Hinglish).",
      "Calm the body first, then reflect feelings, then suggest a next step.",
      moodLine,
      diaryLine,
      "You may gently suggest listening to a short guided audio when appropriate; do not invent track IDs.",
    ],
  };
};
