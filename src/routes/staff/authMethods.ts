import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { sendSuccess } from "../../lib/apiResponse";
import { getStaffAuthMethods, isSuperTokensConfigured } from "../../config/supertokens";

export const staffAuthMethodsRouter = Router();

/** Public — used by psychologist/admin login UI to show available methods. */
staffAuthMethodsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    sendSuccess(res, 200, {
      configured: isSuperTokensConfigured(),
      methods: getStaffAuthMethods(),
    });
  })
);
