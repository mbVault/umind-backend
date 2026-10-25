import { PaymentStatus, Prisma, RefundReason, RefundStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";

const ACTIVE_REFUND_STATUSES: RefundStatus[] = [
  RefundStatus.PENDING,
  RefundStatus.PROCESSING,
  RefundStatus.SUCCEEDED,
];

export const sumReservedRefundsMinorUnits = async (
  paymentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> => {
  const rows = await tx.paymentRefund.findMany({
    where: {
      paymentId,
      status: { in: ACTIVE_REFUND_STATUSES },
    },
    select: { amountMinorUnits: true },
  });
  return rows.reduce((sum, row) => sum + row.amountMinorUnits, 0);
};

export const getRefundableRemainingMinorUnits = async (
  paymentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> => {
  const payment = await tx.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status !== PaymentStatus.SUCCEEDED) {
    return 0;
  }
  const reserved = await sumReservedRefundsMinorUnits(paymentId, tx);
  return Math.max(0, payment.amountMinorUnits - reserved);
};

const lockPaymentRow = async (tx: Prisma.TransactionClient, paymentId: string): Promise<void> => {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId}::uuid FOR UPDATE`);
};

export type ReserveRefundInput = {
  paymentId: string;
  reason: RefundReason;
  reasonDetail?: string;
  idempotencyKey?: string;
  /** Percent of the original successful payment amount (0–100), capped to remaining balance. */
  refundPercentOfPayment?: number;
  /** Percent of the current remaining refundable balance (0–100). */
  refundPercentOfRemaining?: number;
  /** Explicit amount in minor units, capped to remaining balance. */
  amountMinorUnits?: number;
};

export const reservePendingRefund = async (
  input: ReserveRefundInput,
  existingTx?: Prisma.TransactionClient,
): Promise<{ id: string; amountMinorUnits: number } | null> => {
  const run = async (tx: Prisma.TransactionClient) => {
    if (input.idempotencyKey) {
      const prior = await tx.paymentRefund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (prior) {
        return { id: prior.id, amountMinorUnits: prior.amountMinorUnits };
      }
    }

    await lockPaymentRow(tx, input.paymentId);

    const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
    if (!payment || payment.status !== PaymentStatus.SUCCEEDED) {
      return null;
    }

    const remaining = await getRefundableRemainingMinorUnits(payment.id, tx);
    if (remaining <= 0) {
      return null;
    }

    let requested = 0;
    if (input.amountMinorUnits !== undefined) {
      requested = Math.floor(input.amountMinorUnits);
    } else if (input.refundPercentOfRemaining !== undefined) {
      if (input.refundPercentOfRemaining <= 0) {
        return null;
      }
      requested = Math.floor((remaining * input.refundPercentOfRemaining) / 100);
    } else if (input.refundPercentOfPayment !== undefined) {
      if (input.refundPercentOfPayment <= 0) {
        return null;
      }
      requested = Math.floor((payment.amountMinorUnits * input.refundPercentOfPayment) / 100);
    } else {
      fail(500, "Refund amount not specified");
    }

    const amountMinorUnits = Math.min(Math.max(requested, 0), remaining);
    if (amountMinorUnits <= 0) {
      return null;
    }

    const refund = await tx.paymentRefund.create({
      data: {
        paymentId: payment.id,
        provider: payment.provider,
        amountMinorUnits,
        currency: payment.currency,
        reason: input.reason,
        reasonDetail: input.reasonDetail,
        status: RefundStatus.PENDING,
        idempotencyKey: input.idempotencyKey,
      },
    });

    return { id: refund.id, amountMinorUnits: refund.amountMinorUnits };
  };

  if (existingTx) {
    return run(existingTx);
  }
  return prisma.$transaction(run);
};

/** @deprecated Prefer reservePendingRefund with explicit idempotency keys. */
export const createPendingRefundForPayment = async (input: {
  paymentId: string;
  refundPercent: number;
  reason: RefundReason;
  reasonDetail?: string;
  idempotencyKey?: string;
}): Promise<{ id: string; amountMinorUnits: number } | null> =>
  reservePendingRefund({
    paymentId: input.paymentId,
    reason: input.reason,
    reasonDetail: input.reasonDetail,
    idempotencyKey: input.idempotencyKey,
    refundPercentOfPayment: input.refundPercent,
  });

export const markRefundSucceededForTests = async (refundId: string): Promise<void> => {
  const refund = await prisma.paymentRefund.findUnique({ where: { id: refundId } });
  if (!refund) {
    fail(404, "Refund not found");
  }
  await prisma.paymentRefund.update({
    where: { id: refundId },
    data: { status: RefundStatus.SUCCEEDED, completedAt: new Date() },
  });
};
