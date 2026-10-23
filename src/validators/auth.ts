import { z } from "zod";
import {
  aliasSchema,
  avatarIdSchema,
  deviceIdSchema,
  genderSchema,
  lifeStageSchema,
  recoveryKeySchema,
  startingFeelingSchema,
  appThemeSchema,
  citySchema,
  saathiCheckInSchema,
  saathiLanguageSchema,
  unwindHabitSchema,
} from "./common";

export const registerBodySchema = z.object({
  recoveryKey: recoveryKeySchema,
  alias: aliasSchema,
  avatarId: avatarIdSchema,
  lifeStage: lifeStageSchema,
  gender: genderSchema,
  startingFeelings: z.array(startingFeelingSchema),
  appTheme: appThemeSchema,
  city: citySchema,
  saathiCheckIn: saathiCheckInSchema,
  saathiLanguage: saathiLanguageSchema,
  unwindHabits: z.array(unwindHabitSchema).min(1, "At least one unwind habit is required"),
  deviceId: deviceIdSchema.optional(),
});

export const recoverBodySchema = z.object({
  recoveryKey: recoveryKeySchema,
  deviceId: deviceIdSchema.optional(),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1, "refreshToken is required"),
});

export const logoutBodySchema = refreshBodySchema;
