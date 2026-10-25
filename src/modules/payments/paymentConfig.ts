import { PaymentProvider } from "@prisma/client";
import { env } from "../../config/env";
import { fail } from "../../lib/errors";

type PaymentEnvKey =
  | "RAZORPAY_KEY_ID"
  | "RAZORPAY_KEY_SECRET"
  | "RAZORPAY_WEBHOOK_SECRET"
  | "STRIPE_SECRET_KEY"
  | "STRIPE_PUBLISHABLE_KEY"
  | "STRIPE_WEBHOOK_SECRET";

/** Vitest may set process.env after module load; payment keys are read live. */
export const readPaymentEnv = (key: PaymentEnvKey): string => (process.env[key] ?? env[key] ?? "").trim();

export const isRazorpayConfigured = (): boolean =>
  Boolean(readPaymentEnv("RAZORPAY_KEY_ID") && readPaymentEnv("RAZORPAY_KEY_SECRET"));

export const isStripeConfigured = (): boolean => Boolean(readPaymentEnv("STRIPE_SECRET_KEY"));

export const isRazorpayWebhookConfigured = (): boolean => Boolean(readPaymentEnv("RAZORPAY_WEBHOOK_SECRET"));

export const isStripeWebhookConfigured = (): boolean => Boolean(readPaymentEnv("STRIPE_WEBHOOK_SECRET"));

export const assertProviderConfigured = (provider: PaymentProvider): void => {
  if (provider === PaymentProvider.RAZORPAY && !isRazorpayConfigured()) {
    fail(503, "Razorpay is not configured on the server");
  }
  if (provider === PaymentProvider.STRIPE && !isStripeConfigured()) {
    fail(503, "Stripe is not configured on the server");
  }
};

export type PaymentProviderStatus = {
  razorpay: { configured: boolean; webhookConfigured: boolean };
  stripe: { configured: boolean; webhookConfigured: boolean; publishableKeyConfigured: boolean };
};

export const getPaymentProviderStatus = (): PaymentProviderStatus => ({
  razorpay: {
    configured: isRazorpayConfigured(),
    webhookConfigured: isRazorpayWebhookConfigured(),
  },
  stripe: {
    configured: isStripeConfigured(),
    webhookConfigured: isStripeWebhookConfigured(),
    publishableKeyConfigured: Boolean(readPaymentEnv("STRIPE_PUBLISHABLE_KEY")),
  },
});
