import { AudioPublishStatus, BookingStatus, SessionRiskLevel, SessionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { getMoodHistory } from "../mood/moodService";
import { getOrCreatePsychologistProfile } from "./psychologistService";
import { clientPublicSlice, resolveClientRefForPsychologist, toClientRef } from "./clientRef";

const utcDayBounds = (date: Date) => {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
};

const monthBounds = (year: number, month1to12: number) => {
  const start = new Date(Date.UTC(year, month1to12 - 1, 1));
  const end = new Date(Date.UTC(year, month1to12, 1));
  return { start, end };
};

const requireOwnedBooking = async (psychologistProfileId: string, bookingId: string) => {
  const booking = await prisma.psychologistBooking.findFirst({
    where: { id: bookingId, psychologistProfileId },
    include: {
      session: true,
      user: {
        select: {
          id: true,
          alias: true,
          avatarId: true,
          lifeStage: true,
          gender: true,
          startingFeelings: true,
        },
      },
    },
  });
  if (!booking) fail(404, "Booking not found");
  return booking;
};

export const getPsychologistDashboard = async (accountId: string, date: Date) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const { dayStart, dayEnd } = utcDayBounds(date);
  const now = new Date();
  const { start: monthStart, end: monthEnd } = monthBounds(now.getUTCFullYear(), now.getUTCMonth() + 1);

  const [todayBookings, monthCompletedCount, monthPayouts, nextBooking] = await Promise.all([
    prisma.psychologistBooking.findMany({
      where: {
        psychologistProfileId: profile.id,
        scheduledStartAt: { gte: dayStart, lt: dayEnd },
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED, BookingStatus.PENDING_PAYMENT] },
      },
      include: {
        session: true,
        user: { select: { id: true, alias: true, avatarId: true } },
      },
      orderBy: { scheduledStartAt: "asc" },
    }),
    prisma.psychologistBooking.count({
      where: {
        psychologistProfileId: profile.id,
        status: BookingStatus.COMPLETED,
        scheduledStartAt: { gte: monthStart, lt: monthEnd },
      },
    }),
    prisma.psychologistPayout.findMany({
      where: {
        psychologistProfileId: profile.id,
        createdAt: { gte: monthStart, lt: monthEnd },
      },
      select: { psychologistShareMinorUnits: true, status: true, currency: true },
    }),
    prisma.psychologistBooking.findFirst({
      where: {
        psychologistProfileId: profile.id,
        status: BookingStatus.CONFIRMED,
        scheduledStartAt: { gte: now },
      },
      include: {
        session: true,
        user: { select: { id: true, alias: true, avatarId: true } },
      },
      orderBy: { scheduledStartAt: "asc" },
    }),
  ]);

  const currency = monthPayouts[0]?.currency ?? "INR";
  let pendingMinorUnits = 0;
  let paidMinorUnits = 0;
  let psychologistShareMinorUnits = 0;
  for (const p of monthPayouts) {
    psychologistShareMinorUnits += p.psychologistShareMinorUnits;
    if (p.status === "PAID") paidMinorUnits += p.psychologistShareMinorUnits;
    else pendingMinorUnits += p.psychologistShareMinorUnits;
  }

  const relevantBookings = [
    ...todayBookings,
    ...(nextBooking && !todayBookings.some((b) => b.id === nextBooking.id) ? [nextBooking] : []),
  ];

  const sessionNumberByBookingId = new Map<string, number>();
  await Promise.all(
    relevantBookings.map(async (b) => {
      const prior = await prisma.psychologistBooking.count({
        where: {
          psychologistProfileId: profile.id,
          userId: b.userId,
          status: BookingStatus.COMPLETED,
          scheduledStartAt: { lt: b.scheduledStartAt },
        },
      });
      sessionNumberByBookingId.set(b.id, prior + 1);
    })
  );

  const flaggedUserIds = [
    ...new Set(
      todayBookings
        .filter((b) => b.status === BookingStatus.CONFIRMED)
        .map((b) => b.userId)
    ),
  ];
  const urgentByUser = new Map<string, boolean>();
  if (flaggedUserIds.length > 0) {
    const urgents = await prisma.psychologistSession.findMany({
      where: {
        riskLevel: SessionRiskLevel.URGENT,
        aftercareSubmittedAt: { not: null },
        booking: {
          psychologistProfileId: profile.id,
          userId: { in: flaggedUserIds },
        },
      },
      select: { booking: { select: { userId: true } } },
    });
    for (const u of urgents) {
      urgentByUser.set(u.booking.userId, true);
    }
  }

  const mapBooking = (b: (typeof todayBookings)[number] | NonNullable<typeof nextBooking>) => {
    const hasFlag = urgentByUser.get(b.userId) === true;
    return {
      bookingId: b.id,
      sessionId: b.session?.id ?? null,
      scheduledStartAt: b.scheduledStartAt.toISOString(),
      scheduledEndAt: b.scheduledEndAt.toISOString(),
      communicationMode: b.communicationMode,
      bookingStatus: b.status,
      sessionStatus: b.session?.status ?? null,
      shareSaathiSummary: b.shareSaathiSummary,
      shareMoodHistory: b.shareMoodHistory,
      sessionNumber: sessionNumberByBookingId.get(b.id) ?? 1,
      hasSafetyFlag: hasFlag,
      client: {
        clientRef: toClientRef(profile.id, b.user.id),
        ...clientPublicSlice(b.user),
      },
    };
  };

  const mappedToday = todayBookings.map(mapBooking);
  const mappedNext = nextBooking ? mapBooking(nextBooking) : null;

  const safetyAlerts = mappedToday
    .filter((b) => b.hasSafetyFlag && b.bookingStatus === BookingStatus.CONFIRMED)
    .map((b) => ({
      bookingId: b.bookingId,
      scheduledStartAt: b.scheduledStartAt,
      clientAlias: b.client.alias,
      message: "Earlier session marked URGENT risk. Review before this session.",
    }));

  return {
    date: dayStart.toISOString().slice(0, 10),
    presence: profile.presence,
    acceptingNewClients: profile.acceptingNewClients,
    displayName: profile.displayName,
    avatarInitials: profile.avatarInitials,
    avatarColor: profile.avatarColor,
    todaySessionCount: todayBookings.length,
    monthSessionCount: monthCompletedCount,
    nextBooking: mappedNext,
    todayBookings: mappedToday,
    safetyAlerts,
    monthEarnings: {
      currency,
      psychologistShareMinorUnits,
      pendingMinorUnits,
      paidMinorUnits,
      sessionCount: monthPayouts.length,
    },
  };
};

