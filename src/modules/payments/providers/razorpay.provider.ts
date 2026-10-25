import Razorpay from "razorpay";
import { PaymentProvider } from "@prisma/client";
import { fail } from "../../../lib/errors";
import { isRazorpayConfigured, readPaymentEnv } from "../paymentConfig";
import {
  CreateProviderCheckoutInput,
  PaymentProviderAdapter,
  ProviderCheckoutSession,
} from "./payment-provider.interface";

let client: Razorpay | null = null;

const getClient = (): Razorpay => {
  if (!isRazorpayConfigured()) {
    fail(503, "Razorpay is not configured on the server");
  }
  if (!client) {
    client = new Razorpay({
      key_id: readPaymentEnv("RAZORPAY_KEY_ID"),
      key_secret: readPaymentEnv("RAZORPAY_KEY_SECRET"),
    });
  }
  return client;
};

export const razorpayAdapter: PaymentProviderAdapter = {
  provider: PaymentProvider.RAZORPAY,

  async createCheckoutSession(input: CreateProviderCheckoutInput): Promise<ProviderCheckoutSession> {
    if (input.currency.toUpperCase() !== "INR") {
      fail(400, "Razorpay checkout requires INR");
    }

    const order = await getClient().orders.create({
      amount: input.amountMinorUnits,
      currency: input.currency.toUpperCase(),
      receipt: input.receiptReference.slice(0, 40),
      notes: input.metadata,
    });

    return {
      provider: PaymentProvider.RAZORPAY,
      providerReferenceId: order.id,
      client: {
        keyId: readPaymentEnv("RAZORPAY_KEY_ID"),
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
      },
    };
  },
};
