import { BookingStatus, Prisma } from "@prisma/client";
import { fail } from "../../lib/errors";

const ACTIVE_SLOT_STATUSES: BookingStatus[] = [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED];

export const ensureSlotIsOpenForBooking = async (
  tx: Prisma.TransactionClient,
  slot: { psychologistProfileId: string; startsAt: Date; endsAt: Date },
  excludeBookingId?: string,
): Promise<void> => {
  const overlap = await tx.psychologistBooking.findFirst({
    where: {
      psychologistProfileId: slot.psychologistProfileId,
      status: { in: ACTIVE_SLOT_STATUSES },
      scheduledStartAt: { lt: slot.endsAt },
      scheduledEndAt: { gt: slot.startsAt },
      ...(excludeBookingId ? { NOT: { id: excludeBookingId } } : {}),
    },
  });
  if (overlap) {
    fail(409, "This slot is no longer available");
  }
};
