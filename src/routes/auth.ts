import { Router } from "express";
import { UserStatus } from "@prisma/client";
import { asyncHandler } from "../lib/asyncHandler";
import { sendSuccess } from "../lib/apiResponse";
import { fail } from "../lib/errors";
import { isOnboardingComplete } from "../lib/onboarding";
import { prisma } from "../lib/prisma";
import { validateBody } from "../middleware/validate";
import {
  createRecoveryKeyVerifier,
  normalizeRecoveryKey,
  userIdFromRecoveryKey,
  verifyRecoveryKey,
} from "../modules/auth/recoveryKey";
import { upsertDeviceRegistration } from "../modules/auth/deviceService";
import {
  createAuthSession,
  logoutSession,
  refreshAuthSession,
  getSessionForAccessToken,
  toMinimalUser,
} from "../modules/auth/sessionService";
import { verifyAccessToken } from "../modules/auth/tokens";
import { assertValidAccessToken } from "../modules/auth/sessionService";
import { startFreeTrialForUser } from "../modules/subscriptions/startFreeTrialService";
import {
  registerBodySchema,
  recoverBodySchema,
  refreshBodySchema,
  logoutBodySchema,
} from "../validators/auth";
import { isMobileClient } from "../validators/common";

export const authRouter = Router();

const resolveUserDeviceId = async (
  userId: string,
  deviceId: string | undefined,
  platformHeader: string | undefined
): Promise<string | null> => {
  const mobile = isMobileClient(platformHeader);
  if (mobile && !deviceId) {
    fail(400, "Validation failed", { deviceId: ["deviceId is required for mobile clients"] });
  }
  if (!deviceId) {
    return null;
  }
  return upsertDeviceRegistration(userId, deviceId);
};

authRouter.post(
  "/register",
  validateBody(registerBodySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as typeof registerBodySchema._type;
    const normalized = normalizeRecoveryKey(body.recoveryKey);
    if (!normalized) {
      fail(400, "Validation failed", {
        recoveryKey: ["recoveryKey must be exactly 12 words after normalisation"],
      });
    }

    const userId = userIdFromRecoveryKey(normalized);
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (existing) {
      fail(409, "An account already exists for this recovery key");
    }

    const user = await prisma.user.create({
      data: {
        id: userId,
        alias: body.alias,
        avatarId: body.avatarId,
        lifeStage: body.lifeStage,
        gender: body.gender,
        startingFeelings: body.startingFeelings,
        appTheme: body.appTheme,
        city: body.city,
        saathiCheckIn: body.saathiCheckIn,
        saathiLanguage: body.saathiLanguage,
        unwindHabits: body.unwindHabits,
        recoveryKeyVerifier: createRecoveryKeyVerifier(normalized),
        status: UserStatus.ACTIVE,
      },
    });

    const userDeviceId = await resolveUserDeviceId(user.id, body.deviceId, req.header("x-client-platform"));
    const tokens = await createAuthSession(user.id, userDeviceId);

    const trial = body.subscriptionPlanCode
      ? await startFreeTrialForUser(user.id, body.subscriptionPlanCode)
      : null;

    sendSuccess(res, 201, {
      user: {
        id: user.id,
        alias: user.alias,
        avatarId: user.avatarId,
        status: user.status,
      },
      session: {
        sessionId: tokens.sessionId,
        expiresAt: tokens.refreshTokenExpiresAt.toISOString(),
        userDeviceId: tokens.userDeviceId,
      },
      tokens: {
        accessToken: tokens.accessToken,
        accessTokenExpiresIn: tokens.accessTokenExpiresIn,
        refreshToken: tokens.refreshToken,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
      },
      onboardingComplete: isOnboardingComplete(user),
      trial,
    });
  })
);

authRouter.post(
  "/recover",
  validateBody(recoverBodySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as typeof recoverBodySchema._type;
    const normalized = normalizeRecoveryKey(body.recoveryKey);
    if (!normalized) {
      fail(400, "Validation failed", {
        recoveryKey: ["recoveryKey must be exactly 12 words after normalisation"],
      });
    }

    const userId = userIdFromRecoveryKey(normalized);
    const found = await prisma.user.findUnique({ where: { id: userId } });
    if (!found || !verifyRecoveryKey(normalized, found.recoveryKeyVerifier)) {
      fail(401, "Invalid recovery key");
    }
    const user = found;

    if (user.status === UserStatus.DELETED || user.status === UserStatus.DISABLED) {
      fail(403, "Account is not available");
    }

    const userDeviceId = await resolveUserDeviceId(user.id, body.deviceId, req.header("x-client-platform"));
    const tokens = await createAuthSession(user.id, userDeviceId);

    sendSuccess(res, 200, {
      user: {
        id: user.id,
        alias: user.alias,
        avatarId: user.avatarId,
        status: user.status,
      },
      session: {
        sessionId: tokens.sessionId,
        expiresAt: tokens.refreshTokenExpiresAt.toISOString(),
        userDeviceId: tokens.userDeviceId,
      },
      tokens: {
        accessToken: tokens.accessToken,
        accessTokenExpiresIn: tokens.accessTokenExpiresIn,
        refreshToken: tokens.refreshToken,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
      },
      onboardingComplete: isOnboardingComplete(user),
    });
  })
);

authRouter.post(
  "/refresh",
  validateBody(refreshBodySchema),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as typeof refreshBodySchema._type;
    const tokens = await refreshAuthSession(refreshToken);

    sendSuccess(res, 200, {
      session: {
        sessionId: tokens.sessionId,
        expiresAt: tokens.refreshTokenExpiresAt.toISOString(),
      },
      tokens: {
        accessToken: tokens.accessToken,
        accessTokenExpiresIn: tokens.accessTokenExpiresIn,
        refreshToken: tokens.refreshToken,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
      },
    });
  })
);

authRouter.post(
  "/logout",
  validateBody(logoutBodySchema),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as typeof logoutBodySchema._type;
    await logoutSession(refreshToken);
    sendSuccess(res, 200, { revoked: true });
  })
);

authRouter.get(
  "/session",
  asyncHandler(async (req, res) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      fail(401, "Missing or invalid Authorization header");
    }

    try {
      const payload = verifyAccessToken(header.slice("Bearer ".length).trim());
      const session = await getSessionForAccessToken(payload.sub, payload.sid);

      sendSuccess(res, 200, {
        session: {
          sessionId: session.sessionId,
          expiresAt: session.expiresAt.toISOString(),
          userDeviceId: session.userDeviceId,
        },
        user: toMinimalUser(session.user),
      });
    } catch (err) {
      assertValidAccessToken(err);
    }
  })
);
