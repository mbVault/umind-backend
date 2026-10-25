import { env } from "../../../config/env";
import { openaiSaathiProvider } from "./openaiProvider";
import { stubSaathiProvider } from "./stubProvider";
import type { LlmProvider } from "./types";

export const getSaathiLlmProvider = (): LlmProvider => {
  if (env.SAATHI_LLM_PROVIDER === "openai") {
    return openaiSaathiProvider;
  }
  return stubSaathiProvider;
};

export type { LlmProvider, LlmChatResult } from "./types";
