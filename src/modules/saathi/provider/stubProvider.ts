import type { LlmProvider } from "./types";

/** Deterministic local provider for tests/dev when no external LLM is configured. */
export const stubSaathiProvider: LlmProvider = {
  name: "stub",
  async generateReply({ userMessage, context }) {
    const lang = context.profile.saathiLanguage;
    const feelings = context.profile.startingFeelings.join(", ") || "whatever you're carrying";
    const moodBit = context.currentMood ? ` Mood today: ${context.currentMood}.` : "";
    const diaryBit = context.diaryContext
      ? ` Reflecting on diary (${context.diaryContext.entryDate}): ${context.diaryContext.body.slice(0, 160)}`
      : "";
    const hinglish =
      lang === "HINGLISH" || lang === "HINDI"
        ? `Hey ${context.profile.alias}. Maine suna — "${userMessage.slice(0, 120)}".${moodBit}${diaryBit} Yeh heavy ho sakta hai. Pehle ek slow breath: 4 counts in, 6 out. Aap ${feelings.toLowerCase()} se deal kar rahe ho; main yahan hoon, bina judgment. Agar chaaho to batao — vent karna hai, plan banana hai, ya psychologist ke baare mein sochna hai?`
        : `Hi ${context.profile.alias}. I hear you: "${userMessage.slice(0, 120)}".${moodBit}${diaryBit} That can feel heavy. Let's start with one slow breath — 4 in, 6 out. You've shared concerns around ${feelings.toLowerCase()}; I'm here without judgment. Would you like to vent, make a small plan, or talk about seeing a psychologist?`;

    return {
      content: hinglish,
      provider: "stub",
      model: "stub-v1",
    };
  },
};
