import { AttendanceEventType } from "@prisma/client";
import { z } from "zod";

export const sessionIdParamSchema = z.object({
  sessionId: z.string().uuid(),
});

export const attendanceBodySchema = z
  .object({
    eventType: z.enum([AttendanceEventType.JOINED, AttendanceEventType.LEFT]),
  })
  .strict();
