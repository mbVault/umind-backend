import { fail } from "./errors";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse client-local calendar day `YYYY-MM-DD` into a Date suitable for Prisma `@db.Date`. */
export const parseLocalDate = (value: string, field = "date"): Date => {
  if (!DATE_RE.test(value)) {
    fail(400, "Validation failed", { [field]: ["Must be YYYY-MM-DD"] });
  }
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    fail(400, "Validation failed", { [field]: ["Invalid calendar date"] });
  }
  return dt;
};

export const formatLocalDate = (value: Date): string => {
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

/** Resolve "today" for Saathi mood context from client headers, default Asia/Kolkata. */
export const resolveClientLocalDate = (headers: {
  localDate?: string | null;
  timezone?: string | null;
}): string => {
  const explicit = headers.localDate?.trim();
  if (explicit) {
    parseLocalDate(explicit, "X-Client-Local-Date");
    return explicit;
  }

  const tz = headers.timezone?.trim() || "Asia/Kolkata";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (!y || !m || !d) {
      fail(400, "Validation failed", { "X-Client-Timezone": ["Could not resolve local date"] });
    }
    return `${y}-${m}-${d}`;
  } catch {
    fail(400, "Validation failed", { "X-Client-Timezone": ["Invalid timezone"] });
  }
};
