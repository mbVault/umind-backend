import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { formatLocalDate, parseLocalDate } from "../../lib/localDates";

const MAX_CIPHERTEXT_BYTES = 64 * 1024;
const MAX_NONCE_BYTES = 64;
const MIN_NONCE_BYTES = 12;

const toPrismaBytes = (buf: Buffer): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
};

const decodeB64 = (value: string, field: string, max: number, min = 1): Uint8Array<ArrayBuffer> => {
  let buf: Buffer;
  try {
    buf = Buffer.from(value, "base64");
  } catch {
    fail(400, "Validation failed", { [field]: ["Invalid base64"] });
  }
  if (buf.length < min || buf.length > max) {
    fail(400, "Validation failed", { [field]: [`Must decode to ${min}–${max} bytes`] });
  }
  if (buf.length === 0) {
    fail(400, "Validation failed", { [field]: ["Empty after decode"] });
  }
  return toPrismaBytes(buf);
};

const toB64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

const entryDto = (e: {
  id: string;
  entryDate: Date;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  encryptionVersion: number;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: e.id,
  entryDate: formatLocalDate(e.entryDate),
  ciphertext: toB64(e.ciphertext),
  nonce: toB64(e.nonce),
  encryptionVersion: e.encryptionVersion,
  schemaVersion: e.schemaVersion,
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
});

export const listDiaryEntries = async (userId: string, fromStr: string, toStr: string) => {
  const from = parseLocalDate(fromStr, "from");
  const to = parseLocalDate(toStr, "to");
  const entries = await prisma.diaryEntry.findMany({
    where: { userId, entryDate: { gte: from, lte: to } },
    orderBy: { entryDate: "asc" },
  });
  return { entries: entries.map(entryDto) };
};

export const getDiaryEntry = async (userId: string, entryDateStr: string) => {
  const entryDate = parseLocalDate(entryDateStr, "entryDate");
  const entry = await prisma.diaryEntry.findUnique({
    where: { userId_entryDate: { userId, entryDate } },
  });
  if (!entry) {
    fail(404, "Diary entry not found");
  }
  return entryDto(entry);
};

export const upsertDiaryEntry = async (
  userId: string,
  entryDateStr: string,
  input: {
    ciphertext: string;
    nonce: string;
    encryptionVersion: number;
    schemaVersion: number;
  },
) => {
  const entryDate = parseLocalDate(entryDateStr, "entryDate");
  const ciphertext = decodeB64(input.ciphertext, "ciphertext", MAX_CIPHERTEXT_BYTES);
  const nonce = decodeB64(input.nonce, "nonce", MAX_NONCE_BYTES, MIN_NONCE_BYTES);

  const entry = await prisma.diaryEntry.upsert({
    where: { userId_entryDate: { userId, entryDate } },
    create: {
      userId,
      entryDate,
      ciphertext,
      nonce,
      encryptionVersion: input.encryptionVersion,
      schemaVersion: input.schemaVersion,
    },
    update: {
      ciphertext,
      nonce,
      encryptionVersion: input.encryptionVersion,
      schemaVersion: input.schemaVersion,
    },
  });

  return {
    id: entry.id,
    entryDate: formatLocalDate(entry.entryDate),
    encryptionVersion: entry.encryptionVersion,
    schemaVersion: entry.schemaVersion,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
};

export const deleteDiaryEntry = async (userId: string, entryDateStr: string) => {
  const entryDate = parseLocalDate(entryDateStr, "entryDate");
  const existing = await prisma.diaryEntry.findUnique({
    where: { userId_entryDate: { userId, entryDate } },
  });
  if (!existing) {
    fail(404, "Diary entry not found");
  }
  await prisma.diaryEntry.delete({ where: { id: existing.id } });
  return { deleted: true as const, entryDate: entryDateStr };
};

export const getDiaryStreak = async (userId: string) => {
  const count = await prisma.diaryEntry.count({ where: { userId } });
  return { daysWithEntries: count };
};
