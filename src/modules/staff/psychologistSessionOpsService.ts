import {
  AttendanceEventType,
  AudioPublishStatus,
  BookingStatus,
  ParticipantRole,
  SessionRiskLevel,
  SessionStatus,
} from "@prisma/client";
import { fail } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { createProvisionalPayoutForSession } from "../sessions/payoutService";
import { getOrCreatePsychologistProfile } from "./psychologistService";
import { clientPublicSlice, toClientRef } from "./clientRef";
import { listPublishedAudiosForAftercare } from "./psychologistOpsService";

const loadOwnedSession = async (psychologistProfileId: string, sessionId: string) => {
  const session = await prisma.psychologistSession.findUnique({
    where: { id: sessionId },
    include: {
      booking: {
        include: {
          user: { select: { id: true, alias: true, avatarId: true } },
        },
      },
    },
  });
  if (!session || session.booking.psychologistProfileId !== psychologistProfileId) {
    fail(404, "Session not found");
  }
  return session;
};

const canJoinWindow = (scheduledStartAt: Date, scheduledEndAt: Date, status: SessionStatus): boolean => {
  if (status === SessionStatus.CANCELLED || status === SessionStatus.NO_SHOW || status === SessionStatus.COMPLETED) {
    return false;
  }
  const now = Date.now();
  const openFrom = scheduledStartAt.getTime() - 15 * 60 * 1000;
  const openTo = scheduledEndAt.getTime() + 30 * 60 * 1000;
  return now >= openFrom && now <= openTo;
};

export const getPsychologistSession = async (accountId: string, sessionId: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const session = await loadOwnedSession(profile.id, sessionId);
  return {
    id: session.id,
    bookingId: session.bookingId,
    status: session.status,
    scheduledStartAt: session.booking.scheduledStartAt.toISOString(),
    scheduledEndAt: session.booking.scheduledEndAt.toISOString(),
    durationMinutes: session.booking.durationMinutes,
    communicationMode: session.booking.communicationMode,
    actualStartedAt: session.actualStartedAt?.toISOString() ?? null,
    actualEndedAt: session.actualEndedAt?.toISOString() ?? null,
    attendanceVerified: session.attendanceVerified,
    recordingStatus: session.recordingStatus,
    canJoin: canJoinWindow(
      session.booking.scheduledStartAt,
      session.booking.scheduledEndAt,
      session.status,
    ),
    client: {
      clientRef: toClientRef(profile.id, session.booking.user.id),
      ...clientPublicSlice(session.booking.user),
    },
    mediaStatus: "UNAVAILABLE" as const,
    privateNotes: session.privateNotes,
    privateNoteTags: session.privateNoteTags,
  };
};

export const joinPsychologistSession = async (accountId: string, sessionId: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const session = await loadOwnedSession(profile.id, sessionId);
  if (session.status === SessionStatus.CANCELLED || session.status === SessionStatus.NO_SHOW) {
    fail(409, "Session is not active");
  }
  if (
    !canJoinWindow(session.booking.scheduledStartAt, session.booking.scheduledEndAt, session.status) &&
    session.status === SessionStatus.SCHEDULED
  ) {
    fail(400, "Session is outside the join window");
  }

  await prisma.$transaction(async (tx) => {
    await tx.attendanceEvent.create({
      data: {
        sessionId: session.id,
        participantRole: ParticipantRole.PSYCHOLOGIST,
        psychologistProfileId: profile.id,
        eventType: AttendanceEventType.JOINED,
        occurredAt: new Date(),
      },
    });
    if (session.status === SessionStatus.SCHEDULED) {
      await tx.psychologistSession.update({
        where: { id: session.id },
        data: { status: SessionStatus.IN_PROGRESS, actualStartedAt: new Date() },
      });
    }
  });

  const refreshed = await prisma.psychologistSession.findUniqueOrThrow({ where: { id: session.id } });
  return {
    recorded: true,
    sessionStatus: refreshed.status,
    media: {
      status: "UNAVAILABLE" as const,
      provider: null,
      joinToken: null,
      reason: "Session media provider not configured",
    },
  };
};

export const leavePsychologistSession = async (accountId: string, sessionId: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const session = await loadOwnedSession(profile.id, sessionId);
  await prisma.attendanceEvent.create({
    data: {
      sessionId: session.id,
      participantRole: ParticipantRole.PSYCHOLOGIST,
      psychologistProfileId: profile.id,
      eventType: AttendanceEventType.LEFT,
      occurredAt: new Date(),
    },
  });
  return { recorded: true };
};

