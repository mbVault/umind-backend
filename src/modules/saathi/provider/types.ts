import type { SaathiContextPackage } from "../contextAssembly";

export type LlmChatResult = {
  content: string;
  provider: string;
  model: string;
};

export type LlmReplyMode = "first" | "continue";

export type LlmProvider = {
  readonly name: string;
  generateReply(input: {
    userMessage: string;
    context: SaathiContextPackage;
    /** first = short empathy only (audio is attached separately). */
    mode?: LlmReplyMode;
    primaryAudioTitle?: string | null;
  }): Promise<LlmChatResult>;
};
