import { Router } from "express";
import type { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler";
import { sendSuccess } from "../lib/apiResponse";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { validateBody, validateParams, validateQuery } from "../middleware/validate";
import { createPlaybackUrl, getPublishedTrack, listPublishedAudio } from "../modules/audio/audioQuery";
import {
  audioListQuerySchema,
  audioPlaybackBodySchema,
  audioTrackIdParamSchema,
} from "../validators/audio";

export const audioRouter = Router();

audioRouter.use(authenticate);

audioRouter.get(
  "/",
  validateQuery(audioListQuerySchema),
  asyncHandler(async (req, res) => {
    const { user } = (req as AuthenticatedRequest).auth;
    const query = (req as typeof req & { validatedQuery: z.infer<typeof audioListQuerySchema> }).validatedQuery;
    sendSuccess(res, 200, await listPublishedAudio(user, query));
  }),
);

audioRouter.get(
  "/:trackId",
  validateParams(audioTrackIdParamSchema),
  asyncHandler(async (req, res) => {
    const { user } = (req as AuthenticatedRequest).auth;
    const { trackId } = audioTrackIdParamSchema.parse(req.params);
    sendSuccess(res, 200, await getPublishedTrack(user, trackId));
  }),
);

audioRouter.post(
  "/:trackId/playback",
  validateParams(audioTrackIdParamSchema),
  validateBody(audioPlaybackBodySchema),
  asyncHandler(async (req, res) => {
    const { user } = (req as AuthenticatedRequest).auth;
    const { trackId } = audioTrackIdParamSchema.parse(req.params);
    const body = audioPlaybackBodySchema.parse(req.body);
    sendSuccess(res, 200, await createPlaybackUrl(user, trackId, body.language));
  }),
);
