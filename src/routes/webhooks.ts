import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { processRazorpayWebhook, processStripeWebhook } from "../modules/payments/webhookProcessor";

export const webhooksRouter = Router();

webhooksRouter.post(
  "/stripe",
  asyncHandler(async (req, res) => {
    const rawBody = req.body as Buffer;
    await processStripeWebhook(rawBody, req.header("stripe-signature"));
    res.status(200).json({ received: true });
  }),
);

webhooksRouter.post(
  "/razorpay",
  asyncHandler(async (req, res) => {
    const rawBody = req.body as Buffer;
    await processRazorpayWebhook(rawBody, req.header("x-razorpay-signature"));
    res.status(200).json({ received: true });
  }),
);
