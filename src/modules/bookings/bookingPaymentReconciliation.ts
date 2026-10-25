import {
  OrderPurpose,
  OrderStatus,
  Payment,
  PaymentStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { confirmBookingFromVerifiedPayment } from "./bookingConfirmationService";

export const findSucceededPaymentForBooking = async (
  bookingId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Payment | null> => {
  const order = await tx.order.findFirst({
    where: {
      bookingId,
      purpose: OrderPurpose.PSYCHOLOGIST_BOOKING,
      status: { in: [OrderStatus.COMPLETED, OrderStatus.PENDING, OrderStatus.CREATED] },
    },
    orderBy: { createdAt: "desc" },
    include: {
      payments: { where: { status: PaymentStatus.SUCCEEDED }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  return order?.payments[0] ?? null;
};

/** Align booking confirmation with an already-succeeded payment (e.g. delayed webhook). */
export const reconcileBookingPaymentState = async (bookingId: string): Promise<Payment | null> => {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: {
        bookingId,
        purpose: OrderPurpose.PSYCHOLOGIST_BOOKING,
      },
      orderBy: { createdAt: "desc" },
      include: {
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
        booking: true,
      },
    });
    if (!order?.booking) {
      return null;
    }

    const payment = order.payments.find((p) => p.status === PaymentStatus.SUCCEEDED);
    if (!payment) {
      return null;
    }

    if (order.status !== OrderStatus.COMPLETED) {
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.COMPLETED },
      });
    }

    await confirmBookingFromVerifiedPayment(tx, order, payment, order.amountMinorUnits);

    return payment;
  });
};
