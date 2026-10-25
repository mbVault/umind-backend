import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { sendSuccess } from "../lib/apiResponse";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { validateParams } from "../middleware/validate";
import { getOrderForUser } from "../modules/payments/paymentService";
import { z } from "zod";

const orderIdParamSchema = z.object({
  orderId: z.string().uuid(),
});

export const ordersRouter = Router();

ordersRouter.use(authenticate);

ordersRouter.get(
  "/:orderId",
  validateParams(orderIdParamSchema),
  asyncHandler(async (req, res) => {
    const { orderId } = orderIdParamSchema.parse(req.params);
    const { userId } = (req as AuthenticatedRequest).auth;
    const order = await getOrderForUser(userId, orderId);
    sendSuccess(res, 200, order);
  }),
);
