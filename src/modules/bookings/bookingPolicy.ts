import { env } from "../../config/env";

const readNum = (key: "BOOKING_INITIAL_POLICY_WINDOW_HOURS" | "BOOKING_LATE_CANCEL_REFUND_PERCENT" | "BOOKING_MAX_CUSTOMER_RESCHEDULES"): number => {
  const live = process.env[key];
  if (live !== undefined && live !== "") {
    return Number(live);
  }
  if (key === "BOOKING_INITIAL_POLICY_WINDOW_HOURS") {
    return env.BOOKING_CANCEL_NOTICE_HOURS;
  }
  return env[key];
};

/** First N hours after booking creation — full session refund on cancel; no customer reschedule yet. */
export const getInitialPolicyWindowHours = (): number => readNum("BOOKING_INITIAL_POLICY_WINDOW_HOURS");

/** Refund percentage (0–100) of the paid session fee after the initial window (50% = half back). */
export const getLateCancelRefundPercent = (): number => readNum("BOOKING_LATE_CANCEL_REFUND_PERCENT");

export const getMaxCustomerReschedules = (): number => readNum("BOOKING_MAX_CUSTOMER_RESCHEDULES");

export const hoursSinceBookingCreation = (bookingCreatedAt: Date, now = new Date()): number =>
  (now.getTime() - bookingCreatedAt.getTime()) / (60 * 60 * 1000);

export const isWithinInitialPolicyWindow = (bookingCreatedAt: Date, now = new Date()): boolean =>
  hoursSinceBookingCreation(bookingCreatedAt, now) < getInitialPolicyWindowHours();

/** After initial window: 50% late-cancel deduction (50% refundable). */
export const isLateCustomerCancel = (bookingCreatedAt: Date, now = new Date()): boolean =>
  !isWithinInitialPolicyWindow(bookingCreatedAt, now);

/** Customer reschedule is only allowed after the initial post-booking window. */
export const isCustomerRescheduleAllowed = (bookingCreatedAt: Date, now = new Date()): boolean =>
  !isWithinInitialPolicyWindow(bookingCreatedAt, now);
