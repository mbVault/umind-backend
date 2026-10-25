import { createHmac } from "crypto";
import { env } from "../../config/env";
import { fail } from "../../lib/errors";
import { prisma } from "../../lib/prisma";

/** Opaque, stable per psychologist–client pair. Never expose User.id to psych apps. */
export const toClientRef = (psychologistProfileId: string, userId: string): string =>
  createHmac("sha256", env.TOKEN_PEPPER)
    .update(`psych:${psychologistProfileId}:user:${userId}`)
    .digest("base64url")
    .slice(0, 22);

export const resolveClientRefForPsychologist = async (
  psychologistProfileId: string,
  clientRef: string,
): Promise<string> => {
  const rows = await prisma.psychologistBooking.findMany({
    where: { psychologistProfileId },
    select: { userId: true },
    distinct: ["userId"],
  });
  for (const row of rows) {
    if (toClientRef(psychologistProfileId, row.userId) === clientRef) {
      return row.userId;
    }
  }
  fail(404, "Client not found");
};

export const clientPublicSlice = (user: {
  alias: string;
  avatarId: string;
  lifeStage?: string;
  gender?: string;
  startingFeelings?: string[];
}) => ({
  alias: user.alias,
  avatarId: user.avatarId,
  ...(user.lifeStage !== undefined ? { lifeStage: user.lifeStage } : {}),
  ...(user.gender !== undefined ? { gender: user.gender } : {}),
  ...(user.startingFeelings !== undefined ? { startingFeelings: user.startingFeelings } : {}),
});
