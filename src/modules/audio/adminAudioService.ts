import {
  AudioAccessTier,
  AudioCategory,
  AudioLanguage,
  AudioPublishStatus,
  Gender,
  LifeStage,
  StartingFeeling,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { assertStorageConfigured, objectStorage } from "../../lib/objectStorage";

const ALLOWED_AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav", "audio/ogg"]);

const trackInclude = {
  versions: true,
  feelingTags: true,
  lifeStageTargets: true,
  genderTargets: true,
} as const;

const toAdminDto = (t: {
  id: string;
  title: string;
  description: string | null;
  category: AudioCategory;
  status: AudioPublishStatus;
  accessTier: AudioAccessTier;
  durationSeconds: number | null;
  createdAt: Date;
  updatedAt: Date;
  versions: {
    id: string;
    language: AudioLanguage;
    r2ObjectKey: string;
    mimeType: string;
    durationSeconds: number | null;
    byteSize: number | null;
  }[];
  feelingTags: { feeling: StartingFeeling }[];
  lifeStageTargets: { lifeStage: LifeStage }[];
  genderTargets: { gender: Gender }[];
}) => ({
  id: t.id,
  title: t.title,
  description: t.description,
  category: t.category,
  status: t.status,
  accessTier: t.accessTier,
  durationSeconds: t.durationSeconds,
  feelingTags: t.feelingTags.map((f) => f.feeling),
  lifeStageTargets: t.lifeStageTargets.map((f) => f.lifeStage),
  genderTargets: t.genderTargets.map((f) => f.gender),
  versions: t.versions.map((v) => ({
    id: v.id,
    language: v.language,
    objectKey: v.r2ObjectKey,
    mimeType: v.mimeType,
    durationSeconds: v.durationSeconds,
    byteSize: v.byteSize,
  })),
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});

const replaceJoins = async (
  trackId: string,
  input: {
    feelingTags?: StartingFeeling[];
    lifeStageTargets?: LifeStage[];
    genderTargets?: Gender[];
  },
) => {
  if (input.feelingTags) {
    await prisma.audioFeelingTag.deleteMany({ where: { audioTrackId: trackId } });
    if (input.feelingTags.length) {
      await prisma.audioFeelingTag.createMany({
        data: input.feelingTags.map((feeling) => ({ audioTrackId: trackId, feeling })),
      });
    }
  }
  if (input.lifeStageTargets) {
    await prisma.audioLifeStageTarget.deleteMany({ where: { audioTrackId: trackId } });
    if (input.lifeStageTargets.length) {
      await prisma.audioLifeStageTarget.createMany({
        data: input.lifeStageTargets.map((lifeStage) => ({ audioTrackId: trackId, lifeStage })),
      });
    }
  }
  if (input.genderTargets) {
    await prisma.audioGenderTarget.deleteMany({ where: { audioTrackId: trackId } });
    if (input.genderTargets.length) {
      await prisma.audioGenderTarget.createMany({
        data: input.genderTargets.map((gender) => ({ audioTrackId: trackId, gender })),
      });
    }
  }
};

export const adminListTracks = async () => {
  const tracks = await prisma.audioTrack.findMany({
    include: trackInclude,
    orderBy: { updatedAt: "desc" },
  });
  return { items: tracks.map(toAdminDto) };
};

export const adminGetTrack = async (trackId: string) => {
  const track = await prisma.audioTrack.findUnique({ where: { id: trackId }, include: trackInclude });
  if (!track) fail(404, "Audio track not found");
  return toAdminDto(track);
};

export const adminCreateTrack = async (input: {
  title: string;
  description?: string | null;
  category: AudioCategory;
  accessTier?: AudioAccessTier;
  durationSeconds?: number | null;
  feelingTags?: StartingFeeling[];
  lifeStageTargets?: LifeStage[];
  genderTargets?: Gender[];
}) => {
  const track = await prisma.audioTrack.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      category: input.category,
      accessTier: input.accessTier ?? AudioAccessTier.TRIAL,
      durationSeconds: input.durationSeconds ?? null,
      status: AudioPublishStatus.DRAFT,
    },
  });
  await replaceJoins(track.id, input);
  return adminGetTrack(track.id);
};

