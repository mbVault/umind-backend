import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { sendSuccess } from "../lib/apiResponse";
import { fail } from "../lib/errors";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { validateBody } from "../middleware/validate";
import { getSubscriptionMeForUser } from "../modules/subscriptions/entitlementService";
import { startFreeTrialForUser } from "../modules/subscriptions/startFreeTrialService";
import { startSubscriptionCheckout } from "../modules/subscriptions/subscriptionCheckoutService";
import {
  startFreeTrialBodySchema,
  subscriptionCheckoutBodySchema,
} from "../validators/subscriptions";

export const subscriptionsRouter = Router();

subscriptionsRouter.use(authenticate);

subscriptionsRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const data = await getSubscriptionMeForUser(userId);
    sendSuccess(res, 200, data);
  }),
);

/** Start / resume a 7-day free trial (also runs automatically on register when plan is sent). */
subscriptionsRouter.post(
  "/start-trial",
  validateBody(startFreeTrialBodySchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const { planCode } = startFreeTrialBodySchema.parse(req.body);
    const trial = await startFreeTrialForUser(userId, planCode);
    const me = await getSubscriptionMeForUser(userId);
    sendSuccess(res, 201, { trial, entitlements: me.entitlements, subscription: me.subscription });
  }),
);

subscriptionsRouter.post(
  "/checkout",
  validateBody(subscriptionCheckoutBodySchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const { planId } = subscriptionCheckoutBodySchema.parse(req.body);
    const idempotencyKey = req.header("idempotency-key")?.trim() || undefined;
    if (idempotencyKey && idempotencyKey.length > 64) {
      fail(400, "Idempotency-Key must be at most 64 characters");
    }

    const data = await startSubscriptionCheckout({ userId, planId, idempotencyKey });
    sendSuccess(res, 201, data);
  }),
);

subscriptionsRouter.post(
  "/cancel",
  asyncHandler(async () => {
    fail(
      501,
      "Subscription cancellation is not available yet; product has not defined immediate vs end-of-period cancellation",
    );
  }),
);
