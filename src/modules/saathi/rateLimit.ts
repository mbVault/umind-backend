import { fail } from "../../lib/errors";
import { env } from "../../config/env";

const hits = new Map<string, number[]>();

/** Simple in-memory limiter for Saathi messages (per process). */
export const assertSaathiMessageRateLimit = (userId: string): void => {
  const now = Date.now();
  const windowMs = 60_000;
  const max = env.SAATHI_MESSAGE_RATE_LIMIT_PER_MIN;
  const prev = (hits.get(userId) ?? []).filter((t) => now - t < windowMs);
  if (prev.length >= max) {
    fail(429, "Too many Saathi messages; please wait a moment");
  }
  prev.push(now);
  hits.set(userId, prev);
};