export const adminPatchTrack = async (
  trackId: string,
  input: {
    title?: string;
    description?: string | null;
    category?: AudioCategory;
    status?: AudioPublishStatus;
    accessTier?: AudioAccessTier;
    durationSeconds?: number | null;
    feelingTags?: StartingFeeling[];
    lifeStageTargets?: LifeStage[];
    genderTargets?: Gender[];
  },
) => {
  const existing = await prisma.audioTrack.findUnique({ where: { id: trackId } });
  if (!existing) fail(404, "Audio track not found");

  if (input.status === AudioPublishStatus.PUBLISHED) {
    const versions = await prisma.audioVersion.count({ where: { audioTrackId: trackId } });
    if (versions === 0) {
      fail(400, "Cannot publish a track without at least one language version");
    }
  }

  await prisma.audioTrack.update({
    where: { id: trackId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.accessTier !== undefined ? { accessTier: input.accessTier } : {}),
      ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}),
    },
  });
  await replaceJoins(trackId, input);
  return adminGetTrack(trackId);
};

export const adminDeleteTrack = async (trackId: string) => {
  const existing = await prisma.audioTrack.findUnique({ where: { id: trackId } });
  if (!existing) fail(404, "Audio track not found");
  await prisma.audioTrack.delete({ where: { id: trackId } });
  return { deleted: true as const };
};

export const adminCreateVersionUploadUrl = async (input: {
  trackId: string;
  language: AudioLanguage;
  contentType: string;
  byteSize: number;
}) => {
  assertStorageConfigured();
  const track = await prisma.audioTrack.findUnique({ where: { id: input.trackId } });
  if (!track) fail(404, "Audio track not found");
  if (!ALLOWED_AUDIO_TYPES.has(input.contentType)) {
    fail(400, "Validation failed", { contentType: ["Unsupported audio content type"] });
  }

  const objectKey = `audio/${input.trackId}/${input.language.toLowerCase()}/${randomUUID()}`;
  const signed = await objectStorage.createUploadUrl({
    objectKey,
    contentType: input.contentType,
    byteSize: input.byteSize,
  });
  return { objectKey, uploadUrl: signed.url, expiresAt: signed.expiresAt.toISOString(), headers: signed.headers };
};

export const adminConfirmVersion = async (input: {
  trackId: string;
  language: AudioLanguage;
  objectKey: string;
  mimeType: string;
  durationSeconds?: number | null;
  byteSize?: number | null;
}) => {
  assertStorageConfigured();
  const track = await prisma.audioTrack.findUnique({ where: { id: input.trackId } });
  if (!track) fail(404, "Audio track not found");

  const expectedPrefix = `audio/${input.trackId}/`;
  if (!input.objectKey.startsWith(expectedPrefix)) {
    fail(400, "Validation failed", { objectKey: ["Invalid object key"] });
  }

  const head = await objectStorage.headObject(input.objectKey);
  if (head.contentType !== input.mimeType) {
    fail(400, "Uploaded object content type mismatch");
  }

  const version = await prisma.audioVersion.upsert({
    where: {
      audioTrackId_language: { audioTrackId: input.trackId, language: input.language },
    },
    create: {
      audioTrackId: input.trackId,
      language: input.language,
      r2ObjectKey: input.objectKey,
      mimeType: input.mimeType,
      durationSeconds: input.durationSeconds ?? null,
      byteSize: input.byteSize ?? head.byteSize,
    },
    update: {
      r2ObjectKey: input.objectKey,
      mimeType: input.mimeType,
      durationSeconds: input.durationSeconds ?? null,
      byteSize: input.byteSize ?? head.byteSize,
    },
  });

  return {
    id: version.id,
    language: version.language,
    objectKey: version.r2ObjectKey,
    mimeType: version.mimeType,
    durationSeconds: version.durationSeconds,
    byteSize: version.byteSize,
  };
};

export const adminDeleteVersion = async (trackId: string, versionId: string) => {
  const version = await prisma.audioVersion.findFirst({ where: { id: versionId, audioTrackId: trackId } });
  if (!version) fail(404, "Audio version not found");
  await prisma.audioVersion.delete({ where: { id: versionId } });
  return { deleted: true as const };
};
