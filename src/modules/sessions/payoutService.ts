import { OrderPurpose, OrderStatus, PaymentStatus, PayoutStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { getPayoutPsychologistSharePercent, getPayoutSplitVersion } from "./sessionConfig";

export const createProvisionalPayoutForSession = async (sessionId: string): Promise<{ id: string } | null> => {
  const existing = await prisma.psychologistPayout.findUnique({ where: { sessionId } });
  if (existing) {
    return { id: existing.id };
  }

  const session = await prisma.psychologistSession.findUnique({
    where: { id: sessionId },
    include: {
      booking: {
        include: {
          orders: {
            where: { purpose: OrderPurpose.PSYCHOLOGIST_BOOKING, status: OrderStatus.COMPLETED },
            include: { payments: { where: { status: PaymentStatus.SUCCEEDED }, take: 1 } },
          },
        },
      },
    },
  });
  if (!session) {
    return null;
  }

  const payment = session.booking.orders[0]?.payments[0];
  if (!payment) {
    return null;
  }

  const gross = payment.amountMinorUnits;
  const psychPercent = getPayoutPsychologistSharePercent();
  const psychologistShareMinorUnits = Math.floor((gross * psychPercent) / 100);
  const platformShareMinorUnits = gross - psychologistShareMinorUnits;

  const payout = await prisma.psychologistPayout.create({
    data: {
      sessionId: session.id,
      psychologistProfileId: session.booking.psychologistProfileId,
      paymentId: payment.id,
      grossAmountMinorUnits: gross,
      psychologistShareMinorUnits,
      platformShareMinorUnits,
      splitVersion: getPayoutSplitVersion(),
      currency: payment.currency,
      provider: payment.provider,
      status: PayoutStatus.PENDING,
    },
  });

  return { id: payout.id };
};
