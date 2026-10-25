import { PaymentProvider } from "@prisma/client";
import { env } from "../../config/env";
import { fail } from "../../lib/errors";

const SUPPORTED_STRIPE_COUNTRY_PREFIXES = new Set(["US", "GB", "CA", "AU", "SG", "AE", "DE", "FR"]);

/**
 * Server-side provider routing. Never trust client-supplied country in production.
 * Dev/test: PAYMENT_DEV_COUNTRY. Production: pass trusted country (e.g. CF-IPCountry) when wired.
 */
export const selectPaymentProvider = (trustedCountryIso2: string | undefined): PaymentProvider => {
  let country: string;

  if (env.NODE_ENV === "production") {
    if (!trustedCountryIso2 || trustedCountryIso2.length !== 2) {
      fail(503, "Payment routing requires a trusted country signal in production");
    }
    country = trustedCountryIso2.toUpperCase();
  } else {
    country = (trustedCountryIso2 ?? env.PAYMENT_DEV_COUNTRY).toUpperCase();
  }

  if (country === "IN") {
    return PaymentProvider.RAZORPAY;
  }

  if (SUPPORTED_STRIPE_COUNTRY_PREFIXES.has(country)) {
    return PaymentProvider.STRIPE;
  }

  fail(400, "Payments are not supported for this region");
};

/** Dev/test helper — explicit override without client input in production paths. */
export const selectPaymentProviderForCurrentEnvironment = (): PaymentProvider =>
  selectPaymentProvider(env.NODE_ENV === "production" ? undefined : env.PAYMENT_DEV_COUNTRY);
