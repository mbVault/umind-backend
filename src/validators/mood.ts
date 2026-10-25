import { z } from "zod";

export const localDateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD");

export const moodTodayQuerySchema = z.object({
  date: localDateStringSchema,
});

export const putMoodTodayBodySchema = z.object({
  date: localDateStringSchema,
  moodId: z.string().uuid(),
});

export const moodHistoryQuerySchema = z
  .object({
    from: localDateStringSchema,
    to: localDateStringSchema,
  })
  .refine((v) => v.from <= v.to, { message: "`from` must be on or before `to`", path: ["from"] });
