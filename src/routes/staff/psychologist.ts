import { Router } from "express";
import { PsychologistDocumentKind, StaffRole } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler";
import { sendSuccess } from "../../lib/apiResponse";
import { param } from "../../lib/routeParams";
import {
  requireStaffAccount,
  requireStaffRole,
  StaffAuthenticatedRequest,
} from "../../middleware/staffAuth";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate";
import { toDocumentMetaDto } from "../../modules/staff/documentService";
import {
  confirmReplacement,
  confirmUpload,
  listPsychologistDocuments,
  requestReplacementUploadUrl,
  requestUploadUrl,
} from "../../modules/staff/documentService";
import { toPsychologistProfileDto } from "../../modules/staff/dtos";
import {
  getEarningsSummary,
  getEarningsWeekly,
  getPsychologistPayout,
  listPsychologistPayouts,
} from "../../modules/staff/psychologistEarningsService";
import {
  listStaffAvailability,
  replaceOpenAvailabilitySlots,
  updatePsychologistHours,
  updatePsychologistPresence,
} from "../../modules/staff/psychologistHoursService";
import {
  getBookingBrief,
  getBookingSafetyFlags,
  getClientBrief,
  getClientHistory,
  getPsychologistDashboard,
  listPsychologistBookingsForDate,
  listPsychologistClients,
} from "../../modules/staff/psychologistOpsService";
import {
  completePsychologistSession,
  getAfterSession,
  getPsychologistSession,
  getSessionNotes,
  joinPsychologistSession,
  leavePsychologistSession,
  putAfterSession,
  putSessionNotes,
} from "../../modules/staff/psychologistSessionOpsService";
import { submitForHrReview } from "../../modules/staff/hrApprovalService";
import {
  getOrCreatePsychologistProfile,
  submitPsychologistApplication,
  updatePsychologistPublicProfile,
  upsertApplicationDraft,
} from "../../modules/staff/psychologistService";
import {
  afterSessionBodySchema,
  applicationBodySchema,
  bookingIdParamSchema,
  bookingsDateQuerySchema,
  clientRefParamSchema,
  confirmUploadBodySchema,
  dashboardQuerySchema,
  earningsMonthQuerySchema,
  hoursPatchSchema,
  payoutIdParamSchema,
  payoutsListQuerySchema,
  presencePatchSchema,
  profilePatchSchema,
  replacementConfirmBodySchema,
  replacementUploadBodySchema,
  sessionIdParamSchema,
  sessionNotesBodySchema,
  staffAvailabilityPutSchema,
  staffAvailabilityQuerySchema,
  uploadUrlBodySchema,
} from "../../validators/staff";

export const psychologistRouter = Router();

/** Account required. PSYCHOLOGIST role only for clinic ops (after HR approve). */
psychologistRouter.use(requireStaffAccount);

psychologistRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const profile = await getOrCreatePsychologistProfile(account.id);
    sendSuccess(res, 200, toPsychologistProfileDto(profile));
  })
);

psychologistRouter.put(
  "/me/application",
  validateBody(applicationBodySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const profile = await upsertApplicationDraft(account.id, req.body);
    sendSuccess(res, 200, toPsychologistProfileDto(profile));
  })
);

psychologistRouter.patch(
  "/me/profile",
  validateBody(profilePatchSchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const profile = await updatePsychologistPublicProfile(account.id, req.body);
    sendSuccess(res, 200, toPsychologistProfileDto(profile));
  })
);

/** Submit for HR screening (pending_approval). No Sign-in role granted. */
psychologistRouter.post(
  "/me/application/submit-hr",
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const profile = await submitForHrReview(account.id);
    sendSuccess(res, 200, toPsychologistProfileDto(profile));
  })
);

/** Today screen: Online / Away toggle. Does not cancel existing client bookings. */
psychologistRouter.patch(
  "/me/presence",
  requireStaffRole(StaffRole.PSYCHOLOGIST),
  validateBody(presencePatchSchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const body = req.body as z.infer<typeof presencePatchSchema>;
    const profile = await updatePsychologistPresence(account.id, body.presence);
    sendSuccess(res, 200, toPsychologistProfileDto(profile));
  })
);

/** Hours screen: accepting-new, max/day, modes, weekly template (+ optional presence). */
psychologistRouter.patch(
  "/me/hours",
  requireStaffRole(StaffRole.PSYCHOLOGIST),
  validateBody(hoursPatchSchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const body = req.body as z.infer<typeof hoursPatchSchema>;
    const profile = await updatePsychologistHours(account.id, body);
    sendSuccess(res, 200, toPsychologistProfileDto(profile));
  })
);

/**
 * Hours screen: concrete slots with OPEN/HELD/BOOKED status.
 * Client GET /api/psychologists/:id/availability stays open-only and unchanged.
 */
