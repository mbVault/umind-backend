-- Psychologist–client session chat (CHAT mode). New table only; no existing-table ALTERs.

CREATE TABLE "PsychologistChatMessage" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "senderRole" "ParticipantRole" NOT NULL,
    "senderUserId" UUID,
    "senderPsychologistProfileId" UUID,
    "content" TEXT NOT NULL,
    "clientMessageId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(6),

    CONSTRAINT "PsychologistChatMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PsychologistChatMessage_sender_identity_check" CHECK (
        (
            "senderRole" = 'CUSTOMER'
            AND "senderUserId" IS NOT NULL
            AND "senderPsychologistProfileId" IS NULL
        )
        OR
        (
            "senderRole" = 'PSYCHOLOGIST'
            AND "senderPsychologistProfileId" IS NOT NULL
            AND "senderUserId" IS NULL
        )
    )
);

CREATE INDEX "PsychologistChatMessage_sessionId_createdAt_id_idx" ON "PsychologistChatMessage"("sessionId", "createdAt", "id");

CREATE UNIQUE INDEX "PsychologistChatMessage_sessionId_senderRole_clientMessageI_key" ON "PsychologistChatMessage"("sessionId", "senderRole", "clientMessageId");

ALTER TABLE "PsychologistChatMessage" ADD CONSTRAINT "PsychologistChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PsychologistSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PsychologistChatMessage" ADD CONSTRAINT "PsychologistChatMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PsychologistChatMessage" ADD CONSTRAINT "PsychologistChatMessage_senderPsychologistProfileId_fkey" FOREIGN KEY ("senderPsychologistProfileId") REFERENCES "PsychologistProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
