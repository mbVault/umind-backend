import {
  BookingStatus,
  CancelledByParty,
  CommunicationMode,
  RefundReason,
  SessionStatus,
} from "@prisma/client";
import { fail } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { reservePendingRefund } from "../payments/refundService";
import { findSucceededPaymentForBooking } from "./bookingPaymentReconciliation";
import { createFreeReplacementBooking } from "./freeReplacementBookingService";

export type PsychologistFaultRemedy = "FULL_REFUND" | "FREE_RESCHEDULE";

const assertEligibleForPsychFaultRemedy = (booking: {
  status: BookingStatus;
  cancelledByParty: CancelledByParty | null;
  problemSnapshot: unknown;
}) => {
  const snapshot = booking.problemSnapshot as { psychFaultRemedy?: string } | null;
  if (snapshot?.psychFaultRemedy) {
    fail(409, "A remedy has already been chosen for this booking");
  }

  const psychCancelled =
    booking.status === BookingStatus.CANCELLED && booking.cancelledByParty === CancelledByParty.PSYCHOLOGIST;
  const noShow = booking.status === BookingStatus.NO_SHOW;
  if (!psychCancelled && !noShow) {
    fail(409, "This booking is not eligible for psychologist fault remedies");
  }
};

export const choosePsychologistFaultRemedy = async (input: {
  userId: string;
  sessionId: string;
  remedy: PsychologistFaultRemedy;
  slotId?: string;
  psychologistProfileId?: string;
  communicationMode?: CommunicationMode;
}): Promise<{
  remedy: PsychologistFaultRemedy;
  refund: { id: string; amountMinorUnits: number } | null;
  replacementBookingId: string | null;
}> => {
  const session = await prisma.psychologistSession.findUnique({
    where: { id: input.sessionId },
    include: { booking: true },
  });
  if (!session || session.booking.userId !== input.userId) {
    fail(404, "Session not found");
  }

  assertEligibleForPsychFaultRemedy(session.booking);

  const payment = await findSucceededPaymentForBooking(session.bookingId);
  const refundReason =
    session.booking.status === BookingStatus.NO_SHOW
      ? RefundReason.PSYCHOLOGIST_NO_SHOW
      : RefundReason.PSYCHOLOGIST_CANCEL;

  if (input.remedy === "FULL_REFUND") {
    if (!payment) {
      fail(409, "No succeeded payment linked to this booking");
    }
    const refund = await reservePendingRefund({
      paymentId: payment.id,
      reason: refundReason,
      refundPercentOfRemaining: 100,
      idempotencyKey: `psych_fault_refund:${session.bookingId}`,
    });

    await prisma.psychologistBooking.update({
      where: { id: session.bookingId },
      data: {
        problemSnapshot: { psychFaultRemedy: "FULL_REFUND", chosenAt: new Date().toISOString() },
      },
    });

    return { remedy: "FULL_REFUND", refund, replacementBookingId: null };
  }

  if (!input.slotId || !input.psychologistProfileId) {
    fail(400, "slotId and psychologistProfileId are required for free rescheduling");
  }

  const replacement = await createFreeReplacementBooking({
    userId: input.userId,
    sourceBookingId: session.bookingId,
    psychologistProfileId: input.psychologistProfileId,
    slotId: input.slotId,
    communicationMode: input.communicationMode ?? session.booking.communicationMode,
  });

  await prisma.psychologistBooking.update({
    where: { id: session.bookingId },
    data: {
      problemSnapshot: {
        psychFaultRemedy: "FREE_RESCHEDULE",
        replacementBookingId: replacement.bookingId,
        chosenAt: new Date().toISOString(),
      },
    },
  });

  if (session.status === SessionStatus.SCHEDULED || session.status === SessionStatus.NO_SHOW) {
    await prisma.psychologistSession.update({
      where: { id: session.id },
      data: { status: SessionStatus.CANCELLED },
    });
  }

  return {
    remedy: "FREE_RESCHEDULE",
    refund: null,
    replacementBookingId: replacement.bookingId,
  };
};

/** Staff/system: mark booking cancelled by psychologist (enables customer remedy choice). */
export const cancelBookingByPsychologist = async (input: {
  bookingId: string;
  reason?: string;
}): Promise<void> => {
  const booking = await prisma.psychologistBooking.findUnique({ where: { id: input.bookingId } });
  if (!booking || booking.status !== BookingStatus.CONFIRMED) {
    fail(409, "Booking cannot be cancelled by psychologist in its current state");
  }

  await prisma.$transaction(async (tx) => {
    await tx.psychologistBooking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledByParty: CancelledByParty.PSYCHOLOGIST,
        cancellationReason: input.reason?.slice(0, 1000),
      },
    });
    const session = await tx.psychologistSession.findUnique({ where: { bookingId: booking.id } });
    if (session?.status === SessionStatus.SCHEDULED) {
      await tx.psychologistSession.update({
        where: { id: session.id },
        data: { status: SessionStatus.CANCELLED },
      });
    }
  });
};
