-- Per-track audio unlock (FREE / TRIAL / SUBSCRIPTION)

CREATE TYPE "AudioAccessTier" AS ENUM ('FREE', 'TRIAL', 'SUBSCRIPTION');

ALTER TABLE "AudioTrack" ADD COLUMN "accessTier" "AudioAccessTier" NOT NULL DEFAULT 'TRIAL';
