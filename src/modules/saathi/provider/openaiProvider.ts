import { env } from "../../../config/env";
import { fail } from "../../../lib/errors";
import type { LlmProvider } from "./types";

type OpenAiChatResponse = {
  choices?: { message?: { content?: string } }[];
};

export const openaiSaathiProvider: LlmProvider = {
  name: "openai",
  async generateReply({ userMessage, context }) {
    if (!env.OPENAI_API_KEY) {
      fail(503, "LLM provider is not configured");
    }

    const system = [
      ...context.safetyInstructions,
      `User alias: ${context.profile.alias}`,
      `Life stage: ${context.profile.lifeStage}`,
      `Gender: ${context.profile.gender}`,
      `City: ${context.profile.city || "unknown"}`,
      `Preferred language: ${context.profile.saathiLanguage}`,
      `Check-in preference: ${context.profile.saathiCheckIn}`,
      `Onboarding feelings: ${context.profile.startingFeelings.join(", ") || "none"}`,
      `Unwind habits: ${context.profile.unwindHabits.join(", ") || "none"}`,
      context.currentMood ? `Today's mood check-in: ${context.currentMood}` : "Today's mood check-in: none",
      context.diaryContext
        ? `Reflect diary (${context.diaryContext.entryDate}): causes=${context.diaryContext.causes.join(", ") || "none"}; prompt=${context.diaryContext.prompt || "none"}; body=${context.diaryContext.body}`
        : "No diary reflection this turn.",
      context.crossChatMemories.length
        ? `Prior chat summaries (not diagnoses):\n${context.crossChatMemories.map((m) => `- ${m.summary}`).join("\n")}`
        : "No prior chat summaries.",
    ].join("\n");

    const history = context.currentMessages.map((m) => ({
      role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.SAATHI_LLM_TIMEOUT_MS);

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: env.SAATHI_LLM_MODEL,
          temperature: 0.6,
          max_tokens: 500,
          messages: [{ role: "system", content: system }, ...history, { role: "user", content: userMessage }],
        }),
      });

      if (!res.ok) {
        fail(502, "LLM provider request failed");
      }

      const data = (await res.json()) as OpenAiChatResponse;
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        fail(502, "LLM provider returned an empty response");
      }

      return {
        content: content!,
        provider: "openai",
        model: env.SAATHI_LLM_MODEL,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        fail(504, "LLM provider timed out");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  },
};
