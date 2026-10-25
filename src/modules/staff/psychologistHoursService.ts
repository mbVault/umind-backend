import {
  BookingStatus,
  CommunicationMode,
  Prisma,
  PsychologistOnboardingStep,
  PsychologistPresence,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { getOrCreatePsychologistProfile } from "./psychologistService";

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED];

const profileInclude = {
  specialisations: true,
  languages: true,
  documents: { orderBy: { createdAt: "desc" as const } },
  checks: true,
} satisfies Prisma.PsychologistProfileInclude;

export type WeeklyHours = Record<string, { start: string; end: string }[]>;

export const updatePsychologistPresence = async (
  accountId: string,
  presence: PsychologistPresence,
) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  return prisma.psychologistProfile.update({
    where: { id: profile.id },
    data: { presence },
    include: profileInclude,
  });
};

export const updatePsychologistHours = async (
  accountId: string,
  input: {
    presence?: PsychologistPresence;
    acceptingNewClients?: boolean;
    maxSessionsPerDay?: number | null;
    sessionModes?: CommunicationMode[];
    weeklyHours?: WeeklyHours | null;
  },
) => {
  const profile = await getOrCreatePsychologistProfile(accountId);

  if (input.sessionModes !== undefined && input.sessionModes.length === 0) {
    fail(400, "Validation failed", { sessionModes: ["Select at least one session mode"] });
  }

  const data: Prisma.PsychologistProfileUpdateInput = {};
  if (input.presence !== undefined) data.presence = input.presence;
  if (input.acceptingNewClients !== undefined) data.acceptingNewClients = input.acceptingNewClients;
  if (input.maxSessionsPerDay !== undefined) data.maxSessionsPerDay = input.maxSessionsPerDay;
  if (input.sessionModes !== undefined) data.sessionModes = input.sessionModes;
  if (input.weeklyHours !== undefined) data.weeklyHours = input.weeklyHours === null ? Prisma.JsonNull : input.weeklyHours;

  // Completing Hours advances onboarding when still on HOURS / earlier steps after docs.
  if (
    profile.onboardingStep === PsychologistOnboardingStep.HOURS ||
    profile.onboardingStep === PsychologistOnboardingStep.BACKGROUND_CHECK
  ) {
    data.onboardingStep = PsychologistOnboardingStep.COMPLETE;
  }

  return prisma.psychologistProfile.update({
    where: { id: profile.id },
    data,
    include: profileInclude,
  });
};

const classifySlot = (
  slot: { startsAt: Date; endsAt: Date },
  bookings: { scheduledStartAt: Date; scheduledEndAt: Date; status: BookingStatus }[],
): "OPEN" | "HELD" | "BOOKED" => {
  const hit = bookings.find(
    (b) => slot.startsAt < b.scheduledEndAt && slot.endsAt > b.scheduledStartAt,
  );
  if (!hit) return "OPEN";
  return hit.status === BookingStatus.PENDING_PAYMENT ? "HELD" : "BOOKED";
};

export const listStaffAvailability = async (input: {
  accountId: string;
  from: Date;
  to: Date;
}) => {
  if (input.to <= input.from) {
    fail(400, "Invalid availability window");
  }
  const profile = await getOrCreatePsychologistProfile(input.accountId);

  const slots = await prisma.psychologistAvailabilitySlot.findMany({
    where: {
      psychologistProfileId: profile.id,
      startsAt: { gte: input.from, lt: input.to },
    },
    orderBy: { startsAt: "asc" },
  });

  const bookings = await prisma.psychologistBooking.findMany({
    where: {
      psychologistProfileId: profile.id,
      status: { in: ACTIVE_BOOKING_STATUSES },
      scheduledStartAt: { lt: input.to },
      scheduledEndAt: { gt: input.from },
    },
    select: { scheduledStartAt: true, scheduledEndAt: true, status: true },
  });

  return {
    weeklyHours: profile.weeklyHours,
    presence: profile.presence,
    acceptingNewClients: profile.acceptingNewClients,
    maxSessionsPerDay: profile.maxSessionsPerDay,
    sessionModes: profile.sessionModes,
    items: slots.map((s) => ({
      id: s.id,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      status: classifySlot(s, bookings),
    })),
  };
};

/**
 * Soft replace: only OPEN future slots may be removed.
 * Held/booked slots are never deleted. Returns protected conflicts.
 */
