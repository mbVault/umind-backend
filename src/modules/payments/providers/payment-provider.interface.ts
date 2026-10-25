import { PaymentProvider } from "@prisma/client";

export type ProviderCheckoutSession = {
  provider: PaymentProvider;
  /** Razorpay order id or Stripe PaymentIntent id */
  providerReferenceId: string;
  /** Safe fields for client checkout SDK */
  client: Record<string, unknown>;
};

export type CreateProviderCheckoutInput = {
  amountMinorUnits: number;
  currency: string;
  receiptReference: string;
  metadata: Record<string, string>;
};

export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider;
  createCheckoutSession(input: CreateProviderCheckoutInput): Promise<ProviderCheckoutSession>;
}
