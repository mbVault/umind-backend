import { Router } from "express";
import { StaffRole } from "@prisma/client";
import { asyncHandler } from "../../lib/asyncHandler";
import { sendSuccess } from "../../lib/apiResponse";
import {
  requireAdminPermission,
  requireStaffAccount,
  requireStaffRole,
} from "../../middleware/staffAuth";
import { validateBody, validateParams } from "../../middleware/validate";
import {
  adminConfirmVersion,
  adminCreateTrack,
  adminCreateVersionUploadUrl,
  adminDeleteTrack,
  adminDeleteVersion,
  adminGetTrack,
  adminListTracks,
  adminPatchTrack,
} from "../../modules/audio/adminAudioService";
import {
  adminConfirmVersionBodySchema,
  adminCreateAudioBodySchema,
  adminCreateVersionBodySchema,
  adminPatchAudioBodySchema,
  adminVersionIdParamSchema,
  audioTrackIdParamSchema,
} from "../../validators/audio";

export const adminAudioRouter = Router();

adminAudioRouter.use(requireStaffAccount, requireStaffRole(StaffRole.ADMIN));

adminAudioRouter.get(
  "/",
  requireAdminPermission("audio.read"),
  asyncHandler(async (_req, res) => {
    sendSuccess(res, 200, await adminListTracks());
  }),
);

adminAudioRouter.post(
  "/",
  requireAdminPermission("audio.manage"),
  validateBody(adminCreateAudioBodySchema),
  asyncHandler(async (req, res) => {
    const body = adminCreateAudioBodySchema.parse(req.body);
    sendSuccess(res, 201, await adminCreateTrack(body));
  }),
);

adminAudioRouter.get(
  "/:trackId",
  requireAdminPermission("audio.read"),
  validateParams(audioTrackIdParamSchema),
  asyncHandler(async (req, res) => {
    const { trackId } = audioTrackIdParamSchema.parse(req.params);
    sendSuccess(res, 200, await adminGetTrack(trackId));
  }),
);

adminAudioRouter.patch(
  "/:trackId",
  requireAdminPermission("audio.manage"),
  validateParams(audioTrackIdParamSchema),
  validateBody(adminPatchAudioBodySchema),
  asyncHandler(async (req, res) => {
    const { trackId } = audioTrackIdParamSchema.parse(req.params);
    const body = adminPatchAudioBodySchema.parse(req.body);
    sendSuccess(res, 200, await adminPatchTrack(trackId, body));
  }),
);

adminAudioRouter.delete(
  "/:trackId",
  requireAdminPermission("audio.manage"),
  validateParams(audioTrackIdParamSchema),
  asyncHandler(async (req, res) => {
    const { trackId } = audioTrackIdParamSchema.parse(req.params);
    sendSuccess(res, 200, await adminDeleteTrack(trackId));
  }),
);

adminAudioRouter.post(
  "/:trackId/versions/upload-url",
  requireAdminPermission("audio.manage"),
  validateParams(audioTrackIdParamSchema),
  validateBody(adminCreateVersionBodySchema),
  asyncHandler(async (req, res) => {
    const { trackId } = audioTrackIdParamSchema.parse(req.params);
    const body = adminCreateVersionBodySchema.parse(req.body);
    sendSuccess(res, 200, await adminCreateVersionUploadUrl({ trackId, ...body }));
  }),
);

adminAudioRouter.post(
  "/:trackId/versions/confirm",
  requireAdminPermission("audio.manage"),
  validateParams(audioTrackIdParamSchema),
  validateBody(adminConfirmVersionBodySchema),
  asyncHandler(async (req, res) => {
    const { trackId } = audioTrackIdParamSchema.parse(req.params);
    const body = adminConfirmVersionBodySchema.parse(req.body);
    sendSuccess(res, 201, await adminConfirmVersion({ trackId, ...body }));
  }),
);

adminAudioRouter.delete(
  "/:trackId/versions/:versionId",
  requireAdminPermission("audio.manage"),
  validateParams(adminVersionIdParamSchema),
  asyncHandler(async (req, res) => {
    const { trackId, versionId } = adminVersionIdParamSchema.parse(req.params);
    sendSuccess(res, 200, await adminDeleteVersion(trackId, versionId));
  }),
);
