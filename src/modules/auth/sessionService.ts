import { User, UserStatus } from "@prisma/client";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { env } from "../../config/env";
import {
  formatRefreshToken,
  formatRefreshTokenHashField,
  generateRefreshSecret,
  hashRefreshSecret,
  parseRefreshToken,
  parseRefreshTokenHashField,
  signAccessToken,
} from "./tokens";
import { timingSafeEqual } from "node:crypto";

const assertActiveUser = (user: User): void => {
  if (user.status === UserStatus.DELETED || user.status === UserStatus.DISABLED) {
    fail(403, "Account is not available");
  }
};

export interface AuthTokenBundle {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  sessionId: string;
  userDeviceId: string | null;
}

export const createAuthSession = async (
  userId: string,
  userDeviceId: string | null
): Promise<AuthTokenBundle> => {
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SEC * 1000);
  const secret = generateRefreshSecret();
  const version = 0;

  const session = await prisma.authSession.create({
    data: {
      userId,
      userDeviceId,
      refreshTokenHash: formatRefreshTokenHashField(version, secret),
      expiresAt,
    },
  });

  const { token: accessToken, expiresIn: accessTokenExpiresIn } = signAccessToken(userId, session.id);

  return {
    accessToken,
    accessTokenExpiresIn,
    refreshToken: formatRefreshToken(session.id, version, secret),
    refreshTokenExpiresAt: expiresAt,
    sessionId: session.id,
    userDeviceId,
  };
};

export const refreshAuthSession = async (refreshToken: string): Promise<AuthTokenBundle> => {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) {
    fail(401, "Invalid refresh token");
  }

  const session = await prisma.authSession.findUnique({
    where: { id: parsed.sessionId },
    include: { user: true },
  });

  if (!session) {
    fail(401, "Invalid refresh token");
  }

  if (session.revokedAt) {
    fail(401, "Session has been revoked");
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    fail(401, "Session has expired");
  }

  assertActiveUser(session.user);

  const stored = parseRefreshTokenHashField(session.refreshTokenHash);
  if (!stored) {
    fail(401, "Invalid refresh token");
  }

  const presentedHash = hashRefreshSecret(parsed.secret);

  if (parsed.version < stored.version) {
    await prisma.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    fail(401, "Refresh token has already been rotated");
  }

  if (parsed.version > stored.version) {
    fail(401, "Invalid refresh token");
  }

  const hashMatch = timingSafeEqual(Buffer.from(presentedHash, "hex"), Buffer.from(stored.hash, "hex"));

  if (!hashMatch) {
    fail(401, "Invalid refresh token");
  }

  const newSecret = generateRefreshSecret();
  const newVersion = stored.version + 1;
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SEC * 1000);

  await prisma.authSession.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: formatRefreshTokenHashField(newVersion, newSecret),
      expiresAt,
      lastUsedAt: new Date(),
    },
  });

  const { token: accessToken, expiresIn: accessTokenExpiresIn } = signAccessToken(
    session.userId,
    session.id
  );

  return {
    accessToken,
    accessTokenExpiresIn,
    refreshToken: formatRefreshToken(session.id, newVersion, newSecret),
    refreshTokenExpiresAt: expiresAt,
    sessionId: session.id,
    userDeviceId: session.userDeviceId,
  };
};

export const logoutSession = async (refreshToken: string): Promise<void> => {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) {
    fail(401, "Invalid refresh token");
  }

  const session = await prisma.authSession.findUnique({ where: { id: parsed.sessionId } });
  if (!session) {
    fail(401, "Invalid refresh token");
  }

  if (session.revokedAt) {
    return;
  }

  const stored = parseRefreshTokenHashField(session.refreshTokenHash);
  if (!stored || parsed.version !== stored.version) {
    fail(401, "Invalid refresh token");
  }

  const presentedHash = hashRefreshSecret(parsed.secret);
  const hashMatch = timingSafeEqual(Buffer.from(presentedHash, "hex"), Buffer.from(stored.hash, "hex"));
  if (!hashMatch) {
    fail(401, "Invalid refresh token");
  }

  await prisma.authSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });
};

export const getSessionForAccessToken = async (
  userId: string,
  sessionId: string
): Promise<{ sessionId: string; expiresAt: Date; userDeviceId: string | null; user: User }> => {
  const session = await prisma.authSession.findFirst({
    where: { id: sessionId, userId },
    include: { user: true },
  });

  if (!session || session.revokedAt) {
    fail(401, "Invalid or expired session");
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    fail(401, "Session has expired");
  }

  assertActiveUser(session.user);

  return {
    sessionId: session.id,
    expiresAt: session.expiresAt,
    userDeviceId: session.userDeviceId,
    user: session.user,
  };
};

export const toMinimalUser = (user: User) => ({
  userId: user.id,
  alias: user.alias,
  avatarId: user.avatarId,
  status: user.status,
});

export const assertValidAccessToken = (err: unknown): never => {
  if (err instanceof jwt.JsonWebTokenError) {
    fail(401, "Invalid access token");
  }
  throw err;
};
