-- Psychologist Hours / Today / Brief / After-session fields (extend existing tables)

CREATE TYPE "PsychologistPresence" AS ENUM ('ONLINE', 'AWAY');
CREATE TYPE "SessionRiskLevel" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- Profile: presence + Hours settings
ALTER TABLE "PsychologistProfile"
  ADD COLUMN "presence" "PsychologistPresence" NOT NULL DEFAULT 'ONLINE',
  ADD COLUMN "acceptingNewClients" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "maxSessionsPerDay" INTEGER,
  ADD COLUMN "sessionModes" "CommunicationMode"[] NOT NULL DEFAULT ARRAY[]::"CommunicationMode"[],
  ADD COLUMN "weeklyHours" JSONB;

-- Existing LIVE psychs: offer all modes so discovery/booking is not narrowed by empty default
UPDATE "PsychologistProfile"
SET "sessionModes" = ARRAY['CHAT', 'VOICE', 'VIDEO']::"CommunicationMode"[]
WHERE cardinality("sessionModes") = 0;

CREATE INDEX "PsychologistProfile_publicationStatus_presence_acceptingNewClients_idx"
  ON "PsychologistProfile"("publicationStatus", "presence", "acceptingNewClients");

-- Booking: client privacy opt-ins for psych brief
ALTER TABLE "PsychologistBooking"
  ADD COLUMN "shareSaathiSummary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "shareMoodHistory" BOOLEAN NOT NULL DEFAULT false;

-- Session: private notes + aftercare outcome
ALTER TABLE "PsychologistSession"
  ADD COLUMN "privateNotes" TEXT,
  ADD COLUMN "privateNoteTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "riskLevel" "SessionRiskLevel",
  ADD COLUMN "recommendedAudioIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "followUpRecommended" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "followUpNote" VARCHAR(1000),
  ADD COLUMN "clientFacingNote" VARCHAR(2000),
  ADD COLUMN "aftercareSubmittedAt" TIMESTAMPTZ(6);

CREATE INDEX "PsychologistSession_riskLevel_idx" ON "PsychologistSession"("riskLevel");
