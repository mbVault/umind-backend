import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";

export interface AccessTokenPayload {
  sub: string;
  sid: string;
}

export const signAccessToken = (userId: string, sessionId: string): { token: string; expiresIn: number } => {
  const expiresIn = env.ACCESS_TOKEN_TTL_SEC;
  const token = jwt.sign({ sub: userId, sid: sessionId } satisfies AccessTokenPayload, env.JWT_SECRET, {
    expiresIn,
  });
  return { token, expiresIn };
};

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const payload = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
  if (!payload.sub || !payload.sid) {
    throw new Error("Invalid access token payload");
  }
  return payload;
};

export const hashRefreshSecret = (secret: string): string => {
  return createHash("sha256").update(`${env.TOKEN_PEPPER}:${secret}`).digest("hex");
};

export const generateRefreshSecret = (): string => {
  return randomBytes(32).toString("base64url");
};

/** Composite refresh token: sessionId.version.secret */
export const formatRefreshToken = (sessionId: string, version: number, secret: string): string => {
  return `${sessionId}.${version}.${secret}`;
};

export const parseRefreshToken = (
  refreshToken: string
): { sessionId: string; version: number; secret: string } | null => {
  const parts = refreshToken.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [sessionId, versionStr, secret] = parts;
  const version = Number.parseInt(versionStr, 10);
  if (!sessionId || !secret || Number.isNaN(version)) {
    return null;
  }
  return { sessionId, version, secret };
};

export const parseRefreshTokenHashField = (
  stored: string
): { version: number; hash: string } | null => {
  const idx = stored.indexOf(":");
  if (idx === -1) {
    return null;
  }
  const version = Number.parseInt(stored.slice(0, idx), 10);
  const hash = stored.slice(idx + 1);
  if (Number.isNaN(version) || !hash) {
    return null;
  }
  return { version, hash };
};

export const formatRefreshTokenHashField = (version: number, secret: string): string => {
  return `${version}:${hashRefreshSecret(secret)}`;
};
