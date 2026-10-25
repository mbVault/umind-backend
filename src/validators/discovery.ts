import { z } from "zod";

export const psychologistDirectoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  specialisation: z
    .enum([
      "STRESS",
      "ANXIETY",
      "SLEEP",
      "BURNOUT",
      "RELATIONSHIPS",
      "TEENS",
      "WOMENS_HEALTH",
      "GRIEF",
    ])
    .optional(),
});

export const psychologistIdParamSchema = z.object({
  id: z.string().uuid(),
});