psychologistRouter.get(
  "/me/availability",
  requireStaffRole(StaffRole.PSYCHOLOGIST),
  validateQuery(staffAvailabilityQuerySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const query = (req as typeof req & { validatedQuery: z.infer<typeof staffAvailabilityQuerySchema> })
      .validatedQuery;
    const data = await listStaffAvailability({
      accountId: account.id,
      from: query.from,
      to: query.to,
    });
    sendSuccess(res, 200, data);
  })
);

/**
 * Soft replace open slots only. Held/booked times are never deleted
 * (protects in-flight client holds and confirmed sessions).
 */
psychologistRouter.put(
  "/me/availability",
  requireStaffRole(StaffRole.PSYCHOLOGIST),
  validateBody(staffAvailabilityPutSchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const body = req.body as z.infer<typeof staffAvailabilityPutSchema>;
    const data = await replaceOpenAvailabilitySlots({
      accountId: account.id,
      replaceOpenSlots: body.replaceOpenSlots,
    });
    sendSuccess(res, 200, data);
  })
);

/** Post-HR: submit docs into verification checks (approved psychologists). */
psychologistRouter.post(
  "/me/application/submit",
  requireStaffRole(StaffRole.PSYCHOLOGIST),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const profile = await submitPsychologistApplication(account.id);
    sendSuccess(res, 200, toPsychologistProfileDto(profile));
  })
);

psychologistRouter.get(
  "/me/documents",
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const profile = await getOrCreatePsychologistProfile(account.id);
    const docs = await listPsychologistDocuments(profile.id);
    sendSuccess(res, 200, { documents: docs.map(toDocumentMetaDto) });
  })
);

psychologistRouter.post(
  "/me/documents/upload-url",
  validateBody(uploadUrlBodySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const profile = await getOrCreatePsychologistProfile(account.id);
    const body = req.body as {
      kind: PsychologistDocumentKind;
      contentType: string;
      byteSize: number;
    };
    const result = await requestUploadUrl({
      psychologistProfileId: profile.id,
      accountId: account.id,
      kind: body.kind,
      contentType: body.contentType,
      byteSize: body.byteSize,
    });
    sendSuccess(res, 200, {
      objectKey: result.objectKey,
      uploadUrl: result.url,
      expiresAt: result.expiresAt.toISOString(),
      headers: result.headers ?? {},
    });
  })
);

psychologistRouter.post(
  "/me/documents/confirm",
  validateBody(confirmUploadBodySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const profile = await getOrCreatePsychologistProfile(account.id);
    const body = req.body as {
      kind: PsychologistDocumentKind;
      objectKey: string;
      contentType: string;
      byteSize: number;
    };
    const doc = await confirmUpload({
      psychologistProfileId: profile.id,
      accountId: account.id,
      kind: body.kind,
      objectKey: body.objectKey,
      contentType: body.contentType,
      byteSize: body.byteSize,
    });
    sendSuccess(res, 201, toDocumentMetaDto(doc));
  })
);

psychologistRouter.post(
  "/me/documents/:documentId/replacement-upload-url",
  validateBody(replacementUploadBodySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const profile = await getOrCreatePsychologistProfile(account.id);
    const documentId = param(req.params.documentId, "documentId");
    const body = req.body as { contentType: string; byteSize: number };
    const result = await requestReplacementUploadUrl({
      psychologistProfileId: profile.id,
      documentId,
      accountId: account.id,
      contentType: body.contentType,
      byteSize: body.byteSize,
    });
    sendSuccess(res, 200, {
      objectKey: result.objectKey,
      uploadUrl: result.url,
      expiresAt: result.expiresAt.toISOString(),
      headers: result.headers ?? {},
    });
  })
);

psychologistRouter.post(
  "/me/documents/:documentId/replacement-confirm",
  validateBody(replacementConfirmBodySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const profile = await getOrCreatePsychologistProfile(account.id);
    const documentId = param(req.params.documentId, "documentId");
    const body = req.body as { objectKey: string; contentType: string; byteSize: number };
    const doc = await confirmReplacement({
      psychologistProfileId: profile.id,
      documentId,
      accountId: account.id,
      objectKey: body.objectKey,
      contentType: body.contentType,
      byteSize: body.byteSize,
    });
    sendSuccess(res, 201, toDocumentMetaDto(doc));
  })
);

// --- Today / Brief / Live / After / Clients / Earnings (HR-approved only) ---

psychologistRouter.use(requireStaffRole(StaffRole.PSYCHOLOGIST));

psychologistRouter.get(
  "/me/dashboard",
  validateQuery(dashboardQuerySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const query = (req as typeof req & { validatedQuery: z.infer<typeof dashboardQuerySchema> }).validatedQuery;
    sendSuccess(res, 200, await getPsychologistDashboard(account.id, query.date ?? new Date()));
  })
);

