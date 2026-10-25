import {
  BookingStatus,
  CancelledByParty,
  RefundReason,
  SessionStatus,
} from "@prisma/client";
import { fail } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { reservePendingRefund } from "../payments/refundService";
import {
  getLateCancelRefundPercent,
  getMaxCustomerReschedules,
  isCustomerRescheduleAllowed,
  isLateCustomerCancel,
} from "./bookingPolicy";
import {
  findSucceededPaymentForBooking,
  reconcileBookingPaymentState,
} from "./bookingPaymentReconciliation";
import { ensureSlotIsOpenForBooking } from "./bookingSlotGuards";

export const cancelBookingByCustomer = async (input: {
  userId: string;
  bookingId: string;
  reason?: string;
}): Promise<{
  bookingId: string;
  status: BookingStatus;
  refund: { id: string; amountMinorUnits: number; refundPercent: number } | null;
}> => {
  const booking = await prisma.psychologistBooking.findFirst({
    where: { id: input.bookingId, userId: input.userId },
  });
  if (!booking) {
    fail(404, "Booking not found");
  }
  if (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.PENDING_PAYMENT) {
    fail(409, "Booking cannot be cancelled in its current state");
  }

  await reconcileBookingPaymentState(booking.id);

  const refreshed = await prisma.psychologistBooking.findUniqueOrThrow({ where: { id: booking.id } });
  const payment = await findSucceededPaymentForBooking(booking.id);

  const late = isLateCustomerCancel(refreshed.createdAt);
  let effectiveRefundPercent = 0;
  if (payment) {
    effectiveRefundPercent = late ? getLateCancelRefundPercent() : 100;
  }

  await prisma.$transaction(async (tx) => {
    await tx.psychologistBooking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledByParty: CancelledByParty.CUSTOMER,
        cancellationReason: input.reason?.slice(0, 1000),
      },
    });

    const session = await tx.psychologistSession.findUnique({ where: { bookingId: booking.id } });
    if (session && session.status === SessionStatus.SCHEDULED) {
      await tx.psychologistSession.update({
        where: { id: session.id },
        data: { status: SessionStatus.CANCELLED },
      });
    }
  });

  let refund: { id: string; amountMinorUnits: number; refundPercent: number } | null = null;
  if (payment && effectiveRefundPercent > 0) {
    const reason = late ? RefundReason.CUSTOMER_LATE_CANCEL : RefundReason.CUSTOMER_CANCEL;
    const row = await reservePendingRefund({
      paymentId: payment.id,
      refundPercentOfPayment: effectiveRefundPercent,
      reason,
      reasonDetail: input.reason,
      idempotencyKey: `customer_cancel:${booking.id}`,
    });
    if (row) {
      refund = { ...row, refundPercent: effectiveRefundPercent };
    }
  }

  return { bookingId: booking.id, status: BookingStatus.CANCELLED, refund };
};

export const rescheduleBookingByCustomer = async (input: {
  userId: string;
  bookingId: string;
  slotId: string;
}): Promise<{ bookingId: string; scheduledStartAt: string; scheduledEndAt: string; customerRescheduleCount: number }> => {
  const booking = await prisma.psychologistBooking.findFirst({
    where: { id: input.bookingId, userId: input.userId },
  });
  if (!booking) {
    fail(404, "Booking not found");
  }
  if (booking.status !== BookingStatus.CONFIRMED) {
    fail(409, "Only confirmed bookings can be rescheduled");
  }
  if (booking.customerRescheduleCount >= getMaxCustomerReschedules()) {
    fail(409, "Customer reschedule limit reached");
  }
  if (!isCustomerRescheduleAllowed(booking.createdAt)) {
    fail(
      409,
      "Customer rescheduling is available after the initial booking window; cancel with full refund instead if needed",
    );
  }

  const slot = await prisma.psychologistAvailabilitySlot.findUnique({ where: { id: input.slotId } });
  if (!slot || slot.psychologistProfileId !== booking.psychologistProfileId) {
    fail(404, "Availability slot not found");
  }
  if (slot.startsAt.getTime() <= Date.now()) {
    fail(400, "Cannot reschedule to a slot in the past");
  }

  await prisma.$transaction(async (tx) => {
    await ensureSlotIsOpenForBooking(tx, slot, booking.id);
    await tx.psychologistBooking.update({
      where: { id: booking.id },
      data: {
        scheduledStartAt: slot.startsAt,
        scheduledEndAt: slot.endsAt,
        customerRescheduleCount: booking.customerRescheduleCount + 1,
      },
    });
  });

  const updated = await prisma.psychologistBooking.findUniqueOrThrow({ where: { id: booking.id } });
  return {
    bookingId: updated.id,
    scheduledStartAt: updated.scheduledStartAt.toISOString(),
    scheduledEndAt: updated.scheduledEndAt.toISOString(),
    customerRescheduleCount: updated.customerRescheduleCount,
  };
};
