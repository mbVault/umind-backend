import { AuditActorType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export const writeAuditLog = async (input: {
  actorAccountId?: string | null;
  actorType?: AuditActorType;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<void> => {
  const client = input.tx ?? prisma;
  await client.adminAuditLog.create({
    data: {
      actorAccountId: input.actorAccountId ?? null,
      actorType: input.actorType ?? AuditActorType.ADMIN,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? undefined,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
};
