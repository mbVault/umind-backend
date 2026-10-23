import { Router } from "express";
import { PsychologistDocumentKind, StaffRole } from "@prisma/client";
import { asyncHandler } from "../../lib/asyncHandler";
import { sendSuccess } from "../../lib/apiResponse";
import { param } from "../../lib/routeParams";
import {
  requireStaffAccount,
  requireStaffRole,
  StaffAuthenticatedRequest,
} from "../../middleware/staffAuth";
import { validateBody } from "../../middleware/validate";
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
  getOrCreatePsychologistProfile,
  submitPsychologistApplication,
  updatePsychologistPublicProfile,
  upsertApplicationDraft,
} from "../../modules/staff/psychologistService";
import {
  applicationBodySchema,
  confirmUploadBodySchema,
  profilePatchSchema,
  replacementConfirmBodySchema,
  replacementUploadBodySchema,
  uploadUrlBodySchema,
} from "../../validators/staff";

export const psychologistRouter = Router();

psychologistRouter.use(requireStaffAccount, requireStaffRole(StaffRole.PSYCHOLOGIST));

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

psychologistRouter.post(
  "/me/application/submit",
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
