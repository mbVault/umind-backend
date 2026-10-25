import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { sendSuccess } from "../lib/apiResponse";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { validateBody } from "../middleware/validate";
import { getPrivacyConsent, putPrivacyConsent } from "../modules/privacy/consentService";
import { privacyConsentPutSchema } from "../validators/diary";

export const privacyRouter = Router();

privacyRouter.use(authenticate);

privacyRouter.get(
  "/consent",
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    sendSuccess(res, 200, await getPrivacyConsent(userId));
  }),
);

privacyRouter.put(
  "/consent",
  validateBody(privacyConsentPutSchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const body = privacyConsentPutSchema.parse(req.body);
    sendSuccess(res, 200, await putPrivacyConsent(userId, body));
  }),
);
