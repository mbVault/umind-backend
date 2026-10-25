import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { sendSuccess } from "../lib/apiResponse";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { validateBody, validateParams } from "../middleware/validate";
import { secureComplaintFreeReschedule } from "../modules/sessions/complaintService";
import {
  complaintIdParamSchema,
  secureComplaintFreeRescheduleBodySchema,
} from "../validators/psychologistFault";

export const complaintsRouter = Router();

complaintsRouter.use(authenticate);

complaintsRouter.post(
  "/:complaintId/secure-free-reschedule",
  validateParams(complaintIdParamSchema),
  validateBody(secureComplaintFreeRescheduleBodySchema),
  asyncHandler(async (req, res) => {
    const { complaintId } = complaintIdParamSchema.parse(req.params);
    const { userId } = (req as AuthenticatedRequest).auth;
    const body = secureComplaintFreeRescheduleBodySchema.parse(req.body);
    const data = await secureComplaintFreeReschedule({ userId, complaintId, ...body });
    sendSuccess(res, 200, data);
  }),
);
