import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { sendSuccess } from "../lib/apiResponse";
import { prisma } from "../lib/prisma";
import { isOnboardingComplete } from "../lib/onboarding";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { validateBody } from "../middleware/validate";
import { toProfileResponse } from "../modules/profile/profileMapper";
import {
  patchProfileSchema,
  patchPreferencesSchema,
  patchPersonalizationSchema,
  putOnboardingSchema,
} from "../validators/profile";

export const profileRouter = Router();

profileRouter.use(authenticate);

profileRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { user } = (req as AuthenticatedRequest).auth;
    sendSuccess(res, 200, toProfileResponse(user));
  })
);

profileRouter.patch(
  "/",
  validateBody(patchProfileSchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const body = req.body as { alias?: string; avatarId?: string };

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(body.alias !== undefined ? { alias: body.alias } : {}),
        ...(body.avatarId !== undefined ? { avatarId: body.avatarId } : {}),
      },
    });

    sendSuccess(res, 200, toProfileResponse(updated));
  })
);

profileRouter.patch(
  "/preferences",
  validateBody(patchPreferencesSchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const body = req.body as { lifeStage?: string; gender?: string };

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(body.lifeStage !== undefined ? { lifeStage: body.lifeStage as never } : {}),
        ...(body.gender !== undefined ? { gender: body.gender as never } : {}),
      },
    });

    sendSuccess(res, 200, toProfileResponse(updated));
  })
);

profileRouter.patch(
  "/personalization",
  validateBody(patchPersonalizationSchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const body = req.body as { appTheme?: string; city?: string };

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(body.appTheme !== undefined ? { appTheme: body.appTheme as never } : {}),
        ...(body.city !== undefined ? { city: body.city } : {}),
      },
    });

    sendSuccess(res, 200, toProfileResponse(updated));
  })
);

profileRouter.put(
  "/onboarding",
  validateBody(putOnboardingSchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const body = req.body as { startingFeelings: string[] };

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { startingFeelings: body.startingFeelings as never },
    });

    sendSuccess(res, 200, {
      startingFeelings: updated.startingFeelings,
      onboardingComplete: isOnboardingComplete(updated),
    });
  })
);
