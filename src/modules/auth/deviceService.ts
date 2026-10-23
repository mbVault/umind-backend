import { prisma } from "../../lib/prisma";

export const upsertDeviceRegistration = async (
  userId: string,
  deviceId: string
): Promise<string> => {
  await prisma.device.upsert({
    where: { id: deviceId },
    create: { id: deviceId, lastSeenAt: new Date() },
    update: { lastSeenAt: new Date() },
  });

  const registration = await prisma.userDevice.upsert({
    where: { userId_deviceId: { userId, deviceId } },
    create: { userId, deviceId, lastUsedAt: new Date() },
    update: { lastUsedAt: new Date(), revokedAt: null },
  });

  return registration.id;
};
