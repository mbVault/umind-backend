import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { v5 as uuidv5 } from "uuid";
import { env } from "../../config/env";

/** Namespace UUID for deriving stable anonymous user IDs from recovery phrases. */
export const RECOVERY_USER_NAMESPACE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const VERIFIER_PREFIX = "v1";

export const normalizeRecoveryKey = (input: string | string[]): string => {
  const raw = Array.isArray(input) ? input.join(" ") : input;
  const normalized = raw.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  const words = normalized.split(" ").filter(Boolean);
  if (words.length !== 12) {
    return "";
  }
  return words.join(" ");
};

export const userIdFromRecoveryKey = (normalizedPhrase: string): string => {
  return uuidv5(normalizedPhrase, RECOVERY_USER_NAMESPACE);
};

export const createRecoveryKeyVerifier = (normalizedPhrase: string): string => {
  const salt = randomBytes(16);
  const hash = scryptSync(normalizedPhrase, `${env.RECOVERY_PEPPER}:${salt.toString("hex")}`, 64);
  return `${VERIFIER_PREFIX}:${salt.toString("hex")}:${hash.toString("hex")}`;
};

export const verifyRecoveryKey = (normalizedPhrase: string, storedVerifier: string): boolean => {
  const parts = storedVerifier.split(":");
  if (parts.length !== 3 || parts[0] !== VERIFIER_PREFIX) {
    return false;
  }
  const salt = parts[1];
  const expectedHex = parts[2];
  const hash = scryptSync(normalizedPhrase, `${env.RECOVERY_PEPPER}:${salt}`, 64);
  const expected = Buffer.from(expectedHex, "hex");
  if (expected.length !== hash.length) {
    return false;
  }
  return timingSafeEqual(expected, hash);
};
