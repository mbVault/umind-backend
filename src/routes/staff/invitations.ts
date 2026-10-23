import { Router } from "express";
import Session from "supertokens-node/recipe/session";
import { Request, Response, NextFunction } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { sendSuccess } from "../../lib/apiResponse";
import { fail } from "../../lib/errors";
import { env } from "../../config/env";
import { isSuperTokensConfigured } from "../../config/supertokens";
import { invitationRateLimiter } from "../../middleware/rateLimit";
import { validateBody } from "../../middleware/validate";
import { acceptAdminInvitation } from "../../modules/staff/invitationService";
import { acceptInvitationBodySchema } from "../../validators/staff";

export const invitationsRouter = Router();

/**
 * Resolves SuperTokens user id without requiring a provisioned Account.
 * Used only for invitation acceptance.
 */
const requireSuperTokensIdentity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (env.NODE_ENV === "test" && env.STAFF_AUTH_TEST_BYPASS) {
      const testId = req.header("x-test-supertokens-user-id");
      if (!testId) fail(401, "Missing test SuperTokens user id");
      (req as Request & { superTokensUserId: string }).superTokensUserId = testId.trim();
      next();
      return;
    }
    if (!isSuperTokensConfigured()) {
      fail(503, "Staff authentication is not configured");
    }
    const session = await Session.getSession(req, res, { sessionRequired: true });
    (req as Request & { superTokensUserId: string }).superTokensUserId = session.getUserId();
    next();
  } catch (err) {
    next(err);
  }
};

invitationsRouter.post(
  "/accept",
  invitationRateLimiter,
  requireSuperTokensIdentity,
  validateBody(acceptInvitationBodySchema),
  asyncHandler(async (req, res) => {
    const superTokensUserId = (req as Request & { superTokensUserId: string }).superTokensUserId;
    const body = req.body as { token: string };
    const result = await acceptAdminInvitation({
      rawToken: body.token,
      acceptorSuperTokensUserId: superTokensUserId,
    });
    sendSuccess(res, 200, result);
  })
);
