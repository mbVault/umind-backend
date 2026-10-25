import { z } from "zod";

export const saathiConversationIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const createSaathiConversationBodySchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export const renameSaathiConversationBodySchema = z.object({
  title: z.string().trim().min(1).max(120),
});

export const saathiPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const diaryContextSchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  causes: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  prompt: z.string().trim().max(500).optional(),
  body: z.string().trim().min(1).max(8000),
});

export const sendSaathiMessageBodySchema = z.object({
  content: z.string().trim().min(1).max(4000),
  diaryContext: diaryContextSchema.optional(),
});
