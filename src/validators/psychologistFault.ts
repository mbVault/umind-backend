import { CommunicationMode } from "@prisma/client";
import { z } from "zod";

export const psychologistFaultRemedyBodySchema = z
  .object({
    remedy: z.enum(["FULL_REFUND", "FREE_RESCHEDULE"]),
    slotId: z.string().uuid().optional(),
    psychologistProfileId: z.string().uuid().optional(),
    communicationMode: z.nativeEnum(CommunicationMode).optional(),
  })
  .strict();

export const secureComplaintFreeRescheduleBodySchema = z
  .object({
    psychologistProfileId: z.string().uuid(),
    slotId: z.string().uuid(),
    communicationMode: z.nativeEnum(CommunicationMode).optional(),
  })
  .strict();

export const complaintIdParamSchema = z.object({
  complaintId: z.string().uuid(),
});
