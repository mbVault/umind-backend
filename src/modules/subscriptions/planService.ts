import { prisma } from "../../lib/prisma";

export const listActiveSubscriptionPlans = async () => {
  const plans = await prisma.subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: { durationDays: "asc" },
  });

  return plans.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    priceMinorUnits: p.priceMinorUnits,
    currency: p.currency,
    interval: p.interval,
    durationDays: p.durationDays,
  }));
};
