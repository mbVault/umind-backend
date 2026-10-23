import dotenv from "dotenv";

dotenv.config();

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-min-32-chars-long!!";
process.env.TOKEN_PEPPER = process.env.TOKEN_PEPPER ?? "test-token-pepper!";
process.env.RECOVERY_PEPPER = process.env.RECOVERY_PEPPER ?? "test-recovery-pepper!";
process.env.INVITATION_TOKEN_PEPPER = process.env.INVITATION_TOKEN_PEPPER ?? "test-invitation-pepper!";
process.env.STAFF_AUTH_TEST_BYPASS = "true";
process.env.OBJECT_STORAGE_CONFIGURED = "false";
process.env.SUPERTOKENS_CONNECTION_URI = process.env.SUPERTOKENS_CONNECTION_URI ?? "";
