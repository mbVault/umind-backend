/**
 * Local-only seed: LIVE psychologists + open slots + published audio sample.
 * Safe to re-run — upserts by stable display names / titles.
 *
 *   npx tsx prisma/seedLocalDevCatalogue.ts
 */
import {
  AccountStatus,
  AudioAccessTier,
  AudioCategory,
  AudioLanguage,
  AudioPublishStatus,
  CommunicationMode,
  PsychologistPresence,
  StaffRole,
  VerificationCheckStatus,
} from "@prisma/client";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { prisma } from "../src/lib/prisma";
import { REQUIRED_VERIFICATION_CHECKS } from "../src/modules/staff/permissions";
import { env } from "../src/config/env";
import { buildMelodyWav, MOCK_WEEKEND_LOOPS } from "./lib/mockWav";

const PSYCHS = [
  {
    key: "local-ananya",
    displayName: "Dr. Ananya Rao",
    avatarInitials: "AR",
    avatarColor: "#FFCFB5",
    highestDegree: "Clinical Psychologist",
    yearsPractising: 9,
    specialisations: ["STRESS", "BURNOUT"] as const,
    languages: ["HINDI", "ENGLISH"] as const,
    slotsHoursFromNow: [3, 27, 51],
  },
  {
    key: "local-kabir",
    displayName: "Kabir Mehta",
    avatarInitials: "KM",
    avatarColor: "#D9F5EA",
    highestDegree: "Counselling Psychologist",
    yearsPractising: 6,
    specialisations: ["ANXIETY", "SLEEP"] as const,
    languages: ["HINDI", "ENGLISH", "MARATHI"] as const,
    slotsHoursFromNow: [20, 44, 68],
  },
] as const;

const AUDIO = [
  {
    title: "4-7-8 breath for a racing heart",
    category: AudioCategory.STRESS,
    accessTier: AudioAccessTier.FREE,
    durationSeconds: 240,
    description: "A short paced breath to settle a racing heart.",
  },
  {
    title: "Untangling overthinking",
    category: AudioCategory.ANXIETY,
    accessTier: AudioAccessTier.FREE,
    durationSeconds: 600,
    description: "Name the loop, then loosen it.",
  },
  {
    title: "Sleep, slowly",
    category: AudioCategory.SLEEP,
    accessTier: AudioAccessTier.TRIAL,
    durationSeconds: 1200,
    description: "A longer wind-down for restless nights.",
  },
  {
    title: "Letting go of tomorrow",
    category: AudioCategory.SLEEP,
    accessTier: AudioAccessTier.FREE,
    durationSeconds: 360,
    description: "Park tomorrow’s list until morning.",
  },
  {
    title: "Ghabrahat SOS: 2-minute grounding",
    category: AudioCategory.ANXIETY,
    accessTier: AudioAccessTier.FREE,
    durationSeconds: 120,
    description: "Feet, breath, room — back into the present.",
  },
  {
    title: "Living alone, not lonely",
    category: AudioCategory.RELATIONSHIPS,
    accessTier: AudioAccessTier.SUBSCRIPTION,
    durationSeconds: 420,
    description: "Soft company for evenings by yourself.",
  },
] as const;

const DEFAULT_OPS = {
  presence: PsychologistPresence.ONLINE,
  acceptingNewClients: true,
  maxSessionsPerDay: 8,
  sessionModes: [CommunicationMode.CHAT, CommunicationMode.VOICE, CommunicationMode.VIDEO],
  weeklyHours: {
    mon: [{ start: "09:00", end: "17:00" }],
    tue: [{ start: "09:00", end: "17:00" }],
    wed: [{ start: "09:00", end: "17:00" }],
    thu: [{ start: "09:00", end: "17:00" }],
    fri: [{ start: "09:00", end: "17:00" }],
    sat: [],
    sun: [],
  },
} as const;

