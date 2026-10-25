import { Router } from "express";
import { StaffRole } from "@prisma/client";
import { asyncHandler } from "../../lib/asyncHandler";
import { sendSuccess } from "../../lib/apiResponse";
import {
  requireAdminPermission,
  requireStaffAccount,
  requireStaffRole,
  StaffAuthenticatedRequest,
} from "../../middleware/staffAuth";
import { validateBody, validateParams } from "../../middleware/validate";
import { resolveSessionComplaint } from "../../modules/sessions/complaintService";
import { complaintIdParamSchema, resolveComplaintBodySchema } from "../../validators/complaints";

export const adminComplaintsRouter = Router();

adminComplaintsRouter.use(
  requireStaffAccount,
  requireStaffRole(StaffRole.ADMIN),
  requireAdminPermission("safety_alerts.read"),
);

adminComplaintsRouter.post(
  "/:complaintId/resolve",
  validateParams(complaintIdParamSchema),
  validateBody(resolveComplaintBodySchema),
  asyncHandler(async (req, res) => {
    const { complaintId } = complaintIdParamSchema.parse(req.params);
    const body = resolveComplaintBodySchema.parse(req.body);
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const data = await resolveSessionComplaint({
      reviewerAccountId: account.id,
      complaintId,
      decision: body.decision,
      rationale: body.rationale,
      partialRefundPercent: body.partialRefundPercent,
    });
    sendSuccess(res, 200, data);
  }),
);
