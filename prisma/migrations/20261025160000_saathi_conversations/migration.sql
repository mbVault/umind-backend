-- Saathi AI companion: conversations, messages, per-conversation memory

CREATE TYPE "SaathiMessageRole" AS ENUM ('USER', 'ASSISTANT');
CREATE TYPE "SaathiMessageStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

CREATE TABLE "SaathiConversation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SaathiConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaathiMessage" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" "SaathiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "SaathiMessageStatus" NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaathiMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaathiMemory" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SaathiMemory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SaathiConversation_userId_updatedAt_idx" ON "SaathiConversation"("userId", "updatedAt");
CREATE INDEX "SaathiMessage_conversationId_createdAt_idx" ON "SaathiMessage"("conversationId", "createdAt");
CREATE UNIQUE INDEX "SaathiMemory_conversationId_key" ON "SaathiMemory"("conversationId");

ALTER TABLE "SaathiConversation" ADD CONSTRAINT "SaathiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaathiMessage" ADD CONSTRAINT "SaathiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SaathiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaathiMemory" ADD CONSTRAINT "SaathiMemory_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SaathiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