export const listPsychologistBookingsForDate = async (accountId: string, date: Date) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const { dayStart, dayEnd } = utcDayBounds(date);
  const bookings = await prisma.psychologistBooking.findMany({
    where: {
      psychologistProfileId: profile.id,
      scheduledStartAt: { gte: dayStart, lt: dayEnd },
    },
    include: {
      session: true,
      user: { select: { id: true, alias: true, avatarId: true } },
    },
    orderBy: { scheduledStartAt: "asc" },
  });

  return {
    date: dayStart.toISOString().slice(0, 10),
    items: bookings.map((b) => ({
      id: b.id,
      sessionId: b.session?.id ?? null,
      scheduledStartAt: b.scheduledStartAt.toISOString(),
      scheduledEndAt: b.scheduledEndAt.toISOString(),
      durationMinutes: b.durationMinutes,
      communicationMode: b.communicationMode,
      bookingStatus: b.status,
      sessionStatus: b.session?.status ?? null,
      client: {
        clientRef: toClientRef(profile.id, b.user.id),
        ...clientPublicSlice(b.user),
      },
    })),
  };
};

export const getBookingBrief = async (accountId: string, bookingId: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const booking = await requireOwnedBooking(profile.id, bookingId);

  const priorCompleted = await prisma.psychologistBooking.count({
    where: {
      psychologistProfileId: profile.id,
      userId: booking.userId,
      status: BookingStatus.COMPLETED,
      scheduledStartAt: { lt: booking.scheduledStartAt },
    },
  });

  let saathiSummary: string | null = null;
  if (booking.shareSaathiSummary) {
    const memory = await prisma.saathiMemory.findFirst({
      where: { conversation: { userId: booking.userId } },
      orderBy: { updatedAt: "desc" },
      select: { summary: true },
    });
    saathiSummary = memory?.summary ?? null;
  }

  let moodHistory: { date: string; moodName: string }[] = [];
  if (booking.shareMoodHistory) {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    const hist = await getMoodHistory(booking.userId, fromStr, toStr);
    moodHistory = hist.items.map((i) => ({ date: i.date, moodName: i.mood.name }));
  }

  return {
    bookingId: booking.id,
    sessionId: booking.session?.id ?? null,
    scheduledStartAt: booking.scheduledStartAt.toISOString(),
    scheduledEndAt: booking.scheduledEndAt.toISOString(),
    communicationMode: booking.communicationMode,
    bookingStatus: booking.status,
    sessionNumber: priorCompleted + 1,
    client: {
      clientRef: toClientRef(profile.id, booking.user.id),
      ...clientPublicSlice(booking.user),
    },
    shareSaathiSummary: booking.shareSaathiSummary,
    saathiSummary,
    shareMoodHistory: booking.shareMoodHistory,
    moodHistory,
  };
};

