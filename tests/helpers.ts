import { prisma } from "../src/lib/prisma";

export const TEST_RECOVERY_KEY =
  "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu";

export const resetCommerceTables = async (): Promise<void> => {
  await prisma.sessionComplaint.deleteMany();
  await prisma.psychologistPayout.deleteMany();
  await prisma.paymentStatusHistory.deleteMany();
  await prisma.paymentRefund.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.order.deleteMany();
  await prisma.sessionRecordingConsent.deleteMany();
  await prisma.attendanceEvent.deleteMany();
  await prisma.psychologistSession.deleteMany();
  await prisma.psychologistBooking.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.paymentWebhookEvent.deleteMany();
  await prisma.psychologistAvailabilitySlot.deleteMany();
};

export const resetAuthTables = async (): Promise<void> => {
  await resetCommerceTables();
  await prisma.saathiMessage.deleteMany();
  await prisma.saathiMemory.deleteMany();
  await prisma.saathiConversation.deleteMany();
  await prisma.userMood.deleteMany();
  await prisma.diaryEntry.deleteMany();
  await prisma.audioFeelingTag.deleteMany();
  await prisma.audioLifeStageTarget.deleteMany();
  await prisma.audioGenderTarget.deleteMany();
  await prisma.audioVersion.deleteMany();
  await prisma.audioTrack.deleteMany();
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
