import {
  ComplaintCategory,
  ComplaintDecision,
  ComplaintStatus,
  CommunicationMode,
  RefundReason,
} from "@prisma/client";
import { fail } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { reservePendingRefund } from "../payments/refundService";
import { createFreeReplacementBooking } from "../bookings/freeReplacementBookingService";
import { findSucceededPaymentForSession } from "./sessionService";

export const fileSessionComplaint = async (input: {
  userId: string;
  sessionId: string;
  category: ComplaintCategory;
  description: string;
}) => {
  const session = await prisma.psychologistSession.findUnique({
    where: { id: input.sessionId },
    include: { booking: true },
  });
  if (!session || session.booking.userId !== input.userId) {
    fail(404, "Session not found");
  }

  const complaint = await prisma.sessionComplaint.create({
    data: {
      sessionId: session.id,
      userId: input.userId,
      category: input.category,
      description: input.description.slice(0, 5000),
      status: ComplaintStatus.OPEN,
    },
  });

  return {
    id: complaint.id,
    status: complaint.status,
    sessionId: complaint.sessionId,
  };
};

export const resolveSessionComplaint = async (input: {
  reviewerAccountId: string;
  complaintId: string;
  decision: ComplaintDecision;
  rationale: string;
  partialRefundPercent?: number;
}) => {
  const complaint = await prisma.sessionComplaint.findUnique({ where: { id: input.complaintId } });
  if (!complaint) {
    fail(404, "Complaint not found");
  }
  if (complaint.status === ComplaintStatus.RESOLVED || complaint.status === ComplaintStatus.REJECTED) {
    fail(409, "Complaint is already closed");
  }

  let paymentRefundId: string | null = complaint.paymentRefundId;
  let status: ComplaintStatus = ComplaintStatus.RESOLVED;

  if (input.decision === ComplaintDecision.NO_REFUND) {
    status = ComplaintStatus.REJECTED;
    paymentRefundId = null;
  } else if (input.decision === ComplaintDecision.FREE_RESCHEDULE) {
    status = ComplaintStatus.UNDER_REVIEW;
    paymentRefundId = null;
  } else if (
    input.decision === ComplaintDecision.FULL_REFUND ||
    input.decision === ComplaintDecision.PARTIAL_REFUND
  ) {
    const payment = await findSucceededPaymentForSession(complaint.sessionId);
    if (!payment) {
      fail(409, "No succeeded payment linked to this session");
    }

    if (input.decision === ComplaintDecision.PARTIAL_REFUND) {
      if (input.partialRefundPercent === undefined) {
        fail(400, "partialRefundPercent is required for partial refunds");
      }
      const refund = await reservePendingRefund({
        paymentId: payment!.id,
        reason: RefundReason.COMPLAINT_PARTIAL,
        reasonDetail: input.rationale,
        refundPercentOfRemaining: input.partialRefundPercent,
        idempotencyKey: `complaint_partial:${complaint.id}`,
      });
      paymentRefundId = refund?.id ?? null;
    } else {
      const refund = await reservePendingRefund({
        paymentId: payment!.id,
        reason: RefundReason.COMPLAINT_FULL,
        reasonDetail: input.rationale,
        refundPercentOfRemaining: 100,
        idempotencyKey: `complaint_full:${complaint.id}`,
      });
      paymentRefundId = refund?.id ?? null;
    }
  }

  const updated = await prisma.sessionComplaint.update({
    where: { id: complaint.id },
    data: {
      status,
      reviewerAccountId: input.reviewerAccountId,
      decision: input.decision,
      decisionRationale: input.rationale.slice(0, 5000),
      paymentRefundId,
      resolvedAt: status === ComplaintStatus.RESOLVED || status === ComplaintStatus.REJECTED ? new Date() : null,
    },
  });

  return {
    id: updated.id,
    status: updated.status,
    decision: updated.decision,
    paymentRefundId: updated.paymentRefundId,
    replacementBookingId: updated.replacementBookingId,
  };
};

export const secureComplaintFreeReschedule = async (input: {
  userId: string;
  complaintId: string;
  psychologistProfileId: string;
  slotId: string;
  communicationMode?: CommunicationMode;
}) => {
  const complaint = await prisma.sessionComplaint.findUnique({
    where: { id: input.complaintId },
    include: { session: { include: { booking: true } } },
  });
  if (!complaint || complaint.userId !== input.userId) {
    fail(404, "Complaint not found");
  }
  if (complaint.decision !== ComplaintDecision.FREE_RESCHEDULE || complaint.status !== ComplaintStatus.UNDER_REVIEW) {
    fail(409, "Complaint is not awaiting free reschedule");
  }
  if (complaint.replacementBookingId) {
    fail(409, "Replacement booking is already secured");
  }

  const replacement = await createFreeReplacementBooking({
    userId: input.userId,
    sourceBookingId: complaint.session.bookingId,
    psychologistProfileId: input.psychologistProfileId,
    slotId: input.slotId,
    communicationMode: input.communicationMode ?? complaint.session.booking.communicationMode,
  });

  const updated = await prisma.sessionComplaint.update({
    where: { id: complaint.id },
    data: {
      status: ComplaintStatus.RESOLVED,
      replacementBookingId: replacement.bookingId,
      resolvedAt: new Date(),
    },
  });

  return {
    complaintId: updated.id,
    status: updated.status,
    replacementBookingId: updated.replacementBookingId,
  };
};
