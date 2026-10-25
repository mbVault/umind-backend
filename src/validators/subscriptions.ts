import { z } from "zod";

export const subscriptionCheckoutBodySchema = z
  .object({
    planId: z.string().uuid(),
  })
  .strict();
