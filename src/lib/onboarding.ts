import { User } from "@prisma/client";

/** Onboarding complete when all required User columns are populated (always true after register). */
export const isOnboardingComplete = (_user: User): boolean => true;
