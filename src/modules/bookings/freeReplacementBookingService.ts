import {
  BookingStatus,
  CommunicationMode,
  Prisma,
  SessionStatus,
} from "@prisma/client";
import { fail } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { getBookablePsychologistById } from "../discovery/discoveryService";
import { BOOKING_DURATION_MINUTES, getBookingPolicyVersion } from "./bookingConfig";
import { ensureSlotIsOpenForBooking } from "./bookingSlotGuards";
import { assertCommunicationModeAllowed, assertUnderDailySessionCap } from "./bookingOpsGuards";

export const createFreeReplacementBooking = async (input: {
  userId: string;
  sourceBookingId: string;
  psychologistProfileId: string;
  slotId: string;
  communicationMode: CommunicationMode;
  tx?: Prisma.TransactionClient;
}): Promise<{ bookingId: string; sessionId: string }> => {
  const run = async (tx: Prisma.TransactionClient) => {
    const source = await tx.psychologistBooking.findFirst({
      where: { id: input.sourceBookingId, userId: input.userId },
    });
    if (!source) {
      fail(404, "Original booking not found");
    }

    await getBookablePsychologistById(input.psychologistProfileId);

    const slot = await tx.psychologistAvailabilitySlot.findUnique({ where: { id: input.slotId } });
    if (!slot || slot.psychologistProfileId !== input.psychologistProfileId) {
      fail(404, "Availability slot not found");
    }
    if (slot.startsAt.getTime() <= Date.now()) {
      fail(400, "Cannot book a slot in the past");
    }

    const ops = await tx.psychologistProfile.findUnique({
      where: { id: input.psychologistProfileId },
      select: { sessionModes: true, maxSessionsPerDay: true },
    });
    if (!ops) {
      fail(404, "Psychologist not found");
    }
    assertCommunicationModeAllowed(ops.sessionModes, input.communicationMode);

    await ensureSlotIsOpenForBooking(tx, slot);
    await assertUnderDailySessionCap(tx, {
      psychologistProfileId: input.psychologistProfileId,
      scheduledStartAt: slot.startsAt,
      maxSessionsPerDay: ops.maxSessionsPerDay,
    });

    const booking = await tx.psychologistBooking.create({
      data: {
        userId: input.userId,
        psychologistProfileId: input.psychologistProfileId,
        scheduledStartAt: slot.startsAt,
        scheduledEndAt: slot.endsAt,
        durationMinutes: BOOKING_DURATION_MINUTES,
        communicationMode: input.communicationMode,
        status: BookingStatus.CONFIRMED,
        reservationExpiresAt: null,
        policyVersion: getBookingPolicyVersion(),
        policySnapshot: { freeReplacementForBookingId: source.id },
        rescheduledFromBookingId: source.id,
        isFreeProviderReschedule: true,
      },
    });

    const session = await tx.psychologistSession.create({
      data: {
        bookingId: booking.id,
        status: SessionStatus.SCHEDULED,
      },
    });

    return { bookingId: booking.id, sessionId: session.id };
  };

  if (input.tx) {
    return run(input.tx);
  }
  return prisma.$transaction(run);
};
