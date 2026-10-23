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

  /** Set true only when a real object-storage provider is wired. */
  OBJECT_STORAGE_CONFIGURED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1")
    .default("false"),

  INVITATION_TOKEN_TTL_HOURS: z.coerce.number().default(72),
  INVITATION_TOKEN_PEPPER: z.string().min(16).optional(),
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
