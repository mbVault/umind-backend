import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../modules/auth/tokens";
import { assertValidAccessToken, getSessionForAccessToken } from "../modules/auth/sessionService";
import { fail } from "../lib/errors";
import { User } from "@prisma/client";

export interface AuthenticatedRequest extends Request {
  auth: {
    userId: string;
    sessionId: string;
    user: User;
  };
}

export const authenticate = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    fail(401, "Missing or invalid Authorization header");
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    fail(401, "Missing access token");
  }

  try {
    const payload = verifyAccessToken(token);
    const session = await getSessionForAccessToken(payload.sub, payload.sid);
    (req as AuthenticatedRequest).auth = {
      userId: session.user.id,
      sessionId: session.sessionId,
      user: session.user,
    };
    next();
  } catch (err) {
    assertValidAccessToken(err);
  }
};
