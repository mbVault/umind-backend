-- Phase 2: Mood, Diary, Audio catalogue + User consent/crypto meta

-- AlterTable User
ALTER TABLE "User" ADD COLUMN "shareDiaryWithSaathi" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "shareDiaryConsentVersion" INTEGER;
ALTER TABLE "User" ADD COLUMN "shareDiaryConsentAt" TIMESTAMPTZ(6);
ALTER TABLE "User" ADD COLUMN "diaryKdfSalt" BYTEA;
ALTER TABLE "User" ADD COLUMN "diaryKeyVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateEnum
CREATE TYPE "AudioLanguage" AS ENUM ('HINDI', 'ENGLISH');
CREATE TYPE "AudioPublishStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "AudioCategory" AS ENUM ('STRESS', 'ANXIETY', 'SLEEP', 'FOCUS', 'RELATIONSHIPS', 'BODY', 'HER_CYCLE');

-- CreateTable Mood
CREATE TABLE "Mood" (
    "id" UUID NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    CONSTRAINT "Mood_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Mood_name_key" ON "Mood"("name");

-- CreateTable UserMood
CREATE TABLE "UserMood" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "moodId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "UserMood_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserMood_userId_date_key" ON "UserMood"("userId", "date");

ALTER TABLE "UserMood" ADD CONSTRAINT "UserMood_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserMood" ADD CONSTRAINT "UserMood_moodId_fkey" FOREIGN KEY ("moodId") REFERENCES "Mood"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable DiaryEntry
CREATE TABLE "DiaryEntry" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "entryDate" DATE NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "DiaryEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiaryEntry_userId_entryDate_key" ON "DiaryEntry"("userId", "entryDate");

ALTER TABLE "DiaryEntry" ADD CONSTRAINT "DiaryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable AudioTrack
CREATE TABLE "AudioTrack" (
    "id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1000),
    "category" "AudioCategory" NOT NULL,
    "status" "AudioPublishStatus" NOT NULL DEFAULT 'DRAFT',
    "durationSeconds" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "AudioTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable AudioVersion
CREATE TABLE "AudioVersion" (
    "id" UUID NOT NULL,
    "audioTrackId" UUID NOT NULL,
    "language" "AudioLanguage" NOT NULL,
    "r2ObjectKey" VARCHAR(512) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "durationSeconds" INTEGER,
    "byteSize" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "AudioVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AudioVersion_audioTrackId_language_key" ON "AudioVersion"("audioTrackId", "language");

ALTER TABLE "AudioVersion" ADD CONSTRAINT "AudioVersion_audioTrackId_fkey" FOREIGN KEY ("audioTrackId") REFERENCES "AudioTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable AudioFeelingTag
CREATE TABLE "AudioFeelingTag" (
    "audioTrackId" UUID NOT NULL,
    "feeling" "StartingFeeling" NOT NULL,
    CONSTRAINT "AudioFeelingTag_pkey" PRIMARY KEY ("audioTrackId","feeling")
);

ALTER TABLE "AudioFeelingTag" ADD CONSTRAINT "AudioFeelingTag_audioTrackId_fkey" FOREIGN KEY ("audioTrackId") REFERENCES "AudioTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable AudioLifeStageTarget
CREATE TABLE "AudioLifeStageTarget" (
    "audioTrackId" UUID NOT NULL,
    "lifeStage" "LifeStage" NOT NULL,
    CONSTRAINT "AudioLifeStageTarget_pkey" PRIMARY KEY ("audioTrackId","lifeStage")
);

ALTER TABLE "AudioLifeStageTarget" ADD CONSTRAINT "AudioLifeStageTarget_audioTrackId_fkey" FOREIGN KEY ("audioTrackId") REFERENCES "AudioTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable AudioGenderTarget
CREATE TABLE "AudioGenderTarget" (
    "audioTrackId" UUID NOT NULL,
    "gender" "Gender" NOT NULL,
    CONSTRAINT "AudioGenderTarget_pkey" PRIMARY KEY ("audioTrackId","gender")
);

ALTER TABLE "AudioGenderTarget" ADD CONSTRAINT "AudioGenderTarget_audioTrackId_fkey" FOREIGN KEY ("audioTrackId") REFERENCES "AudioTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed moods (stable UUIDs for local/dev predictability)
INSERT INTO "Mood" ("id", "name") VALUES
  ('a1000000-0000-4000-8000-000000000001', 'Heavy'),
  ('a1000000-0000-4000-8000-000000000002', 'Low'),
  ('a1000000-0000-4000-8000-000000000003', 'Okay'),
  ('a1000000-0000-4000-8000-000000000004', 'Calm'),
  ('a1000000-0000-4000-8000-000000000005', 'Bright');
