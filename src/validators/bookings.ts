import { CommunicationMode } from "@prisma/client";
import { z } from "zod";

export const availabilityQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

export const createBookingBodySchema = z
  .object({
    psychologistProfileId: z.string().uuid(),
    slotId: z.string().uuid(),
    communicationMode: z.nativeEnum(CommunicationMode),
  })
  .strict();

export const bookingIdParamSchema = z.object({
  bookingId: z.string().uuid(),
});

export const cancelBookingBodySchema = z
  .object({
    reason: z.string().max(1000).optional(),
  })
  .strict();

export const rescheduleBookingBodySchema = z
  .object({
    slotId: z.string().uuid(),
  })
  .strict();
