import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { sendSuccess } from "../lib/apiResponse";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { validateBody, validateParams } from "../middleware/validate";
import { choosePsychologistFaultRemedy } from "../modules/bookings/psychologistFaultResolutionService";
import { fileSessionComplaint } from "../modules/sessions/complaintService";
import { psychologistFaultRemedyBodySchema } from "../validators/psychologistFault";
import {
  completeSessionForCustomer,
  evaluatePsychologistNoShow,
  getSessionForCustomer,
  grantCustomerRecordingConsent,
  recordCustomerAttendance,
} from "../modules/sessions/sessionService";
import { fileComplaintBodySchema } from "../validators/complaints";
import { attendanceBodySchema, sessionIdParamSchema } from "../validators/sessions";

export const sessionsRouter = Router();

sessionsRouter.use(authenticate);

sessionsRouter.get(
  "/:sessionId",
  validateParams(sessionIdParamSchema),
  asyncHandler(async (req, res) => {
    const { sessionId } = sessionIdParamSchema.parse(req.params);
    const { userId } = (req as AuthenticatedRequest).auth;
    const data = await getSessionForCustomer(userId, sessionId);
    sendSuccess(res, 200, data);
  }),
);

sessionsRouter.post(
  "/:sessionId/attendance",
  validateParams(sessionIdParamSchema),
  validateBody(attendanceBodySchema),
  asyncHandler(async (req, res) => {
    const { sessionId } = sessionIdParamSchema.parse(req.params);
    const { userId } = (req as AuthenticatedRequest).auth;
    const { eventType } = attendanceBodySchema.parse(req.body);
    await recordCustomerAttendance({ userId, sessionId, eventType });
    sendSuccess(res, 200, { recorded: true });
  }),
);

sessionsRouter.post(
  "/:sessionId/recording-consent",
  validateParams(sessionIdParamSchema),
  asyncHandler(async (req, res) => {
    const { sessionId } = sessionIdParamSchema.parse(req.params);
    const { userId } = (req as AuthenticatedRequest).auth;
    await grantCustomerRecordingConsent({ userId, sessionId });
    sendSuccess(res, 200, { consented: true });
  }),
);

sessionsRouter.post(
  "/:sessionId/complete",
  validateParams(sessionIdParamSchema),
  asyncHandler(async (req, res) => {
    const { sessionId } = sessionIdParamSchema.parse(req.params);
    const { userId } = (req as AuthenticatedRequest).auth;
    const data = await completeSessionForCustomer({ userId, sessionId });
    sendSuccess(res, 200, data);
  }),
);

sessionsRouter.post(
  "/:sessionId/evaluate-psychologist-no-show",
  validateParams(sessionIdParamSchema),
  asyncHandler(async (req, res) => {
    const { sessionId } = sessionIdParamSchema.parse(req.params);
    const { userId } = (req as AuthenticatedRequest).auth;
    const data = await evaluatePsychologistNoShow({ userId, sessionId });
    sendSuccess(res, 200, data);
  }),
);

sessionsRouter.post(
  "/:sessionId/psychologist-fault-remedy",
  validateParams(sessionIdParamSchema),
  validateBody(psychologistFaultRemedyBodySchema),
  asyncHandler(async (req, res) => {
    const { sessionId } = sessionIdParamSchema.parse(req.params);
    const { userId } = (req as AuthenticatedRequest).auth;
    const body = psychologistFaultRemedyBodySchema.parse(req.body);
    const data = await choosePsychologistFaultRemedy({ userId, sessionId, ...body });
    sendSuccess(res, 200, data);
  }),
);

sessionsRouter.post(
  "/:sessionId/complaints",
  validateParams(sessionIdParamSchema),
  validateBody(fileComplaintBodySchema),
  asyncHandler(async (req, res) => {
    const { sessionId } = sessionIdParamSchema.parse(req.params);
    const { userId } = (req as AuthenticatedRequest).auth;
    const body = fileComplaintBodySchema.parse(req.body);
    const data = await fileSessionComplaint({ userId, sessionId, ...body });
    sendSuccess(res, 201, data);
  }),
);
