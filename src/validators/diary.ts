import { z } from "zod";
import { localDateStringSchema } from "./mood";

const base64Schema = z.string().min(1).max(2_000_000);

export const diaryRangeQuerySchema = z
  .object({
    from: localDateStringSchema,
    to: localDateStringSchema,
  })
  .refine((v) => v.from <= v.to, { message: "`from` must be on or before `to`", path: ["from"] });

export const diaryEntryDateParamSchema = z.object({
  entryDate: localDateStringSchema,
});

export const putDiaryEntryBodySchema = z.object({
  ciphertext: base64Schema,
  nonce: base64Schema,
  encryptionVersion: z.number().int().min(1).max(10).default(1),
  schemaVersion: z.number().int().min(1).max(10).default(1),
});

export const privacyConsentPutSchema = z.object({
  shareDiaryWithSaathi: z.boolean(),
  shareDiaryConsentVersion: z.number().int().min(1).max(1000).optional(),
  diaryKdfSalt: z.string().min(8).max(512).optional(),
});
