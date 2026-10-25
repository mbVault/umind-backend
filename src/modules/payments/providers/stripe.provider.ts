import Stripe from "stripe";
import { PaymentProvider } from "@prisma/client";
import { fail } from "../../../lib/errors";
import { isStripeConfigured, readPaymentEnv } from "../paymentConfig";
import {
  CreateProviderCheckoutInput,
  PaymentProviderAdapter,
  ProviderCheckoutSession,
} from "./payment-provider.interface";

let client: Stripe | null = null;

const getClient = (): Stripe => {
  if (!isStripeConfigured()) {
    fail(503, "Stripe is not configured on the server");
  }
  if (!client) {
    client = new Stripe(readPaymentEnv("STRIPE_SECRET_KEY"));
  }
  return client;
};

export const stripeAdapter: PaymentProviderAdapter = {
  provider: PaymentProvider.STRIPE,

  async createCheckoutSession(input: CreateProviderCheckoutInput): Promise<ProviderCheckoutSession> {
    const currency = input.currency.toLowerCase();
    const intent = await getClient().paymentIntents.create({
      amount: input.amountMinorUnits,
      currency,
      metadata: input.metadata,
      automatic_payment_methods: { enabled: true },
    });

    return {
      provider: PaymentProvider.STRIPE,
      providerReferenceId: intent.id,
      client: {
        publishableKey: readPaymentEnv("STRIPE_PUBLISHABLE_KEY") || undefined,
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret,
      },
    };
  },
};
