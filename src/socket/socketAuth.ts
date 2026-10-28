import { StaffRole } from "@prisma/client";
import type { Socket } from "socket.io";
import Session from "supertokens-node/recipe/session";
import { env } from "../config/env";
import { isSuperTokensConfigured } from "../config/supertokens";
import { HttpError, fail } from "../lib/errors";
import { getSessionForAccessToken } from "../modules/auth/sessionService";
import { verifyAccessToken } from "../modules/auth/tokens";
import {
  accountHasRole,
  loadStaffAccountBySuperTokensUserId,
} from "../modules/staff/accountLoader";
import { getOrCreatePsychologistProfile } from "../modules/staff/psychologistService";
import type { ChatParticipant } from "../modules/sessions/chatService";
import { ParticipantRole } from "@prisma/client";

export type SocketPrincipal = ChatParticipant;

type HandshakeAuth = {
  type?: string;
  accessToken?: string;
  token?: string;
  testSuperTokensUserId?: string;
};

const readBearerFromHeaders = (socket: Socket): string | null => {
  const header = socket.handshake.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim() || null;
  }
  return null;
};

const readAuth = (socket: Socket): HandshakeAuth => {
  const raw = (socket.handshake.auth ?? {}) as HandshakeAuth;
  return raw && typeof raw === "object" ? raw : {};
};

const resolveCustomer = async (accessToken: string): Promise<SocketPrincipal> => {
  const payload = verifyAccessToken(accessToken);
  const session = await getSessionForAccessToken(payload.sub, payload.sid);
  return { role: ParticipantRole.CUSTOMER, userId: session.user.id };
};

const resolveStaff = async (superTokensUserId: string): Promise<SocketPrincipal> => {
  const account = await loadStaffAccountBySuperTokensUserId(superTokensUserId);
  if (!accountHasRole(account, StaffRole.PSYCHOLOGIST)) {
    fail(403, "PSYCHOLOGIST role required");
  }
  const profile = await getOrCreatePsychologistProfile(account.id);
  return {
    role: ParticipantRole.PSYCHOLOGIST,
    accountId: account.id,
    psychologistProfileId: profile.id,
  };
};

/**
 * Authenticate a Socket.IO connection using existing customer JWT or staff SuperTokens identity.
 *
 * Handshake `auth`:
 * - Customer: `{ type: "customer", accessToken: "<jwt>" }` (or Bearer Authorization header)
 * - Staff (test bypass): `{ type: "staff", testSuperTokensUserId: "<st-user-id>" }`
 * - Staff (live ST): `{ type: "staff", accessToken: "<st-access-token>" }`
 */
export const authenticateSocket = async (socket: Socket): Promise<SocketPrincipal> => {
  const auth = readAuth(socket);
  const type = (auth.type ?? "").toLowerCase();
  const accessToken = auth.accessToken ?? auth.token ?? readBearerFromHeaders(socket) ?? null;

  if (type === "staff" || type === "psychologist") {
    if (env.NODE_ENV === "test" && env.STAFF_AUTH_TEST_BYPASS && auth.testSuperTokensUserId) {
      return resolveStaff(auth.testSuperTokensUserId.trim());
    }

    const testHeader = socket.handshake.headers["x-test-supertokens-user-id"];
    if (
      env.NODE_ENV === "test" &&
      env.STAFF_AUTH_TEST_BYPASS &&
      typeof testHeader === "string" &&
      testHeader.trim()
    ) {
      return resolveStaff(testHeader.trim());
    }

    if (!accessToken) {
      fail(401, "Missing staff access token");
    }
    if (!isSuperTokensConfigured()) {
      fail(503, "Staff authentication is not configured");
    }

    const stSession = await Session.getSessionWithoutRequestResponse(accessToken, undefined, {
      sessionRequired: true,
    });
    return resolveStaff(stSession.getUserId());
  }

  // Default / explicit customer
  if (!accessToken) {
    fail(401, "Missing or invalid access token");
  }
  try {
    return await resolveCustomer(accessToken);
  } catch (err) {
    if (err instanceof HttpError) {
      throw err;
    }
    fail(401, "Invalid access token");
  }
};