export const replaceOpenAvailabilitySlots = async (input: {
  accountId: string;
  replaceOpenSlots: { startsAt: Date; endsAt: Date }[];
}) => {
  const profile = await getOrCreatePsychologistProfile(input.accountId);
  const now = new Date();

  for (const row of input.replaceOpenSlots) {
    if (row.endsAt <= row.startsAt) {
      fail(400, "Validation failed", { replaceOpenSlots: ["Each slot must have endsAt after startsAt"] });
    }
    if (row.startsAt.getTime() <= now.getTime()) {
      fail(400, "Validation failed", { replaceOpenSlots: ["Cannot create slots in the past"] });
    }
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.psychologistAvailabilitySlot.findMany({
      where: {
        psychologistProfileId: profile.id,
        startsAt: { gt: now },
      },
    });

    const bookings = await tx.psychologistBooking.findMany({
      where: {
        psychologistProfileId: profile.id,
        status: { in: ACTIVE_BOOKING_STATUSES },
        scheduledEndAt: { gt: now },
      },
      select: { scheduledStartAt: true, scheduledEndAt: true, status: true },
    });

    const desiredKeys = new Set(
      input.replaceOpenSlots.map((s) => `${s.startsAt.toISOString()}|${s.endsAt.toISOString()}`),
    );

    const protectedSlots: { id: string; startsAt: string; endsAt: string; status: "HELD" | "BOOKED" }[] = [];
    const toDelete: string[] = [];

    for (const slot of existing) {
      const status = classifySlot(slot, bookings);
      const key = `${slot.startsAt.toISOString()}|${slot.endsAt.toISOString()}`;
      if (status !== "OPEN") {
        protectedSlots.push({
          id: slot.id,
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
          status,
        });
        continue;
      }
      if (!desiredKeys.has(key)) {
        toDelete.push(slot.id);
      }
    }

    if (toDelete.length > 0) {
      await tx.psychologistAvailabilitySlot.deleteMany({
        where: { id: { in: toDelete }, psychologistProfileId: profile.id },
      });
    }

    const existingKeys = new Set(
      existing.map((s) => `${s.startsAt.toISOString()}|${s.endsAt.toISOString()}`),
    );
    const toCreate = input.replaceOpenSlots.filter(
      (s) => !existingKeys.has(`${s.startsAt.toISOString()}|${s.endsAt.toISOString()}`),
    );

    if (toCreate.length > 0) {
      await tx.psychologistAvailabilitySlot.createMany({
        data: toCreate.map((s) => ({
          psychologistProfileId: profile.id,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
        })),
        skipDuplicates: true,
      });
    }

    const refreshed = await listStaffAvailabilityInTx(tx, {
      psychologistProfileId: profile.id,
      from: now,
      to: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      weeklyHours: profile.weeklyHours,
      presence: profile.presence,
      acceptingNewClients: profile.acceptingNewClients,
      maxSessionsPerDay: profile.maxSessionsPerDay,
      sessionModes: profile.sessionModes,
    });

    return {
      ...refreshed,
      deletedOpenCount: toDelete.length,
      createdCount: toCreate.length,
      protectedSlots,
    };
  });
};

const listStaffAvailabilityInTx = async (
  tx: Prisma.TransactionClient,
  input: {
    psychologistProfileId: string;
    from: Date;
    to: Date;
    weeklyHours: Prisma.JsonValue;
    presence: PsychologistPresence;
    acceptingNewClients: boolean;
    maxSessionsPerDay: number | null;
    sessionModes: CommunicationMode[];
  },
) => {
  const slots = await tx.psychologistAvailabilitySlot.findMany({
    where: {
      psychologistProfileId: input.psychologistProfileId,
      startsAt: { gte: input.from, lt: input.to },
    },
    orderBy: { startsAt: "asc" },
  });
  const bookings = await tx.psychologistBooking.findMany({
    where: {
      psychologistProfileId: input.psychologistProfileId,
      status: { in: ACTIVE_BOOKING_STATUSES },
      scheduledStartAt: { lt: input.to },
      scheduledEndAt: { gt: input.from },
    },
    select: { scheduledStartAt: true, scheduledEndAt: true, status: true },
  });

  return {
    weeklyHours: input.weeklyHours,
    presence: input.presence,
    acceptingNewClients: input.acceptingNewClients,
    maxSessionsPerDay: input.maxSessionsPerDay,
    sessionModes: input.sessionModes,
    items: slots.map((s) => ({
      id: s.id,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      status: classifySlot(s, bookings),
    })),
  };
};
