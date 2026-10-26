import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { sendSuccess } from "../../lib/apiResponse";
import { invitationRateLimiter } from "../../middleware/rateLimit";
import {
  requireSuperTokensIdentity,
  SuperTokensIdentityRequest,
} from "../../middleware/staffAuth";
import { validateBody } from "../../middleware/validate";
import { acceptAdminInvitation } from "../../modules/staff/invitationService";
import { acceptInvitationBodySchema } from "../../validators/staff";

export const invitationsRouter = Router();

invitationsRouter.post(
  "/accept",
  invitationRateLimiter,
  requireSuperTokensIdentity,
  validateBody(acceptInvitationBodySchema),
  asyncHandler(async (req, res) => {
    const superTokensUserId = (req as SuperTokensIdentityRequest).superTokensUserId;
    const body = req.body as { token: string };
    const result = await acceptAdminInvitation({
      rawToken: body.token,
      acceptorSuperTokensUserId: superTokensUserId,
    });
    sendSuccess(res, 200, result);
  })
);
