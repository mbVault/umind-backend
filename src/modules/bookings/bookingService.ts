import {
  BillingMode,
  BookingStatus,
  CommunicationMode,
  OrderPurpose,
  PaymentProvider,
  Prisma,
  SubscriptionStatus,
} from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { getSubscriptionMeForUser } from "../subscriptions/entitlementService";
import { createOrderWithPayment } from "../payments/paymentService";
import { selectPaymentProviderForCurrentEnvironment } from "../payments/providerSelection";
import {
  BOOKING_DURATION_MINUTES,
  getBookingHoldTtlMinutes,
  getBookingPolicyVersion,
  getBookingSessionPriceMinorUnits,
} from "./bookingConfig";
import { getBookablePsychologistById } from "../discovery/discoveryService";
import { ensureSlotIsOpenForBooking } from "./bookingSlotGuards";
import { assertCommunicationModeAllowed, assertUnderDailySessionCap } from "./bookingOpsGuards";

export const assertUserCanBookPsychologist = async (userId: string): Promise<void> => {
  const me = await getSubscriptionMeForUser(userId);
  if (!me.entitlements.canBookPsychologist) {
    fail(403, "Active subscription required to book a psychologist");
  }
};

export type CreateBookingInput = {
  userId: string;
  psychologistProfileId: string;
  slotId: string;
  communicationMode: CommunicationMode;
};

export type CreateBookingResult = {
  booking: {
    id: string;
    status: BookingStatus;
    scheduledStartAt: string;
    scheduledEndAt: string;
    communicationMode: CommunicationMode;
    psychologistProfileId: string;
    requiresPayment: boolean;
  };
  checkout?: Awaited<ReturnType<typeof createOrderWithPayment>>;
};

