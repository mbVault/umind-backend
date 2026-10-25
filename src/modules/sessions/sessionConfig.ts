import { env } from "../../config/env";

export const getPsychNoShowGraceMinutes = (): number => {
  const live = process.env.SESSION_PSYCH_NO_SHOW_GRACE_MINUTES;
  if (live !== undefined && live !== "") {
    return Number(live);
  }
  return env.SESSION_PSYCH_NO_SHOW_GRACE_MINUTES;
};

export const getPayoutPsychologistSharePercent = (): number => {
  const live = process.env.PAYOUT_PSYCHOLOGIST_SHARE_PERCENT;
  if (live !== undefined && live !== "") {
    return Number(live);
  }
  return env.PAYOUT_PSYCHOLOGIST_SHARE_PERCENT;
};

export const getPayoutSplitVersion = (): string =>
  (process.env.PAYOUT_SPLIT_VERSION ?? env.PAYOUT_SPLIT_VERSION).trim();
