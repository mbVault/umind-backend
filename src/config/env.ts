import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .default(process.env.NODE_ENV === "test" ? "postgresql://postgres:test@localhost:5432/umind_test" : ""),
  CORS_ORIGIN: z.string().default("*"),
  JWT_SECRET: z.string().min(32),
  TOKEN_PEPPER: z.string().min(16),
  RECOVERY_PEPPER: z.string().min(16),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().default(60 * 60 * 24 * 30),

  // SuperTokens (staff). Optional in test when STAFF_AUTH_TEST_BYPASS=true.
  SUPERTOKENS_CONNECTION_URI: z.string().optional().default(""),
  SUPERTOKENS_API_KEY: z.string().optional().default(""),
  SUPERTOKENS_APP_NAME: z.string().default("U Mind Staff"),
  SUPERTOKENS_API_DOMAIN: z.string().default("http://localhost:4000"),
  SUPERTOKENS_WEBSITE_DOMAIN: z.string().default("http://localhost:3000"),
  SUPERTOKENS_API_BASE_PATH: z.string().default("/api/v1/staff/auth"),
  SUPERTOKENS_WEBSITE_BASE_PATH: z.string().default("/auth"),

  /** When true (test only), allow X-Test-SuperTokens-User-Id instead of a live ST session. */
  STAFF_AUTH_TEST_BYPASS: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1")
    .default("false"),

  /**
   * Object storage driver. `local` = filesystem under LOCAL_STORAGE_ROOT (dev).
   * Cloudflare R2 will be a future driver; production should not rely on local forever.
   */
  OBJECT_STORAGE_DRIVER: z.enum(["none", "local"]).default("local"),
  LOCAL_STORAGE_ROOT: z.string().default("./.local-storage"),
  LOCAL_STORAGE_URL_TTL_SEC: z.coerce.number().int().min(60).default(900),
  /** Public base URL used when minting local signed storage URLs. */
  PUBLIC_API_BASE_URL: z.string().optional().default(""),

  /** Legacy flag; prefer OBJECT_STORAGE_DRIVER. Kept for compatibility. */
  OBJECT_STORAGE_CONFIGURED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1")
    .default("false"),

  INVITATION_TOKEN_TTL_HOURS: z.coerce.number().default(72),
  INVITATION_TOKEN_PEPPER: z.string().min(16).optional(),

  /** Payments — optional until checkout/webhooks are wired; secrets backend-only. */
  RAZORPAY_KEY_ID: z.string().optional().default(""),
  RAZORPAY_KEY_SECRET: z.string().optional().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(""),
  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_PUBLISHABLE_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  /** Local dev only: IN → Razorpay default; never enable spoofable country in production. */
  PAYMENT_DEV_COUNTRY: z.string().length(2).optional().default("IN"),

  /** Per-session booking fee in minor units (separate from subscription; provisional ₹499 = 49900). */
  BOOKING_SESSION_PRICE_MINOR_UNITS: z.coerce.number().int().min(1).default(49900),
  BOOKING_HOLD_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(15),
  BOOKING_POLICY_VERSION: z.string().default("2026-04"),
  BOOKING_CANCEL_NOTICE_HOURS: z.coerce.number().int().min(1).default(24),
  BOOKING_LATE_CANCEL_REFUND_PERCENT: z.coerce.number().int().min(0).max(100).default(50),
  BOOKING_MAX_CUSTOMER_RESCHEDULES: z.coerce.number().int().min(0).default(2),
  // Product: ₹499 session · psychologist keeps 70%
  PAYOUT_PSYCHOLOGIST_SHARE_PERCENT: z.coerce.number().int().min(0).max(100).default(70),
  PAYOUT_SPLIT_VERSION: z.string().default("2026-04"),
  SESSION_PSYCH_NO_SHOW_GRACE_MINUTES: z.coerce.number().int().min(1).default(2),

  /** Saathi LLM — stub by default; set SAATHI_LLM_PROVIDER=openai + OPENAI_API_KEY for live. */
  SAATHI_LLM_PROVIDER: z.enum(["stub", "openai"]).default("stub"),
  OPENAI_API_KEY: z.string().optional().default(""),
  SAATHI_LLM_MODEL: z.string().default("gpt-4o-mini"),
  SAATHI_LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  SAATHI_MESSAGE_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(30),
});

const parsed = envSchema.safeParse({
  ...process.env,
  JWT_SECRET: process.env.JWT_SECRET ?? (process.env.NODE_ENV === "test" ? "test-jwt-secret-min-32-chars-long!!" : undefined),
  TOKEN_PEPPER: process.env.TOKEN_PEPPER ?? (process.env.NODE_ENV === "test" ? "test-token-pepper!" : undefined),
  RECOVERY_PEPPER: process.env.RECOVERY_PEPPER ?? (process.env.NODE_ENV === "test" ? "test-recovery-pepper!" : undefined),
  INVITATION_TOKEN_PEPPER:
    process.env.INVITATION_TOKEN_PEPPER ??
    (process.env.NODE_ENV === "test" ? "test-invitation-pepper!" : process.env.TOKEN_PEPPER),
  STAFF_AUTH_TEST_BYPASS: process.env.STAFF_AUTH_TEST_BYPASS ?? (process.env.NODE_ENV === "test" ? "true" : "false"),
  SAATHI_LLM_PROVIDER: process.env.SAATHI_LLM_PROVIDER ?? (process.env.NODE_ENV === "test" ? "stub" : undefined),
  OBJECT_STORAGE_DRIVER:
    process.env.OBJECT_STORAGE_DRIVER ??
    (process.env.NODE_ENV === "production" ? "none" : "local"),
});

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.format());
  throw new Error("Invalid environment variables");
}

const data = parsed.data;

if (data.NODE_ENV !== "test" && data.DATABASE_URL.length === 0) {
  throw new Error("DATABASE_URL is required");
}

if (!data.INVITATION_TOKEN_PEPPER || data.INVITATION_TOKEN_PEPPER.length < 16) {
  throw new Error("INVITATION_TOKEN_PEPPER (or TOKEN_PEPPER) must be at least 16 characters");
}

export const env = {
  ...data,
  INVITATION_TOKEN_PEPPER: data.INVITATION_TOKEN_PEPPER as string,
};
