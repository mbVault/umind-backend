import { Router } from "express";
import { PsychologistHrApprovalStatus, StaffRole } from "@prisma/client";
import { asyncHandler } from "../../lib/asyncHandler";
import { sendSuccess } from "../../lib/apiResponse";
import {
  requireSuperTokensIdentity,
  SuperTokensIdentityRequest,
} from "../../middleware/staffAuth";
import { ensureApplicantAccount } from "../../modules/staff/accountBootstrap";
import {
  accountHasRole,
  loadStaffAccountBySuperTokensUserId,
} from "../../modules/staff/accountLoader";
import { toPsychologistProfileDto, toStaffMeDto } from "../../modules/staff/dtos";
import { getOrCreatePsychologistProfile } from "../../modules/staff/psychologistService";

export const staffAccessRouter = Router();

/**
 * PSYCHOLOGIST — HR APPROVED + role (clinic Sign in)
 * APPLICANT — Account + Profile, not yet approved (or rejected)
 * IDENTITY_ONLY — SuperTokens only (no Account) → Onboard me
 */
staffAccessRouter.get(
  "/",
  requireSuperTokensIdentity,
  asyncHandler(async (req, res) => {
    const { superTokensUserId } = req as SuperTokensIdentityRequest;

    try {
      const account = await loadStaffAccountBySuperTokensUserId(superTokensUserId);
      const profile = account.psychologistProfile
        ? await getOrCreatePsychologistProfile(account.id)
        : null;

      const hasPsychRole = accountHasRole(account, StaffRole.PSYCHOLOGIST);
      const hrApproved = profile?.hrApprovalStatus === PsychologistHrApprovalStatus.APPROVED;

      // Final BGV / hard reject: keep session for status hub only — never clinic.
      if (profile?.identityOnboardingBlocked) {
        sendSuccess(res, 200, {
          access: "APPLICANT" as const,
          staff: toStaffMeDto(account),
          profile: toPsychologistProfileDto(profile),
        });
        return;
      }

      if (hasPsychRole && hrApproved && profile) {
        sendSuccess(res, 200, {
          access: "PSYCHOLOGIST" as const,
          staff: toStaffMeDto(account),
          profile: toPsychologistProfileDto(profile),
        });
        return;
      }

      if (profile) {
        sendSuccess(res, 200, {
          access: "APPLICANT" as const,
          staff: toStaffMeDto(account),
          profile: toPsychologistProfileDto(profile),
        });
        return;
      }
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status && status !== 403) throw err;
    }

    sendSuccess(res, 200, {
      access: "IDENTITY_ONLY" as const,
      staff: null,
      profile: null,
    });
  })
);

staffAccessRouter.post(
  "/onboard/start",
  requireSuperTokensIdentity,
  asyncHandler(async (req, res) => {
    const { superTokensUserId } = req as SuperTokensIdentityRequest;
    const body = (req.body ?? {}) as { email?: string };
    const account = await ensureApplicantAccount({
      superTokensUserId,
      email: body.email?.trim().toLowerCase() || null,
    });
    const profile = await getOrCreatePsychologistProfile(account.id);
    const hasPsychRole = accountHasRole(account, StaffRole.PSYCHOLOGIST);
    const hrApproved = profile.hrApprovalStatus === PsychologistHrApprovalStatus.APPROVED;

    if (hasPsychRole && hrApproved) {
      sendSuccess(res, 200, {
        access: "PSYCHOLOGIST" as const,
        staff: toStaffMeDto(account),
        profile: toPsychologistProfileDto(profile),
      });
      return;
    }

    sendSuccess(res, 200, {
      access: "APPLICANT" as const,
      staff: toStaffMeDto(account),
      profile: toPsychologistProfileDto(profile),
    });
  })
);
