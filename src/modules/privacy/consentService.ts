import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export const getPrivacyConsent = async (userId: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    shareDiaryWithSaathi: user.shareDiaryWithSaathi,
    shareDiaryConsentVersion: user.shareDiaryConsentVersion,
    shareDiaryConsentAt: user.shareDiaryConsentAt?.toISOString() ?? null,
    diaryKdfSalt: user.diaryKdfSalt ? Buffer.from(user.diaryKdfSalt).toString("base64") : null,
    diaryKeyVersion: user.diaryKeyVersion,
  };
};

export const putPrivacyConsent = async (
  userId: string,
  input: {
    shareDiaryWithSaathi: boolean;
    shareDiaryConsentVersion?: number;
    diaryKdfSalt?: string;
  },
) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  let diaryKdfSalt: Uint8Array<ArrayBuffer> | undefined;
  if (input.diaryKdfSalt !== undefined) {
    let buf: Buffer;
    try {
      buf = Buffer.from(input.diaryKdfSalt, "base64");
    } catch {
      fail(400, "Validation failed", { diaryKdfSalt: ["Invalid base64"] });
    }
    if (buf.length < 8 || buf.length > 64) {
      fail(400, "Validation failed", { diaryKdfSalt: ["Must decode to 8–64 bytes"] });
    }
    const next = new Uint8Array(new ArrayBuffer(buf.byteLength));
    next.set(buf);
    if (user.diaryKdfSalt && !bytesEqual(user.diaryKdfSalt, next)) {
      fail(409, "Diary KDF salt is already set and cannot be changed");
    }
    diaryKdfSalt = next;
  }

  if (input.shareDiaryWithSaathi && input.shareDiaryConsentVersion === undefined && !user.shareDiaryConsentVersion) {
    fail(400, "Validation failed", {
      shareDiaryConsentVersion: ["Required when enabling diary sharing"],
    });
  }

  const enabling = input.shareDiaryWithSaathi && !user.shareDiaryWithSaathi;
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      shareDiaryWithSaathi: input.shareDiaryWithSaathi,
      ...(input.shareDiaryWithSaathi
        ? {
            shareDiaryConsentVersion: input.shareDiaryConsentVersion ?? user.shareDiaryConsentVersion,
            shareDiaryConsentAt: enabling ? new Date() : user.shareDiaryConsentAt ?? new Date(),
          }
        : {}),
      ...(diaryKdfSalt ? { diaryKdfSalt } : {}),
    },
  });

  return {
    shareDiaryWithSaathi: updated.shareDiaryWithSaathi,
    shareDiaryConsentVersion: updated.shareDiaryConsentVersion,
    shareDiaryConsentAt: updated.shareDiaryConsentAt?.toISOString() ?? null,
    diaryKdfSalt: updated.diaryKdfSalt ? Buffer.from(updated.diaryKdfSalt).toString("base64") : null,
    diaryKeyVersion: updated.diaryKeyVersion,
  };
};
