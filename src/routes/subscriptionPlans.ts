import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { sendSuccess } from "../lib/apiResponse";
import { listActiveSubscriptionPlans } from "../modules/subscriptions/planService";

export const subscriptionPlansRouter = Router();

subscriptionPlansRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const plans = await listActiveSubscriptionPlans();
    sendSuccess(res, 200, { items: plans });
  })
);
