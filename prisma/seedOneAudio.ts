/**
 * Seed exactly one published FREE listen track for local Listen playback.
 * Safe to re-run — upserts by stable title.
 *
 *   npx tsx prisma/seedOneAudio.ts
 */
import {
  AudioAccessTier,
  AudioCategory,
  AudioLanguage,
  AudioPublishStatus,
} from "@prisma/client";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { buildMelodyWav, MOCK_WEEKEND_LOOPS } from "./lib/mockWav";

const TITLE = "4-7-8 breath for a racing heart";
const LOOP = MOCK_WEEKEND_LOOPS[0]!;

async function main() {
  const root = env.LOCAL_STORAGE_ROOT || "./.local-storage";
  mkdirSync(root, { recursive: true });

  const wav = buildMelodyWav(LOOP.melody);
  const durationSeconds = Math.max(
    1,
    Math.round((LOOP.melody.notes.length * LOOP.melody.noteMs) / 1000),
  );

  const existing = await prisma.audioTrack.findFirst({ where: { title: TITLE } });
  const track =
    existing ??
    (await prisma.audioTrack.create({
      data: {
        title: TITLE,
        description: `A short paced breath to settle a racing heart. (local mock: ${LOOP.label})`,
        category: AudioCategory.STRESS,
        accessTier: AudioAccessTier.FREE,
        status: AudioPublishStatus.PUBLISHED,
        durationSeconds,
      },
    }));

  if (existing) {
    await prisma.audioTrack.update({
      where: { id: existing.id },
      data: {
        description: `A short paced breath to settle a racing heart. (local mock: ${LOOP.label})`,
        category: AudioCategory.STRESS,
        accessTier: AudioAccessTier.FREE,
        status: AudioPublishStatus.PUBLISHED,
        durationSeconds,
      },
    });
  }

  // No feeling / life-stage / gender targets → visible to every signed-in user.
  await prisma.audioFeelingTag.deleteMany({ where: { audioTrackId: track.id } });
  await prisma.audioLifeStageTarget.deleteMany({ where: { audioTrackId: track.id } });
  await prisma.audioGenderTarget.deleteMany({ where: { audioTrackId: track.id } });

  for (const language of [AudioLanguage.ENGLISH, AudioLanguage.HINDI]) {
    const objectKey = `audio/${track.id}/${language.toLowerCase()}/${LOOP.slug}.wav`;
    const abs = join(root, objectKey);
    mkdirSync(join(root, `audio/${track.id}/${language.toLowerCase()}`), { recursive: true });
    writeFileSync(abs, wav);
    writeFileSync(
      `${abs}.meta.json`,
      JSON.stringify({ contentType: "audio/wav", byteSize: wav.byteLength }),
    );

    await prisma.audioVersion.upsert({
      where: { audioTrackId_language: { audioTrackId: track.id, language } },
      create: {
        audioTrackId: track.id,
        language,
        r2ObjectKey: objectKey,
        mimeType: "audio/wav",
        durationSeconds,
        byteSize: wav.byteLength,
      },
      update: {
        r2ObjectKey: objectKey,
        mimeType: "audio/wav",
        durationSeconds,
        byteSize: wav.byteLength,
      },
    });
  }

  const verify = await prisma.audioTrack.findUnique({
    where: { id: track.id },
    include: { versions: true, feelingTags: true, lifeStageTargets: true, genderTargets: true },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        trackId: verify?.id,
        title: verify?.title,
        status: verify?.status,
        accessTier: verify?.accessTier,
        category: verify?.category,
        durationSeconds: verify?.durationSeconds,
        versions: verify?.versions.map((v) => ({
          language: v.language,
          r2ObjectKey: v.r2ObjectKey,
          byteSize: v.byteSize,
        })),
        targetingEmpty: {
          feelings: verify?.feelingTags.length === 0,
          lifeStages: verify?.lifeStageTargets.length === 0,
          genders: verify?.genderTargets.length === 0,
        },
        storageRoot: root,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
