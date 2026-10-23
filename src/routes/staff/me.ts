import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { sendSuccess } from "../../lib/apiResponse";
import {
  requireActiveAdmin,
  requireStaffAccount,
  StaffAuthenticatedRequest,
} from "../../middleware/staffAuth";
import { toStaffMeDto } from "../../modules/staff/dtos";

export const staffMeRouter = Router();

staffMeRouter.use(requireStaffAccount);

staffMeRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    sendSuccess(res, 200, toStaffMeDto(account));
  })
);

staffMeRouter.get(
  "/permissions",
  requireActiveAdmin,
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    sendSuccess(res, 200, { permissions: account.permissionCodes });
  })
);