export const createBookingFromSlot = async (input: CreateBookingInput): Promise<CreateBookingResult> => {
  await assertUserCanBookPsychologist(input.userId);
  await getBookablePsychologistById(input.psychologistProfileId);

  const slot = await prisma.psychologistAvailabilitySlot.findUnique({ where: { id: input.slotId } });
  if (!slot || slot.psychologistProfileId !== input.psychologistProfileId) {
    fail(404, "Availability slot not found");
  }
  if (slot.startsAt.getTime() <= Date.now()) {
    fail(400, "Cannot book a slot in the past");
  }

  const ops = await prisma.psychologistProfile.findUnique({
    where: { id: input.psychologistProfileId },
    select: { sessionModes: true, maxSessionsPerDay: true },
  });
  if (!ops) {
    fail(404, "Psychologist not found");
  }
  assertCommunicationModeAllowed(ops.sessionModes, input.communicationMode);

  const priceMinorUnits = getBookingSessionPriceMinorUnits();
  if (priceMinorUnits <= 0) {
    fail(503, "Session pricing is not configured");
  }
  const policyVersion = getBookingPolicyVersion();
  const holdMinutes = getBookingHoldTtlMinutes();
  const reservationExpiresAt = new Date(Date.now() + holdMinutes * 60 * 1000);

  try {
    return await prisma.$transaction(async (tx) => {
      await ensureSlotIsOpenForBooking(tx, slot);
      await assertUnderDailySessionCap(tx, {
        psychologistProfileId: input.psychologistProfileId,
        scheduledStartAt: slot.startsAt,
        maxSessionsPerDay: ops.maxSessionsPerDay,
      });

      const booking = await tx.psychologistBooking.create({
        data: {
          userId: input.userId,
          psychologistProfileId: input.psychologistProfileId,
          scheduledStartAt: slot.startsAt,
          scheduledEndAt: slot.endsAt,
          durationMinutes: BOOKING_DURATION_MINUTES,
          communicationMode: input.communicationMode,
          status: BookingStatus.PENDING_PAYMENT,
          reservationExpiresAt,
          policyVersion,
          policySnapshot: {
            version: policyVersion,
            holdMinutes,
            priceMinorUnits,
            initialPolicyWindowHours: env.BOOKING_CANCEL_NOTICE_HOURS,
            lateCancelRefundPercent: env.BOOKING_LATE_CANCEL_REFUND_PERCENT,
          },
        },
      });

      return {
        booking: {
          id: booking.id,
          status: booking.status,
          scheduledStartAt: booking.scheduledStartAt.toISOString(),
          scheduledEndAt: booking.scheduledEndAt.toISOString(),
          communicationMode: booking.communicationMode,
          psychologistProfileId: booking.psychologistProfileId,
          requiresPayment: true,
        },
      };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2034" || err.code === "P2002")) {
      fail(409, "This slot is no longer available");
    }
    throw err;
  }
};

export const startBookingCheckout = async (input: {
  userId: string;
  bookingId: string;
  idempotencyKey?: string;
}) => {
  const booking = await prisma.psychologistBooking.findFirst({
    where: { id: input.bookingId, userId: input.userId },
  });
  if (!booking) {
    fail(404, "Booking not found");
  }
  if (booking.status !== BookingStatus.PENDING_PAYMENT) {
    fail(409, "Booking is not awaiting payment");
  }
  if (booking.reservationExpiresAt && booking.reservationExpiresAt.getTime() < Date.now()) {
    fail(409, "Booking reservation has expired");
  }

  const priceMinorUnits = getBookingSessionPriceMinorUnits();
  if (priceMinorUnits <= 0) {
    fail(400, "This booking does not require payment");
  }

  await assertUserCanBookPsychologist(input.userId);

  const provider = selectPaymentProviderForCurrentEnvironment();

  const checkout = await createOrderWithPayment({
    userId: input.userId,
    purpose: OrderPurpose.PSYCHOLOGIST_BOOKING,
    bookingId: booking.id,
    amountMinorUnits: priceMinorUnits,
    currency: "INR",
    idempotencyKey: input.idempotencyKey,
    provider,
  });

  return { bookingId: booking.id, ...checkout };
};

export const getBookingForUser = async (userId: string, bookingId: string) => {
  const booking = await prisma.psychologistBooking.findFirst({
    where: { id: bookingId, userId },
    include: { session: { select: { id: true, status: true } } },
  });
  if (!booking) {
    fail(404, "Booking not found");
  }
  return {
    id: booking.id,
    status: booking.status,
    scheduledStartAt: booking.scheduledStartAt.toISOString(),
    scheduledEndAt: booking.scheduledEndAt.toISOString(),
    communicationMode: booking.communicationMode,
    psychologistProfileId: booking.psychologistProfileId,
    session: booking.session,
  };
};

export const listBookingsForUser = async (userId: string) => {
  const items = await prisma.psychologistBooking.findMany({
    where: { userId },
    orderBy: { scheduledStartAt: "desc" },
    include: { session: { select: { id: true, status: true } } },
  });
  return {
    items: items.map((b) => ({
      id: b.id,
      status: b.status,
      scheduledStartAt: b.scheduledStartAt.toISOString(),
      scheduledEndAt: b.scheduledEndAt.toISOString(),
      communicationMode: b.communicationMode,
      psychologistProfileId: b.psychologistProfileId,
      session: b.session,
    })),
  };
};

/** Test/dev helper: grant ACTIVE subscription for booking entitlement tests. */
export const ensureActiveSubscriptionForUser = async (userId: string): Promise<void> => {
  const existing = await prisma.subscription.findFirst({
    where: { userId, status: SubscriptionStatus.ACTIVE },
  });
  if (existing) {
    return;
  }
  const plan = await prisma.subscriptionPlan.findFirst({ where: { code: "MONTHLY", isActive: true } });
  if (!plan) {
    fail(500, "Missing MONTHLY plan seed");
  }
  await prisma.subscription.create({
    data: {
      userId,
      planId: plan!.id,
      billingMode: BillingMode.MANUAL,
      status: SubscriptionStatus.ACTIVE,
      provider: PaymentProvider.RAZORPAY,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + plan!.durationDays * 86400000),
    },
  });
};