async function upsertLivePsych(spec: (typeof PSYCHS)[number]) {
  const existing = await prisma.psychologistProfile.findFirst({
    where: { displayName: spec.displayName, publicationStatus: "LIVE" },
  });
  if (existing) {
    await prisma.psychologistProfile.update({
      where: { id: existing.id },
      data: {
        presence: DEFAULT_OPS.presence,
        acceptingNewClients: DEFAULT_OPS.acceptingNewClients,
        maxSessionsPerDay: DEFAULT_OPS.maxSessionsPerDay,
        sessionModes: [...DEFAULT_OPS.sessionModes],
        weeklyHours: DEFAULT_OPS.weeklyHours,
      },
    });
    await prisma.psychologistAvailabilitySlot.deleteMany({
      where: { psychologistProfileId: existing.id, startsAt: { gt: new Date() } },
    });
    for (const hours of spec.slotsHoursFromNow) {
      const startsAt = new Date(Date.now() + hours * 60 * 60 * 1000);
      const endsAt = new Date(startsAt.getTime() + 40 * 60 * 1000);
      await prisma.psychologistAvailabilitySlot.create({
        data: { psychologistProfileId: existing.id, startsAt, endsAt },
      });
    }
    return existing;
  }

  const account = await prisma.account.create({
    data: {
      superTokensUserId: `st-local-${spec.key}`,
      status: AccountStatus.ACTIVE,
      roles: { create: [{ role: StaffRole.PSYCHOLOGIST }] },
    },
  });

  const profile = await prisma.psychologistProfile.create({
    data: {
      accountId: account.id,
      displayName: spec.displayName,
      avatarInitials: spec.avatarInitials,
      avatarColor: spec.avatarColor,
      highestDegree: spec.highestDegree,
      yearsPractising: spec.yearsPractising,
      publicationStatus: "LIVE",
      accountStatus: "ACTIVE",
      publishedAt: new Date(),
      presence: DEFAULT_OPS.presence,
      acceptingNewClients: DEFAULT_OPS.acceptingNewClients,
      maxSessionsPerDay: DEFAULT_OPS.maxSessionsPerDay,
      sessionModes: [...DEFAULT_OPS.sessionModes],
      weeklyHours: DEFAULT_OPS.weeklyHours,
      specialisations: { create: spec.specialisations.map((code) => ({ code })) },
      languages: { create: spec.languages.map((code) => ({ code })) },
      checks: {
        create: REQUIRED_VERIFICATION_CHECKS.map((type) => ({
          type,
          status: VerificationCheckStatus.VERIFIED,
        })),
      },
    },
  });

  for (const hours of spec.slotsHoursFromNow) {
    const startsAt = new Date(Date.now() + hours * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 40 * 60 * 1000);
    await prisma.psychologistAvailabilitySlot.create({
      data: { psychologistProfileId: profile.id, startsAt, endsAt },
    });
  }

  return profile;
}

async function upsertAudio() {
  const root = env.LOCAL_STORAGE_ROOT || "./.local-storage";
  mkdirSync(root, { recursive: true });

  for (let i = 0; i < AUDIO.length; i++) {
    const track = AUDIO[i]!;
    const loop = MOCK_WEEKEND_LOOPS[i % MOCK_WEEKEND_LOOPS.length]!;
    const wav = buildMelodyWav(loop.melody);
    const durationSeconds = Math.max(
      1,
      Math.round((loop.melody.notes.length * loop.melody.noteMs) / 1000),
    );

    const existing = await prisma.audioTrack.findFirst({ where: { title: track.title } });
    let trackId = existing?.id;
    if (!existing) {
      const created = await prisma.audioTrack.create({
        data: {
          title: track.title,
          description: `${track.description} (local mock: ${loop.label})`,
          category: track.category,
          accessTier: track.accessTier,
          status: AudioPublishStatus.PUBLISHED,
          durationSeconds,
        },
      });
      trackId = created.id;
    } else {
      await prisma.audioTrack.update({
        where: { id: existing.id },
        data: {
          status: AudioPublishStatus.PUBLISHED,
          description: `${track.description} (local mock: ${loop.label})`,
          durationSeconds,
          category: track.category,
          accessTier: track.accessTier,
        },
      });
    }

    for (const language of [AudioLanguage.ENGLISH, AudioLanguage.HINDI]) {
      const objectKey = `audio/${trackId}/${language.toLowerCase()}/${loop.slug}.wav`;
      const abs = join(root, objectKey);
      mkdirSync(join(root, `audio/${trackId}/${language.toLowerCase()}`), { recursive: true });
      writeFileSync(abs, wav);
      writeFileSync(
        `${abs}.meta.json`,
        JSON.stringify({ contentType: "audio/wav", byteSize: wav.byteLength }),
      );

      await prisma.audioVersion.upsert({
        where: { audioTrackId_language: { audioTrackId: trackId!, language } },
        create: {
          audioTrackId: trackId!,
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
  }
}

async function main() {
  for (const p of PSYCHS) {
    const profile = await upsertLivePsych(p);
    console.log(`LIVE psychologist: ${profile.displayName} (${profile.id})`);
  }
  await upsertAudio();
  console.log(
    `Seeded ${AUDIO.length} published tracks with playable mock WAVs (EN + HI) under ${env.LOCAL_STORAGE_ROOT}`,
  );
  console.log("Note: booking requires ACTIVE (paid) subscription; trial unlocks Saathi/audio only.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
