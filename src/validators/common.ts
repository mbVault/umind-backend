import { z } from "zod";

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_LIKE = /^\+?[\d\s-]{10,}$/;

export const aliasSchema = z
  .string()
  .trim()
  .min(2, "Alias must be at least 2 characters")
  .max(20, "Alias must be at most 20 characters")
  .refine((v) => !EMAIL_LIKE.test(v), "Alias must not look like an email")
  .refine((v) => !PHONE_LIKE.test(v.replace(/\s/g, "")), "Alias must not look like a phone number");

export const deviceIdSchema = z.string().uuid("deviceId must be a valid UUID");

export const recoveryKeySchema = z.union([
  z.string().min(1, "recoveryKey is required"),
  z.array(z.string().min(1)).length(12, "recoveryKey must contain exactly 12 words"),
]);

export const avatarIdSchema = z.string().min(1).max(50);

export const lifeStageSchema = z.enum([
  "GROWING_UP",
  "STARTING_OUT",
  "BUILDING",
  "SHIFTING",
  "WISDOM_YEARS",
]);

export const genderSchema = z.enum(["WOMAN", "MAN", "PREFER_NOT_TO_SAY"]);

export const startingFeelingSchema = z.enum([
  "STRESSED",
  "ANXIOUS",
  "GHABRAHAT",
  "LOW",
  "CANT_SLEEP",
  "LONELY",
]);

export const appThemeSchema = z.enum(["LAVENDER", "OCEAN", "FOREST", "SUNSET", "ROSE"]);

export const citySchema = z.string().trim().min(1, "city is required").max(100);

export const saathiCheckInSchema = z.enum([
  "MORNING",
  "AFTERNOON",
  "EVENING",
  "BEFORE_BED",
  "ONLY_WHEN_I_OPEN",
]);

export const saathiLanguageSchema = z.enum(["HINDI", "ENGLISH", "HINGLISH"]);

export const unwindHabitSchema = z.enum([
  "BREATHING",
  "WALKING",
  "TALKING_IT_OUT",
  "CALM_SOUNDS",
  "WRITING",
  "AYURVEDA_ROUTINES",
]);

export const requireMobileDeviceId = (deviceId: string | undefined, isMobile: boolean): void => {
  if (isMobile && !deviceId) {
    throw new z.ZodError([
      {
        code: "custom",
        message: "deviceId is required for mobile clients",
        path: ["deviceId"],
      },
    ]);
  }
};

/** Client may send X-Client-Platform: ios | android | web */
export const isMobileClient = (platformHeader: string | undefined): boolean => {
  if (!platformHeader) {
    return false;
  }
  const p = platformHeader.toLowerCase();
  return p === "ios" || p === "android" || p === "mobile";
};
