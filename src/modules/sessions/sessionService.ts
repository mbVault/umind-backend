import {
  AttendanceEventType,
  BookingStatus,
  OrderPurpose,
  OrderStatus,
  ParticipantRole,
  PaymentStatus,
  RecordingStatus,
  SessionStatus,
} from "@prisma/client";
import { fail } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { getPsychNoShowGraceMinutes } from "./sessionConfig";
import { createProvisionalPayoutForSession } from "./payoutService";

const loadSessionForCustomer = async (sessionId: string, userId: string) => {
  const session = await prisma.psychologistSession.findUnique({
    where: { id: sessionId },
    include: { booking: true },
  });
  if (!session || session.booking.userId !== userId) {
    fail(404, "Session not found");
  }
  return session;
};

export const getSessionForCustomer = async (userId: string, sessionId: string) => {
  const session = await loadSessionForCustomer(sessionId, userId);
  return {
    id: session.id,
    status: session.status,
    bookingId: session.bookingId,
    scheduledStartAt: session.booking.scheduledStartAt.toISOString(),
    scheduledEndAt: session.booking.scheduledEndAt.toISOString(),
    recordingStatus: session.recordingStatus,
    attendanceVerified: session.attendanceVerified,
  };
};

export const recordCustomerAttendance = async (input: {
  userId: string;
  sessionId: string;
  eventType: AttendanceEventType;
}): Promise<void> => {
  const session = await loadSessionForCustomer(input.sessionId, input.userId);
  if (session.status === SessionStatus.CANCELLED || session.status === SessionStatus.NO_SHOW) {
    fail(409, "Session is not active");
  }

  await prisma.$transaction(async (tx) => {
    await tx.attendanceEvent.create({
      data: {
        sessionId: session.id,
        participantRole: ParticipantRole.CUSTOMER,
        userId: input.userId,
        eventType: input.eventType,
        occurredAt: new Date(),
      },
    });

    if (input.eventType === AttendanceEventType.JOINED && session.status === SessionStatus.SCHEDULED) {
      await tx.psychologistSession.update({
        where: { id: session.id },
        data: { status: SessionStatus.IN_PROGRESS, actualStartedAt: new Date() },
      });
    }
  });
};

/** Dev/test helper: psychologist attendance without psych JWT (seed scripts only). */
export const recordPsychologistAttendanceInternal = async (input: {
  psychologistProfileId: string;
  sessionId: string;
  eventType: AttendanceEventType;
}): Promise<void> => {
  const session = await prisma.psychologistSession.findUnique({
    where: { id: input.sessionId },
    include: { booking: true },
  });
  if (!session || session.booking.psychologistProfileId !== input.psychologistProfileId) {
    fail(404, "Session not found");
  }

  await txSafeCreatePsychAttendance(session.id, input.psychologistProfileId, input.eventType);
};

const txSafeCreatePsychAttendance = async (
  sessionId: string,
  psychologistProfileId: string,
  eventType: AttendanceEventType,
): Promise<void> => {
  await prisma.attendanceEvent.create({
    data: {
      sessionId,
      participantRole: ParticipantRole.PSYCHOLOGIST,
      psychologistProfileId,
      eventType,
      occurredAt: new Date(),
    },
  });
};

export const grantCustomerRecordingConsent = async (input: {
  userId: string;
  sessionId: string;
}): Promise<void> => {
  const session = await loadSessionForCustomer(input.sessionId, input.userId);
  await prisma.sessionRecordingConsent.upsert({
    where: { sessionId_participantRole: { sessionId: session.id, participantRole: ParticipantRole.CUSTOMER } },
    create: {
      sessionId: session.id,
      participantRole: ParticipantRole.CUSTOMER,
      userId: input.userId,
      consentedAt: new Date(),
    },
    update: { consentedAt: new Date(), revokedAt: null },
  });

  if (session.recordingStatus === RecordingStatus.NOT_APPLICABLE) {
    await prisma.psychologistSession.update({
      where: { id: session.id },
      data: { recordingStatus: RecordingStatus.CONSENT_PENDING },
    });
  }
};

export const completeSessionForCustomer = async (input: {
  userId: string;
  sessionId: string;
}): Promise<{ payoutId: string | null }> => {
  const session = await loadSessionForCustomer(input.sessionId, input.userId);
  if (session.status !== SessionStatus.IN_PROGRESS && session.status !== SessionStatus.SCHEDULED) {
    fail(409, "Session cannot be completed");
  }

  await prisma.$transaction(async (tx) => {
    await tx.psychologistSession.update({
      where: { id: session.id },
      data: {
        status: SessionStatus.COMPLETED,
        actualEndedAt: new Date(),
        attendanceVerified: true,
        attendanceVerifiedAt: new Date(),
      },
    });
    await tx.psychologistBooking.update({
      where: { id: session.bookingId },
      data: { status: BookingStatus.COMPLETED },
    });
  });

  const payout = await createProvisionalPayoutForSession(session.id);
  return { payoutId: payout?.id ?? null };
};

export const evaluatePsychologistNoShow = async (input: {
  userId: string;
  sessionId: string;
}): Promise<{ markedNoShow: boolean }> => {
  const session = await loadSessionForCustomer(input.sessionId, input.userId);
  if (session.booking.status !== BookingStatus.CONFIRMED && session.booking.status !== BookingStatus.COMPLETED) {
    fail(409, "Booking is not eligible for no-show evaluation");
  }

  const graceMs = getPsychNoShowGraceMinutes() * 60 * 1000;
  const deadline = session.booking.scheduledStartAt.getTime() + graceMs;
  if (Date.now() < deadline) {
    fail(400, "Psychologist no-show can only be evaluated after the grace period");
  }

  const psychJoined = await prisma.attendanceEvent.findFirst({
    where: {
      sessionId: session.id,
      participantRole: ParticipantRole.PSYCHOLOGIST,
      eventType: AttendanceEventType.JOINED,
    },
  });
  if (psychJoined) {
    return { markedNoShow: false };
  }

  if (session.status === SessionStatus.NO_SHOW) {
    return { markedNoShow: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.psychologistSession.update({
      where: { id: session.id },
      data: { status: SessionStatus.NO_SHOW },
    });
    await tx.psychologistBooking.update({
      where: { id: session.bookingId },
      data: { status: BookingStatus.NO_SHOW },
    });
  });

  return { markedNoShow: true };
};

export const findSucceededPaymentForSession = async (sessionId: string) => {
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
  return session?.booking.orders[0]?.payments[0] ?? null;
};
