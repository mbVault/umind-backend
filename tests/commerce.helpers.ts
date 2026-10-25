import {
  AccountStatus,
  BookingStatus,
  CommunicationMode,
  OrderPurpose,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  PsychologistPresence,
  SessionStatus,
  StaffRole,
  VerificationCheckStatus,
} from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { REQUIRED_VERIFICATION_CHECKS } from "../src/modules/staff/permissions";

export const SESSION_PRICE_TEST = 49900;

export const seedLivePsychologist = async (displayName = "Dr Test") => {
  const account = await prisma.account.create({
    data: {
      superTokensUserId: `st-commerce-${Date.now()}-${Math.random()}`,
      status: AccountStatus.ACTIVE,
      roles: { create: [{ role: StaffRole.PSYCHOLOGIST }] },
    },
  });
  return prisma.psychologistProfile.create({
    data: {
      accountId: account.id,
      displayName,
      publicationStatus: "LIVE",
      accountStatus: "ACTIVE",
      publishedAt: new Date(),
      presence: PsychologistPresence.ONLINE,
      acceptingNewClients: true,
      maxSessionsPerDay: 8,
      sessionModes: [CommunicationMode.CHAT, CommunicationMode.VOICE, CommunicationMode.VIDEO],
      weeklyHours: {
        mon: [{ start: "09:00", end: "17:00" }],
        tue: [{ start: "09:00", end: "17:00" }],
        wed: [{ start: "09:00", end: "17:00" }],
        thu: [{ start: "09:00", end: "17:00" }],
        fri: [{ start: "09:00", end: "17:00" }],
        sat: [],
        sun: [],
      },
      specialisations: { create: [{ code: "STRESS" }] },
      languages: { create: [{ code: "ENGLISH" }] },
      checks: {
        create: REQUIRED_VERIFICATION_CHECKS.map((type) => ({
          type,
          status: VerificationCheckStatus.VERIFIED,
        })),
      },
    },
  });
};

export const createFutureSlot = async (psychologistProfileId: string, hoursFromNow: number) => {
  const startsAt = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 40 * 60 * 1000);
  return prisma.psychologistAvailabilitySlot.create({
    data: { psychologistProfileId, startsAt, endsAt },
  });
};

/** Simulates verified session payment → CONFIRMED booking + SCHEDULED session (for policy tests). */
export const confirmBookingWithSucceededPayment = async (input: {
  userId: string;
  bookingId: string;
  amountMinorUnits?: number;
}) => {
  const amount = input.amountMinorUnits ?? SESSION_PRICE_TEST;
  const order = await prisma.order.create({
    data: {
      userId: input.userId,
      purpose: OrderPurpose.PSYCHOLOGIST_BOOKING,
      bookingId: input.bookingId,
      amountMinorUnits: amount,
      currency: "INR",
      provider: PaymentProvider.RAZORPAY,
      status: OrderStatus.COMPLETED,
    },
  });
  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: PaymentProvider.RAZORPAY,
      amountMinorUnits: amount,
      currency: "INR",
      status: PaymentStatus.SUCCEEDED,
      providerPaymentId: `pay_test_${input.bookingId.slice(0, 8)}`,
      paidAt: new Date(),
    },
  });
  await prisma.psychologistBooking.update({
    where: { id: input.bookingId },
    data: { status: BookingStatus.CONFIRMED, reservationExpiresAt: null },
  });
  await prisma.psychologistSession.upsert({
    where: { bookingId: input.bookingId },
    create: { bookingId: input.bookingId, status: SessionStatus.SCHEDULED },
    update: { status: SessionStatus.SCHEDULED },
  });
};
