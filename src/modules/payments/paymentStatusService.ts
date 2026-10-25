import { PaymentStatus, PaymentStatusChangeSource, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export const recordPaymentStatusChange = async (
  tx: Prisma.TransactionClient,
  input: {
    paymentId: string;
    newStatus: PaymentStatus;
    source: PaymentStatusChangeSource;
    providerEventId?: string;
    providerStatus?: string;
    metadata?: Record<string, unknown>;
    paidAt?: Date | null;
    failedAt?: Date | null;
  },
): Promise<void> => {
  const existing = await tx.payment.findUnique({ where: { id: input.paymentId } });
  if (!existing) {
    return;
  }

  if (existing.status === input.newStatus) {
    return;
  }

  await tx.payment.update({
    where: { id: input.paymentId },
    data: {
      status: input.newStatus,
      providerStatus: input.providerStatus ?? existing.providerStatus,
      paidAt: input.paidAt !== undefined ? input.paidAt : existing.paidAt,
      failedAt: input.failedAt !== undefined ? input.failedAt : existing.failedAt,
    },
  });

  await tx.paymentStatusHistory.create({
    data: {
      paymentId: input.paymentId,
      oldStatus: existing.status,
      newStatus: input.newStatus,
      source: input.source,
      providerEventId: input.providerEventId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
};
