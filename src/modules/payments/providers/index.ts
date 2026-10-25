import { PaymentProvider } from "@prisma/client";
import { fail } from "../../../lib/errors";
import { PaymentProviderAdapter } from "./payment-provider.interface";
import { razorpayAdapter } from "./razorpay.provider";
import { stripeAdapter } from "./stripe.provider";

const testAdapterOverrides = new Map<PaymentProvider, PaymentProviderAdapter>();

/** Vitest-only: inject a mock adapter without live provider credentials. */
export const setTestPaymentProviderAdapter = (
  provider: PaymentProvider,
  adapter: PaymentProviderAdapter | null,
): void => {
  if (adapter) {
    testAdapterOverrides.set(provider, adapter);
  } else {
    testAdapterOverrides.delete(provider);
  }
};

export const clearTestPaymentProviderAdapters = (): void => {
  testAdapterOverrides.clear();
};

export const hasTestPaymentProviderAdapter = (provider: PaymentProvider): boolean =>
  process.env.NODE_ENV === "test" && testAdapterOverrides.has(provider);

export const getPaymentProviderAdapter = (provider: PaymentProvider): PaymentProviderAdapter => {
  if (process.env.NODE_ENV === "test") {
    const override = testAdapterOverrides.get(provider);
    if (override) {
      return override;
    }
  }

  switch (provider) {
    case PaymentProvider.RAZORPAY:
      return razorpayAdapter;
    case PaymentProvider.STRIPE:
      return stripeAdapter;
    default:
      fail(500, "Unsupported payment provider");
  }
};
