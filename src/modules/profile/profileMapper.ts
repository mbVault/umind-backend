import { User } from "@prisma/client";
import { isOnboardingComplete } from "../../lib/onboarding";

export const toProfileResponse = (user: User) => ({
  id: user.id,
  alias: user.alias,
  avatarId: user.avatarId,
  lifeStage: user.lifeStage,
  gender: user.gender,
  startingFeelings: user.startingFeelings,
  appTheme: user.appTheme,
  city: user.city,
  saathiCheckIn: user.saathiCheckIn,
  saathiLanguage: user.saathiLanguage,
  unwindHabits: user.unwindHabits,
  status: user.status,
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
  onboardingComplete: isOnboardingComplete(user),
});
