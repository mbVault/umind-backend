import { z } from "zod";
import {
  AudioAccessTier,
  AudioCategory,
  AudioLanguage,
  AudioPublishStatus,
  Gender,
  LifeStage,
  StartingFeeling,
} from "@prisma/client";

export const audioListQuerySchema = z.object({
  language: z.nativeEnum(AudioLanguage).optional(),
  category: z.nativeEnum(AudioCategory).optional(),
  feeling: z.nativeEnum(StartingFeeling).optional(),
  lifeStage: z.nativeEnum(LifeStage).optional(),
  gender: z.nativeEnum(Gender).optional(),
  q: z.string().trim().max(80).optional(),
});

export const audioTrackIdParamSchema = z.object({
  trackId: z.string().uuid(),
});

export const audioPlaybackBodySchema = z.object({
  language: z.nativeEnum(AudioLanguage),
});

export const adminCreateAudioBodySchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional().nullable(),
  category: z.nativeEnum(AudioCategory),
  accessTier: z.nativeEnum(AudioAccessTier).optional(),
  durationSeconds: z.number().int().min(1).max(86_400).optional().nullable(),
  feelingTags: z.array(z.nativeEnum(StartingFeeling)).max(20).optional(),
  lifeStageTargets: z.array(z.nativeEnum(LifeStage)).max(10).optional(),
  genderTargets: z.array(z.nativeEnum(Gender)).max(10).optional(),
});

export const adminPatchAudioBodySchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(1000).optional().nullable(),
    category: z.nativeEnum(AudioCategory).optional(),
    status: z.nativeEnum(AudioPublishStatus).optional(),
    accessTier: z.nativeEnum(AudioAccessTier).optional(),
    durationSeconds: z.number().int().min(1).max(86_400).optional().nullable(),
    feelingTags: z.array(z.nativeEnum(StartingFeeling)).max(20).optional(),
    lifeStageTargets: z.array(z.nativeEnum(LifeStage)).max(10).optional(),
    genderTargets: z.array(z.nativeEnum(Gender)).max(10).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field required" });

export const adminCreateVersionBodySchema = z.object({
  language: z.nativeEnum(AudioLanguage),
  contentType: z.string().min(3).max(100),
  byteSize: z.number().int().min(1).max(100 * 1024 * 1024),
});

export const adminConfirmVersionBodySchema = z.object({
  language: z.nativeEnum(AudioLanguage),
  objectKey: z.string().min(8).max(512),
  mimeType: z.string().min(3).max(100),
  durationSeconds: z.number().int().min(1).max(86_400).optional().nullable(),
  byteSize: z.number().int().min(1).max(100 * 1024 * 1024).optional().nullable(),
});

export const adminVersionIdParamSchema = z.object({
  trackId: z.string().uuid(),
  versionId: z.string().uuid(),
});
