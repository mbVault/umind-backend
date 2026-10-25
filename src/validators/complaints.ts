import { ComplaintCategory, ComplaintDecision } from "@prisma/client";
import { z } from "zod";

export const fileComplaintBodySchema = z
  .object({
    category: z.nativeEnum(ComplaintCategory),
    description: z.string().min(10).max(5000),
  })
  .strict();

export const complaintIdParamSchema = z.object({
  complaintId: z.string().uuid(),
});

export const resolveComplaintBodySchema = z
  .object({
    decision: z.nativeEnum(ComplaintDecision),
    rationale: z.string().min(3).max(5000),
    partialRefundPercent: z.number().int().min(1).max(100).optional(),
  })
  .strict();
