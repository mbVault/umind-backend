import {
  BookingStatus,
  OrderPurpose,
  OrderStatus,
  PaymentStatus,
  Prisma,
  SessionStatus,
} from "@prisma/client";
import { fail } from "../../lib/errors";

export type BookingConfirmOutcome = "confirmed" | "already_confirmed" | "expired_hold" | "skipped";

type BookingOrderContext = {
  id: string;
  purpose: OrderPurpose;
  bookingId: string | null;
  status: OrderStatus;
  booking: {
    id: string;
    status: BookingStatus;
    reservationExpiresAt: Date | null;
  } | null;
};

export const confirmBookingFromVerifiedPayment = async (
  tx: Prisma.TransactionClient,
  order: BookingOrderContext,
  payment: { status: PaymentStatus; amountMinorUnits: number },
  orderAmountMinorUnits: number,
): Promise<BookingConfirmOutcome> => {
  if (order.purpose !== OrderPurpose.PSYCHOLOGIST_BOOKING || !order.bookingId || !order.booking) {
    return "skipped";
  }

  if (payment.status !== PaymentStatus.SUCCEEDED) {
    return "skipped";
  }

  if (payment.amountMinorUnits !== orderAmountMinorUnits) {
    fail(409, "Payment amount does not match order");
  }

  const booking = order.booking;

  if (booking.status === BookingStatus.CONFIRMED) {
    return "already_confirmed";
  }

  if (booking.status !== BookingStatus.PENDING_PAYMENT) {
    return "skipped";
  }

  if (booking.reservationExpiresAt && booking.reservationExpiresAt.getTime() < Date.now()) {
    await tx.psychologistBooking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.EXPIRED, reservationExpiresAt: null },
    });
    return "expired_hold";
  }

  await tx.psychologistBooking.update({
    where: { id: booking.id },
    data: {
      status: BookingStatus.CONFIRMED,
      reservationExpiresAt: null,
    },
  });

  const existingSession = await tx.psychologistSession.findUnique({ where: { bookingId: booking.id } });
  if (!existingSession) {
    await tx.psychologistSession.create({
      data: {
        bookingId: booking.id,
        status: SessionStatus.SCHEDULED,
      },
    });
  }

  return "confirmed";
};
