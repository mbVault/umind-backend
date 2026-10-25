import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { formatLocalDate, parseLocalDate } from "../../lib/localDates";

export const listMoods = async () => {
  const moods = await prisma.mood.findMany({ orderBy: { name: "asc" } });
  // Stable product order: Heavy → Bright
  const order = ["Heavy", "Low", "Okay", "Calm", "Bright"];
  moods.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  return {
    moods: moods.map((m) => ({ id: m.id, name: m.name })),
  };
};

export const getTodayMood = async (userId: string, dateStr: string) => {
  const date = parseLocalDate(dateStr);
  const row = await prisma.userMood.findUnique({
    where: { userId_date: { userId, date } },
    include: { mood: true },
  });
  return {
    date: dateStr,
    mood: row ? { id: row.mood.id, name: row.mood.name } : null,
  };
};

export const upsertTodayMood = async (userId: string, dateStr: string, moodId: string) => {
  const date = parseLocalDate(dateStr);
  const mood = await prisma.mood.findUnique({ where: { id: moodId } });
  if (!mood) {
    fail(400, "Validation failed", { moodId: ["Unknown mood"] });
  }

  const row = await prisma.userMood.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, moodId, date },
    update: { moodId },
    include: { mood: true },
  });

  return {
    date: dateStr,
    mood: { id: row.mood.id, name: row.mood.name },
    updatedAt: row.updatedAt.toISOString(),
  };
};

export const getMoodHistory = async (userId: string, fromStr: string, toStr: string) => {
  const from = parseLocalDate(fromStr, "from");
  const to = parseLocalDate(toStr, "to");
  const rows = await prisma.userMood.findMany({
    where: { userId, date: { gte: from, lte: to } },
    include: { mood: true },
    orderBy: { date: "asc" },
  });
  return {
    items: rows.map((r) => ({
      date: formatLocalDate(r.date),
      mood: { id: r.mood.id, name: r.mood.name },
    })),
  };
};

/** Today's mood name for Saathi context, or null. */
export const getMoodNameForDate = async (userId: string, dateStr: string): Promise<string | null> => {
  const date = parseLocalDate(dateStr);
  const row = await prisma.userMood.findUnique({
    where: { userId_date: { userId, date } },
    include: { mood: true },
  });
  return row?.mood.name ?? null;
};
