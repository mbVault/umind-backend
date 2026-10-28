import { z } from "zod";
import { subscriptionPlanCodeSchema } from "./auth";

export const subscriptionCheckoutBodySchema = z
  .object({
    planId: z.string().uuid(),
  })
  .strict();

export const startFreeTrialBodySchema = z
  .object({
    planCode: subscriptionPlanCodeSchema.default("YEARLY"),
  })
  .strict();
