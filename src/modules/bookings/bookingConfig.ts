import { env } from "../../config/env";

export const BOOKING_DURATION_MINUTES = 40;

const readIntEnv = (key: "BOOKING_SESSION_PRICE_MINOR_UNITS" | "BOOKING_HOLD_TTL_MINUTES"): number => {
  const live = process.env[key];
  if (live !== undefined && live !== "") {
    return Number(live);
  }
  return env[key];
};

export const getBookingSessionPriceMinorUnits = (): number => readIntEnv("BOOKING_SESSION_PRICE_MINOR_UNITS");

export const getBookingHoldTtlMinutes = (): number => readIntEnv("BOOKING_HOLD_TTL_MINUTES");

export const getBookingPolicyVersion = (): string =>
  (process.env.BOOKING_POLICY_VERSION ?? env.BOOKING_POLICY_VERSION).trim();
