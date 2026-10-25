import { BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { getBookablePsychologistById } from "../discovery/discoveryService";

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED];

const slotOverlapsActiveBooking = (
  slot: { startsAt: Date; endsAt: Date },
  bookings: { scheduledStartAt: Date; scheduledEndAt: Date }[],
): boolean =>
  bookings.some(
    (b) => slot.startsAt < b.scheduledEndAt && slot.endsAt > b.scheduledStartAt,
  );

export const listOpenAvailabilityForPsychologist = async (input: {
  psychologistProfileId: string;
  from: Date;
  to: Date;
}) => {
  if (input.to <= input.from) {
    fail(400, "Invalid availability window");
  }

  await getBookablePsychologistById(input.psychologistProfileId);

  const slots = await prisma.psychologistAvailabilitySlot.findMany({
    where: {
      psychologistProfileId: input.psychologistProfileId,
      startsAt: { gte: input.from, lt: input.to },
    },
    orderBy: { startsAt: "asc" },
  });

  const bookings = await prisma.psychologistBooking.findMany({
    where: {
      psychologistProfileId: input.psychologistProfileId,
      status: { in: ACTIVE_BOOKING_STATUSES },
      scheduledStartAt: { lt: input.to },
      scheduledEndAt: { gt: input.from },
    },
    select: { scheduledStartAt: true, scheduledEndAt: true },
  });

  const open = slots.filter((slot) => !slotOverlapsActiveBooking(slot, bookings));

  return {
    items: open.map((s) => ({
      id: s.id,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
    })),
  };
};

export const seedAvailabilitySlotsForPsychologist = async (input: {
  psychologistProfileId: string;
  daysAhead?: number;
  dailyStartHourUtc?: number;
  slotsPerDay?: number;
}): Promise<number> => {
  const days = input.daysAhead ?? 14;
  const startHour = input.dailyStartHourUtc ?? 4;
  const slotsPerDay = input.slotsPerDay ?? 6;
  const durationMs = 40 * 60 * 1000;
  const now = new Date();
  const rows: Prisma.PsychologistAvailabilitySlotCreateManyInput[] = [];

  for (let d = 1; d <= days; d += 1) {
    for (let i = 0; i < slotsPerDay; i += 1) {
      const startsAt = new Date(now);
      startsAt.setUTCDate(startsAt.getUTCDate() + d);
      startsAt.setUTCHours(startHour + i, 0, 0, 0);
      const endsAt = new Date(startsAt.getTime() + durationMs);
      rows.push({
        psychologistProfileId: input.psychologistProfileId,
        startsAt,
        endsAt,
      });
    }
  }

  const result = await prisma.psychologistAvailabilitySlot.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return result.count;
};
