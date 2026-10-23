import { Request, Response, NextFunction } from "express";
import { fail } from "../lib/errors";

/**
 * Minimal in-memory rate limiter.
 *
 * Limitations:
 * - Per-process only (not shared across instances / restarts).
 * - Suitable for single-node development and interim production with one instance.
 * - Replace the store behind RateLimitStore with Redis (or similar) for multi-instance deploys.
 */

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const entry = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, entry);
      return entry;
    }
    existing.count += 1;
    this.buckets.set(key, existing);
    return existing;
  }
}

export const rateLimitStore: RateLimitStore = new MemoryRateLimitStore();

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
  keyFn?: (req: Request) => string;
}

export const createRateLimiter = (options: RateLimitOptions) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const identity = options.keyFn?.(req) ?? req.ip ?? "unknown";
      const key = `${options.keyPrefix}:${identity}`;
      const result = await rateLimitStore.increment(key, options.windowMs);
      const remaining = Math.max(0, options.max - result.count);
      res.setHeader("X-RateLimit-Limit", String(options.max));
      res.setHeader("X-RateLimit-Remaining", String(remaining));
      res.setHeader("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
      if (result.count > options.max) {
        fail(429, "Too many requests");
      }
      next();
    } catch (err) {
      next(err);
    }
  };
};

/** Sensitive provisioning / invitation endpoints. */
export const invitationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyPrefix: "staff-invite",
});
