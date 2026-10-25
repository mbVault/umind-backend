import type { SaathiContextPackage } from "../contextAssembly";

export type LlmChatResult = {
  content: string;
  provider: string;
  model: string;
};

export type LlmProvider = {
  readonly name: string;
  generateReply(input: {
    userMessage: string;
    context: SaathiContextPackage;
  }): Promise<LlmChatResult>;
};
