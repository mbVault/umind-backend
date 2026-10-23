import { prisma } from "../src/lib/prisma";

export const TEST_RECOVERY_KEY =
  "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu";

export const resetAuthTables = async (): Promise<void> => {
  await prisma.authSession.deleteMany();
  await prisma.userDevice.deleteMany();
  await prisma.device.deleteMany();
  await prisma.user.deleteMany();
};

// Staff tables are reset via tests/staff.helpers.ts (resetStaffTables).

export const registerPayload = (overrides: Record<string, unknown> = {}) => ({
  recoveryKey: TEST_RECOVERY_KEY,
  alias: "Neela",
  avatarId: "avatar-indigo",
  lifeStage: "STARTING_OUT",
  gender: "WOMAN",
  startingFeelings: ["STRESSED"],
  appTheme: "LAVENDER",
  city: "Delhi",
  saathiCheckIn: "MORNING",
  saathiLanguage: "HINGLISH",
  unwindHabits: ["BREATHING", "WALKING"],
  deviceId: "550e8400-e29b-41d4-a716-446655440001",
  ...overrides,
});
