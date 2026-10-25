import { ProfileVisibilityMode, PsychologistProfile, PsychologistLanguage, PsychologistSpecialisation } from "@prisma/client";

export type PublicPsychologistProfile = Pick<
  PsychologistProfile,
  | "id"
  | "visibilityMode"
  | "displayName"
  | "avatarColor"
  | "avatarInitials"
  | "highestDegree"
  | "yearsPractising"
> & {
  publicName: string;
  hasPublicPhoto: boolean;
  specialisations: string[];
  languages: string[];
};

type ProfileRow = PsychologistProfile & {
  specialisations: PsychologistSpecialisation[];
  languages: PsychologistLanguage[];
};

const resolvePublicName = (profile: ProfileRow): string => {
  if (profile.visibilityMode === ProfileVisibilityMode.REAL_NAME_AND_PHOTO && profile.legalFullName) {
    return profile.legalFullName;
  }
  return profile.displayName?.trim() || "Psychologist";
};

/** Client directory DTO — no Account, verification, Aadhaar, RCI, or storage keys. */
export const toPublicPsychologistDto = (profile: ProfileRow): PublicPsychologistProfile => ({
  id: profile.id,
  visibilityMode: profile.visibilityMode,
  displayName: profile.displayName,
  publicName: resolvePublicName(profile),
  hasPublicPhoto:
    profile.visibilityMode === ProfileVisibilityMode.REAL_NAME_AND_PHOTO &&
    Boolean(profile.publicPhotoObjectKey),
  avatarColor: profile.avatarColor,
  avatarInitials: profile.avatarInitials,
  highestDegree: profile.highestDegree,
  yearsPractising: profile.yearsPractising,
  specialisations: profile.specialisations.map((s) => s.code),
  languages: profile.languages.map((l) => l.code),
});
