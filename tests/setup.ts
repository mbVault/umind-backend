import dotenv from "dotenv";

dotenv.config();

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-min-32-chars-long!!";
process.env.TOKEN_PEPPER = process.env.TOKEN_PEPPER ?? "test-token-pepper!";
process.env.RECOVERY_PEPPER = process.env.RECOVERY_PEPPER ?? "test-recovery-pepper!";
process.env.INVITATION_TOKEN_PEPPER = process.env.INVITATION_TOKEN_PEPPER ?? "test-invitation-pepper!";
process.env.STAFF_AUTH_TEST_BYPASS = "true";
/** Local filesystem driver for Phase 2 audio + psych docs in tests (R2 later). */
process.env.OBJECT_STORAGE_DRIVER = process.env.OBJECT_STORAGE_DRIVER ?? "local";
process.env.OBJECT_STORAGE_CONFIGURED = "true";
process.env.LOCAL_STORAGE_ROOT = process.env.LOCAL_STORAGE_ROOT ?? "./.local-storage-test";
process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? "http://localhost:4000";
/** Never hit a live Core from unit/integration tests — use STAFF_AUTH_TEST_BYPASS. */
process.env.SUPERTOKENS_CONNECTION_URI = "";

/** Keep vitest deterministic — local .env must not enable live payment providers in tests. */
process.env.RAZORPAY_KEY_ID = "";
process.env.RAZORPAY_KEY_SECRET = "";
process.env.RAZORPAY_WEBHOOK_SECRET = "";
process.env.STRIPE_SECRET_KEY = "";
process.env.STRIPE_PUBLISHABLE_KEY = "";
process.env.STRIPE_WEBHOOK_SECRET = "";