export const getSessionNotes = async (accountId: string, sessionId: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const session = await loadOwnedSession(profile.id, sessionId);
  return {
    privateNotes: session.privateNotes,
    privateNoteTags: session.privateNoteTags,
    updatedAt: session.updatedAt.toISOString(),
  };
};

export const putSessionNotes = async (
  accountId: string,
  sessionId: string,
  input: { privateNotes?: string | null; privateNoteTags?: string[] },
) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  await loadOwnedSession(profile.id, sessionId);
  const updated = await prisma.psychologistSession.update({
    where: { id: sessionId },
    data: {
      ...(input.privateNotes !== undefined ? { privateNotes: input.privateNotes } : {}),
      ...(input.privateNoteTags !== undefined ? { privateNoteTags: input.privateNoteTags } : {}),
    },
  });
  return {
    privateNotes: updated.privateNotes,
    privateNoteTags: updated.privateNoteTags,
    updatedAt: updated.updatedAt.toISOString(),
  };
};

export const completePsychologistSession = async (accountId: string, sessionId: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const session = await loadOwnedSession(profile.id, sessionId);

  if (session.status === SessionStatus.COMPLETED) {
    const payout = await prisma.psychologistPayout.findUnique({ where: { sessionId: session.id } });
    return { sessionStatus: SessionStatus.COMPLETED, payoutId: payout?.id ?? null };
  }

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
  return { sessionStatus: SessionStatus.COMPLETED, payoutId: payout?.id ?? null };
};

export const getAfterSession = async (accountId: string, sessionId: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const session = await loadOwnedSession(profile.id, sessionId);
  const availableAudios = await listPublishedAudiosForAftercare();
  return {
    sessionId: session.id,
    bookingId: session.bookingId,
    riskLevel: session.riskLevel,
    recommendedAudioIds: session.recommendedAudioIds,
    followUpRecommended: session.followUpRecommended,
    followUpNote: session.followUpNote,
    clientFacingNote: session.clientFacingNote,
    aftercareSubmittedAt: session.aftercareSubmittedAt?.toISOString() ?? null,
    availableAudios,
  };
};

export const putAfterSession = async (
  accountId: string,
  sessionId: string,
  input: {
    riskLevel: SessionRiskLevel;
    recommendedAudioIds?: string[];
    followUpRecommended?: boolean;
    followUpNote?: string | null;
    clientFacingNote?: string | null;
  },
) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const session = await loadOwnedSession(profile.id, sessionId);

  if (session.status !== SessionStatus.COMPLETED && session.status !== SessionStatus.IN_PROGRESS) {
    fail(409, "After-session can only be saved for in-progress or completed sessions");
  }

  const audioIds = input.recommendedAudioIds ?? [];
  if (audioIds.length > 0) {
    const published = await prisma.audioTrack.count({
      where: { id: { in: audioIds }, status: AudioPublishStatus.PUBLISHED },
    });
    if (published !== audioIds.length) {
      fail(400, "Validation failed", { recommendedAudioIds: ["All ids must be published audio tracks"] });
    }
  }

  const updated = await prisma.psychologistSession.update({
    where: { id: session.id },
    data: {
      riskLevel: input.riskLevel,
      recommendedAudioIds: audioIds,
      followUpRecommended: input.followUpRecommended ?? false,
      followUpNote: input.followUpNote ?? null,
      clientFacingNote: input.clientFacingNote ?? null,
      aftercareSubmittedAt: new Date(),
    },
  });

  if (input.riskLevel === SessionRiskLevel.URGENT) {
    // Escalation pipeline (safety lead + Tele-MANAS) not wired yet — intentional stub.
    console.warn("[aftercare] URGENT risk submitted", {
      sessionId: session.id,
      psychologistProfileId: profile.id,
    });
  }

  return {
    sessionId: updated.id,
    bookingId: updated.bookingId,
    riskLevel: updated.riskLevel,
    recommendedAudioIds: updated.recommendedAudioIds,
    followUpRecommended: updated.followUpRecommended,
    followUpNote: updated.followUpNote,
    clientFacingNote: updated.clientFacingNote,
    aftercareSubmittedAt: updated.aftercareSubmittedAt?.toISOString() ?? null,
  };
};
