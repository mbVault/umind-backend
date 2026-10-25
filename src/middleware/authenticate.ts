import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../modules/auth/tokens";
import { assertValidAccessToken, getSessionForAccessToken } from "../modules/auth/sessionService";
import jwt from "jsonwebtoken";
import { HttpError } from "../lib/errors";
import { User } from "@prisma/client";

export interface AuthenticatedRequest extends Request {
  auth: {
    userId: string;
    sessionId: string;
    user: User;
  };
}

export const authenticate = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new HttpError(401, "Missing or invalid Authorization header");
    }

    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      throw new HttpError(401, "Missing access token");
    }

    const payload = verifyAccessToken(token);
    const session = await getSessionForAccessToken(payload.sub, payload.sid);
    (req as AuthenticatedRequest).auth = {
      userId: session.user.id,
      sessionId: session.sessionId,
      user: session.user,
    };
    next();
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      next(new HttpError(401, "Invalid access token"));
      return;
    }
    if (err instanceof HttpError) {
      next(err);
      return;
    }
    assertValidAccessToken(err);
  }
};