psychologistRouter.get(
  "/me/bookings",
  validateQuery(bookingsDateQuerySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const query = (req as typeof req & { validatedQuery: z.infer<typeof bookingsDateQuerySchema> }).validatedQuery;
    sendSuccess(res, 200, await listPsychologistBookingsForDate(account.id, query.date));
  })
);

psychologistRouter.get(
  "/me/bookings/:bookingId/brief",
  validateParams(bookingIdParamSchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    sendSuccess(res, 200, await getBookingBrief(account.id, param(req.params.bookingId, "bookingId")));
  })
);

psychologistRouter.get(
  "/me/bookings/:bookingId/safety-flags",
  validateParams(bookingIdParamSchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    sendSuccess(res, 200, await getBookingSafetyFlags(account.id, param(req.params.bookingId, "bookingId")));
  })
);

psychologistRouter.get(
  "/me/sessions/:sessionId",
  validateParams(sessionIdParamSchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    sendSuccess(res, 200, await getPsychologistSession(account.id, param(req.params.sessionId, "sessionId")));
  })
);

psychologistRouter.post(
  "/me/sessions/:sessionId/join",
  validateParams(sessionIdParamSchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    sendSuccess(res, 200, await joinPsychologistSession(account.id, param(req.params.sessionId, "sessionId")));
  })
);

psychologistRouter.post(
  "/me/sessions/:sessionId/leave",
  validateParams(sessionIdParamSchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    sendSuccess(res, 200, await leavePsychologistSession(account.id, param(req.params.sessionId, "sessionId")));
  })
);

psychologistRouter.get(
  "/me/sessions/:sessionId/notes",
  validateParams(sessionIdParamSchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    sendSuccess(res, 200, await getSessionNotes(account.id, param(req.params.sessionId, "sessionId")));
  })
);

psychologistRouter.put(
  "/me/sessions/:sessionId/notes",
  validateParams(sessionIdParamSchema),
  validateBody(sessionNotesBodySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    sendSuccess(res, 200, await putSessionNotes(account.id, param(req.params.sessionId, "sessionId"), req.body));
  })
);

psychologistRouter.post(
  "/me/sessions/:sessionId/complete",
  validateParams(sessionIdParamSchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    sendSuccess(res, 200, await completePsychologistSession(account.id, param(req.params.sessionId, "sessionId")));
  })
);

psychologistRouter.get(
  "/me/sessions/:sessionId/after-session",
  validateParams(sessionIdParamSchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    sendSuccess(res, 200, await getAfterSession(account.id, param(req.params.sessionId, "sessionId")));
  })
);

psychologistRouter.put(
  "/me/sessions/:sessionId/after-session",
  validateParams(sessionIdParamSchema),
  validateBody(afterSessionBodySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    sendSuccess(res, 200, await putAfterSession(account.id, param(req.params.sessionId, "sessionId"), req.body));
  })
);

psychologistRouter.get(
  "/me/clients",
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    sendSuccess(res, 200, await listPsychologistClients(account.id));
  })
);

psychologistRouter.get(
  "/me/clients/:clientRef/brief",
  validateParams(clientRefParamSchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    sendSuccess(res, 200, await getClientBrief(account.id, param(req.params.clientRef, "clientRef")));
  })
);

psychologistRouter.get(
  "/me/clients/:clientRef/history",
  validateParams(clientRefParamSchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    sendSuccess(res, 200, await getClientHistory(account.id, param(req.params.clientRef, "clientRef")));
  })
);

psychologistRouter.get(
  "/me/earnings/summary",
  validateQuery(earningsMonthQuerySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const query = (req as typeof req & { validatedQuery: z.infer<typeof earningsMonthQuerySchema> }).validatedQuery;
    sendSuccess(res, 200, await getEarningsSummary(account.id, query.month));
  })
);

psychologistRouter.get(
  "/me/earnings/weekly",
  validateQuery(earningsMonthQuerySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const query = (req as typeof req & { validatedQuery: z.infer<typeof earningsMonthQuerySchema> }).validatedQuery;
    sendSuccess(res, 200, await getEarningsWeekly(account.id, query.month));
  })
);

psychologistRouter.get(
  "/me/payouts",
  validateQuery(payoutsListQuerySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const query = (req as typeof req & { validatedQuery: z.infer<typeof payoutsListQuerySchema> }).validatedQuery;
    sendSuccess(res, 200, await listPsychologistPayouts(account.id, query));
  })
);

psychologistRouter.get(
  "/me/payouts/:payoutId",
  validateParams(payoutIdParamSchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    sendSuccess(res, 200, await getPsychologistPayout(account.id, param(req.params.payoutId, "payoutId")));
  })
);
