import {
  AudioAccessTier,
  AudioCategory,
  AudioLanguage,
  AudioPublishStatus,
  Gender,
  LifeStage,
  StartingFeeling,
  User,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { assertStorageConfigured, objectStorage } from "../../lib/objectStorage";
import {
  assertCanPlayAudioTier,
  getAudioEntitlementSnapshot,
  userCanAccessAudioTier,
} from "./audioAccess";

const trackInclude = {
  versions: true,
  feelingTags: true,
  lifeStageTargets: true,
  genderTargets: true,
} as const;

export const matchesTargeting = (
  track: {
    feelingTags: { feeling: StartingFeeling }[];
    lifeStageTargets: { lifeStage: LifeStage }[];
    genderTargets: { gender: Gender }[];
  },
  user: Pick<User, "lifeStage" | "gender" | "startingFeelings">,
  filters?: {
    feeling?: StartingFeeling;
    lifeStage?: LifeStage;
    gender?: Gender;
  },
): boolean => {
  const feelings = filters?.feeling ? [filters.feeling] : user.startingFeelings;
  const lifeStage = filters?.lifeStage ?? user.lifeStage;
  const gender = filters?.gender ?? user.gender;

  if (track.feelingTags.length > 0 && !track.feelingTags.some((t) => feelings.includes(t.feeling))) {
    return false;
  }
  if (track.lifeStageTargets.length > 0 && !track.lifeStageTargets.some((t) => t.lifeStage === lifeStage)) {
    return false;
  }
  if (track.genderTargets.length > 0 && !track.genderTargets.some((t) => t.gender === gender)) {
    return false;
  }
  return true;
};

export const preferredAudioLanguage = (saathiLanguage: string): AudioLanguage => {
  if (saathiLanguage === "HINDI") return AudioLanguage.HINDI;
  return AudioLanguage.ENGLISH;
};

export const listPublishedAudio = async (
  user: User,
  query: {
    language?: AudioLanguage;
    category?: AudioCategory;
    feeling?: StartingFeeling;
    lifeStage?: LifeStage;
    gender?: Gender;
    q?: string;
  },
) => {
  const language = query.language ?? preferredAudioLanguage(user.saathiLanguage);
  const snap = await getAudioEntitlementSnapshot(user.id);
  const tracks = await prisma.audioTrack.findMany({
    where: {
      status: AudioPublishStatus.PUBLISHED,
      ...(query.category ? { category: query.category } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: "insensitive" } },
              { description: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
      versions: { some: { language } },
    },
    include: trackInclude,
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const items = tracks
    .filter((t) => matchesTargeting(t, user, query))
    .filter((t) => userCanAccessAudioTier(t.accessTier, snap))
    .map((t) => {
      const version = t.versions.find((v) => v.language === language)!;
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        category: t.category,
        accessTier: t.accessTier,
        durationSeconds: version.durationSeconds ?? t.durationSeconds,
        language,
      };
    });

  return { items };
};

export const getPublishedTrack = async (user: User, trackId: string) => {
  const track = await prisma.audioTrack.findFirst({
    where: { id: trackId, status: AudioPublishStatus.PUBLISHED },
    include: trackInclude,
  });
  if (!track || !matchesTargeting(track, user)) {
    fail(404, "Audio track not found");
  }
  await assertCanPlayAudioTier(user, track.accessTier);
  return {
    id: track.id,
    title: track.title,
    description: track.description,
    category: track.category,
    accessTier: track.accessTier,
    durationSeconds: track.durationSeconds,
    languages: track.versions.map((v) => ({
      language: v.language,
      durationSeconds: v.durationSeconds ?? track.durationSeconds,
    })),
  };
};

export const createPlaybackUrl = async (user: User, trackId: string, language: AudioLanguage) => {
  assertStorageConfigured();
  const track = await prisma.audioTrack.findFirst({
    where: { id: trackId, status: AudioPublishStatus.PUBLISHED },
    include: trackInclude,
  });
  if (!track || !matchesTargeting(track, user)) {
    fail(404, "Audio track not found");
  }
  await assertCanPlayAudioTier(user, track.accessTier);
  const version = track.versions.find((v) => v.language === language);
  if (!version) {
    fail(404, "Audio version not found for language");
  }
  const signed = await objectStorage.createViewUrl(version.r2ObjectKey);
  return {
    trackId: track.id,
    language,
    playbackUrl: signed.url,
    expiresAt: signed.expiresAt.toISOString(),
  };
};

export const recommendAudioForUser = async (
  user: User,
  opts?: { limit?: number; skip?: boolean },
): Promise<
  {
    trackId: string;
    title: string;
    category: AudioCategory;
    language: AudioLanguage;
    accessTier: AudioAccessTier;
  }[]
> => {
  if (opts?.skip) return [];
  const language = preferredAudioLanguage(user.saathiLanguage);
  const snap = await getAudioEntitlementSnapshot(user.id);
  const tracks = await prisma.audioTrack.findMany({
    where: {
      status: AudioPublishStatus.PUBLISHED,
      versions: { some: { language } },
    },
    include: trackInclude,
    orderBy: { updatedAt: "desc" },
    take: 40,
  });

  const limit = opts?.limit ?? 3;
  return tracks
    .filter((t) => matchesTargeting(t, user))
    .filter((t) => userCanAccessAudioTier(t.accessTier, snap))
    .slice(0, limit)
    .map((t) => ({
      trackId: t.id,
      title: t.title,
      category: t.category,
      language,
      accessTier: t.accessTier,
    }));
};