/** Soft derive only — no persisted SafetyFlag table yet. */
export const getBookingSafetyFlags = async (accountId: string, bookingId: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const booking = await requireOwnedBooking(profile.id, bookingId);

  const priorUrgent = await prisma.psychologistSession.findFirst({
    where: {
      booking: {
        psychologistProfileId: profile.id,
        userId: booking.userId,
      },
      riskLevel: SessionRiskLevel.URGENT,
      aftercareSubmittedAt: { not: null },
    },
    orderBy: { aftercareSubmittedAt: "desc" },
    select: { id: true, aftercareSubmittedAt: true },
  });

  const flags: { code: string; severity: string; source: string; message: string }[] = [];
  if (priorUrgent) {
    flags.push({
      code: "PRIOR_URGENT_RISK",
      severity: "HIGH",
      source: "PRIOR_AFTERCARE",
      message: "A previous session with this client was marked URGENT risk.",
    });
  }

  return { bookingId: booking.id, flags };
};

export const listPsychologistClients = async (accountId: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const bookings = await prisma.psychologistBooking.findMany({
    where: { psychologistProfileId: profile.id },
    include: {
      user: {
        select: {
          id: true,
          alias: true,
          avatarId: true,
          lifeStage: true,
          startingFeelings: true,
        },
      },
      session: { select: { status: true, riskLevel: true, aftercareSubmittedAt: true } },
    },
    orderBy: { scheduledStartAt: "desc" },
  });

  const byUser = new Map<
    string,
    {
      user: (typeof bookings)[number]["user"];
      sessionCount: number;
      lastSessionAt: Date | null;
      nextSessionAt: Date | null;
      hadUrgent: boolean;
    }
  >();

  const now = Date.now();
  for (const b of bookings) {
    let row = byUser.get(b.userId);
    if (!row) {
      row = {
        user: b.user,
        sessionCount: 0,
        lastSessionAt: null,
        nextSessionAt: null,
        hadUrgent: false,
      };
      byUser.set(b.userId, row);
    }
    if (b.status === BookingStatus.COMPLETED || b.session?.status === SessionStatus.COMPLETED) {
      row.sessionCount += 1;
      if (!row.lastSessionAt || b.scheduledStartAt > row.lastSessionAt) {
        row.lastSessionAt = b.scheduledStartAt;
      }
    }
    if (
      b.status === BookingStatus.CONFIRMED &&
      b.scheduledStartAt.getTime() >= now &&
      (!row.nextSessionAt || b.scheduledStartAt < row.nextSessionAt)
    ) {
      row.nextSessionAt = b.scheduledStartAt;
    }
    if (b.session?.riskLevel === SessionRiskLevel.URGENT) {
      row.hadUrgent = true;
    }
  }

  const items = [...byUser.entries()].map(([userId, row]) => {
    let trend: "IMPROVING" | "STEADY" | "WATCH" | null = "STEADY";
    if (row.hadUrgent) trend = "WATCH";
    else if (row.sessionCount >= 3) trend = "IMPROVING";

    return {
      clientRef: toClientRef(profile.id, userId),
      ...clientPublicSlice({
        alias: row.user.alias,
        avatarId: row.user.avatarId,
        lifeStage: row.user.lifeStage,
        startingFeelings: row.user.startingFeelings,
      }),
      sessionCount: row.sessionCount,
      lastSessionAt: row.lastSessionAt?.toISOString() ?? null,
      nextSessionAt: row.nextSessionAt?.toISOString() ?? null,
      relationship: row.nextSessionAt ? "ACTIVE" : "PAST",
      trend,
    };
  });

  items.sort((a, b) => {
    const aT = a.nextSessionAt ?? a.lastSessionAt ?? "";
    const bT = b.nextSessionAt ?? b.lastSessionAt ?? "";
    return bT.localeCompare(aT);
  });

  return { items };
};

export const getClientBrief = async (accountId: string, clientRef: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const userId = await resolveClientRefForPsychologist(profile.id, clientRef);
  const latest = await prisma.psychologistBooking.findFirst({
    where: { psychologistProfileId: profile.id, userId },
    orderBy: { scheduledStartAt: "desc" },
  });
  if (!latest) fail(404, "Client not found");
  return getBookingBrief(accountId, latest.id);
};

export const getClientHistory = async (accountId: string, clientRef: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const userId = await resolveClientRefForPsychologist(profile.id, clientRef);
  const bookings = await prisma.psychologistBooking.findMany({
    where: { psychologistProfileId: profile.id, userId },
    include: { session: true },
    orderBy: { scheduledStartAt: "desc" },
  });

  return {
    clientRef,
    items: bookings.map((b) => ({
      bookingId: b.id,
      sessionId: b.session?.id ?? null,
      scheduledStartAt: b.scheduledStartAt.toISOString(),
      scheduledEndAt: b.scheduledEndAt.toISOString(),
      communicationMode: b.communicationMode,
      bookingStatus: b.status,
      sessionStatus: b.session?.status ?? null,
      riskLevel: b.session?.aftercareSubmittedAt ? b.session.riskLevel : null,
    })),
  };
};

export const listPublishedAudiosForAftercare = async () => {
  const tracks = await prisma.audioTrack.findMany({
    where: { status: AudioPublishStatus.PUBLISHED },
    select: { id: true, title: true, category: true },
    orderBy: { title: "asc" },
    take: 100,
  });
  return tracks;
};
