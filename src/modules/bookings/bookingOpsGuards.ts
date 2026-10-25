import { BookingStatus, CommunicationMode, Prisma } from "@prisma/client";
import { fail } from "../../lib/errors";

const CAP_STATUSES: BookingStatus[] = [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED];

/** Ensures client-chosen mode is offered by the psychologist (product: sessionModes). */
export const assertCommunicationModeAllowed = (
  sessionModes: CommunicationMode[],
  communicationMode: CommunicationMode,
): void => {
  if (!sessionModes.includes(communicationMode)) {
    fail(400, "This psychologist does not offer the selected session mode", {
      communicationMode: [`Not offered. Allowed: ${sessionModes.join(", ") || "(none)"}`],
    });
  }
};

const utcDayBounds = (at: Date): { dayStart: Date; dayEnd: Date } => {
  const dayStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
};

/**
 * Enforces maxSessionsPerDay against holds + confirmed on that UTC calendar day.
 * null/undefined max = no cap. Does not affect session join of existing bookings.
 */
export const assertUnderDailySessionCap = async (
  tx: Prisma.TransactionClient,
  input: {
    psychologistProfileId: string;
    scheduledStartAt: Date;
    maxSessionsPerDay: number | null | undefined;
    excludeBookingId?: string;
  },
): Promise<void> => {
  if (input.maxSessionsPerDay == null) return;
  if (input.maxSessionsPerDay < 1) {
    fail(409, "Psychologist is not accepting sessions today");
  }

  const { dayStart, dayEnd } = utcDayBounds(input.scheduledStartAt);
  const count = await tx.psychologistBooking.count({
    where: {
      psychologistProfileId: input.psychologistProfileId,
      status: { in: CAP_STATUSES },
      scheduledStartAt: { gte: dayStart, lt: dayEnd },
      ...(input.excludeBookingId ? { NOT: { id: input.excludeBookingId } } : {}),
    },
  });

  if (count >= input.maxSessionsPerDay) {
    fail(409, "Psychologist has reached the maximum sessions for this day");
  }
};
