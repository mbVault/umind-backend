import { PayoutStatus } from "@prisma/client";
import { fail } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { getPayoutPsychologistSharePercent } from "../sessions/sessionConfig";
import { getOrCreatePsychologistProfile } from "./psychologistService";

const parseMonth = (month: string): { start: Date; end: Date; label: string } => {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) fail(400, "Validation failed", { month: ["Expected YYYY-MM"] });
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) fail(400, "Validation failed", { month: ["Invalid month"] });
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));
  return { start, end, label: month };
};

const isoWeekStart = (d: Date): Date => {
  const day = d.getUTCDay() || 7; // Mon=1..Sun=7
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (day - 1));
  return start;
};

export const getEarningsSummary = async (accountId: string, month: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const { start, end, label } = parseMonth(month);

  const payouts = await prisma.psychologistPayout.findMany({
    where: {
      psychologistProfileId: profile.id,
      createdAt: { gte: start, lt: end },
    },
  });

  let grossMinorUnits = 0;
  let psychologistShareMinorUnits = 0;
  let platformShareMinorUnits = 0;
  let pendingMinorUnits = 0;
  let paidMinorUnits = 0;
  const currency = payouts[0]?.currency ?? "INR";

  for (const p of payouts) {
    grossMinorUnits += p.grossAmountMinorUnits;
    psychologistShareMinorUnits += p.psychologistShareMinorUnits;
    platformShareMinorUnits += p.platformShareMinorUnits;
    if (p.status === PayoutStatus.PAID) paidMinorUnits += p.psychologistShareMinorUnits;
    else pendingMinorUnits += p.psychologistShareMinorUnits;
  }

  return {
    month: label,
    eligibleSessionCount: payouts.length,
    grossMinorUnits,
    psychologistShareMinorUnits,
    platformShareMinorUnits,
    splitPercent: getPayoutPsychologistSharePercent(),
    pendingMinorUnits,
    paidMinorUnits,
    currency,
  };
};

export const getEarningsWeekly = async (accountId: string, month: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const { start, end, label } = parseMonth(month);

  const payouts = await prisma.psychologistPayout.findMany({
    where: {
      psychologistProfileId: profile.id,
      createdAt: { gte: start, lt: end },
    },
    include: {
      session: { include: { booking: { select: { scheduledStartAt: true } } } },
    },
  });

  const weeks = new Map<string, { weekStart: Date; sessionCount: number; psychologistShareMinorUnits: number }>();
  for (const p of payouts) {
    const anchor = p.session.booking.scheduledStartAt;
    const ws = isoWeekStart(anchor);
    const key = ws.toISOString().slice(0, 10);
    const row = weeks.get(key) ?? {
      weekStart: ws,
      sessionCount: 0,
      psychologistShareMinorUnits: 0,
    };
    row.sessionCount += 1;
    row.psychologistShareMinorUnits += p.psychologistShareMinorUnits;
    weeks.set(key, row);
  }

  const items = [...weeks.values()]
    .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
    .map((w) => {
      const weekEnd = new Date(w.weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      return {
        weekStart: w.weekStart.toISOString().slice(0, 10),
        weekEnd: weekEnd.toISOString().slice(0, 10),
        sessionCount: w.sessionCount,
        psychologistShareMinorUnits: w.psychologistShareMinorUnits,
      };
    });

  return { month: label, items };
};

export const listPsychologistPayouts = async (
  accountId: string,
  input: { page: number; pageSize: number },
) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const where = { psychologistProfileId: profile.id };
  const [total, rows] = await Promise.all([
    prisma.psychologistPayout.count({ where }),
    prisma.psychologistPayout.findMany({
      where,
      include: {
        session: { include: { booking: { select: { scheduledStartAt: true, scheduledEndAt: true } } } },
      },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  return {
    page: input.page,
    pageSize: input.pageSize,
    total,
    items: rows.map((p) => ({
      id: p.id,
      sessionId: p.sessionId,
      scheduledStartAt: p.session.booking.scheduledStartAt.toISOString(),
      scheduledEndAt: p.session.booking.scheduledEndAt.toISOString(),
      grossAmountMinorUnits: p.grossAmountMinorUnits,
      psychologistShareMinorUnits: p.psychologistShareMinorUnits,
      status: p.status,
      currency: p.currency,
      createdAt: p.createdAt.toISOString(),
      paidAt: p.paidAt?.toISOString() ?? null,
    })),
  };
};

export const getPsychologistPayout = async (accountId: string, payoutId: string) => {
  const profile = await getOrCreatePsychologistProfile(accountId);
  const payout = await prisma.psychologistPayout.findFirst({
    where: { id: payoutId, psychologistProfileId: profile.id },
    include: {
      session: { include: { booking: { select: { scheduledStartAt: true, scheduledEndAt: true } } } },
    },
  });
  if (!payout) fail(404, "Payout not found");

  return {
    id: payout.id,
    sessionId: payout.sessionId,
    scheduledStartAt: payout.session.booking.scheduledStartAt.toISOString(),
    scheduledEndAt: payout.session.booking.scheduledEndAt.toISOString(),
    grossAmountMinorUnits: payout.grossAmountMinorUnits,
    psychologistShareMinorUnits: payout.psychologistShareMinorUnits,
    platformShareMinorUnits: payout.platformShareMinorUnits,
    splitVersion: payout.splitVersion,
    currency: payout.currency,
    provider: payout.provider,
    providerTransferId: payout.providerTransferId,
    status: payout.status,
    createdAt: payout.createdAt.toISOString(),
    initiatedAt: payout.initiatedAt?.toISOString() ?? null,
    paidAt: payout.paidAt?.toISOString() ?? null,
    lastError: payout.lastError,
  };
};
