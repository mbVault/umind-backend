import { z } from "zod";
import {
  aliasSchema,
  avatarIdSchema,
  appThemeSchema,
  citySchema,
  genderSchema,
  lifeStageSchema,
  startingFeelingSchema,
} from "./common";

export const patchProfileSchema = z
  .object({
    alias: aliasSchema.optional(),
    avatarId: avatarIdSchema.optional(),
  })
  .refine((data) => data.alias !== undefined || data.avatarId !== undefined, {
    message: "At least one of alias or avatarId is required",
  });

export const patchPreferencesSchema = z
  .object({
    lifeStage: lifeStageSchema.optional(),
    gender: genderSchema.optional(),
  })
  .refine((data) => data.lifeStage !== undefined || data.gender !== undefined, {
    message: "At least one of lifeStage or gender is required",
  });

export const putOnboardingSchema = z.object({
  startingFeelings: z.array(startingFeelingSchema),
});

export const patchPersonalizationSchema = z
  .object({
    appTheme: appThemeSchema.optional(),
    city: citySchema.optional(),
  })
  .refine((data) => data.appTheme !== undefined || data.city !== undefined, {
    message: "At least one of appTheme or city is required",
  });
