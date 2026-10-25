import { Router } from "express";
import type { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler";
import { sendSuccess } from "../lib/apiResponse";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { validateBody, validateQuery } from "../middleware/validate";
import {
  getMoodHistory,
  getTodayMood,
  listMoods,
  upsertTodayMood,
} from "../modules/mood/moodService";
import {
  moodHistoryQuerySchema,
  moodTodayQuerySchema,
  putMoodTodayBodySchema,
} from "../validators/mood";

export const moodsRouter = Router();

moodsRouter.use(authenticate);

moodsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    sendSuccess(res, 200, await listMoods());
  }),
);

moodsRouter.get(
  "/today",
  validateQuery(moodTodayQuerySchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const query = (req as typeof req & { validatedQuery: z.infer<typeof moodTodayQuerySchema> }).validatedQuery;
    sendSuccess(res, 200, await getTodayMood(userId, query.date));
  }),
);

moodsRouter.put(
  "/today",
  validateBody(putMoodTodayBodySchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const body = putMoodTodayBodySchema.parse(req.body);
    sendSuccess(res, 200, await upsertTodayMood(userId, body.date, body.moodId));
  }),
);

moodsRouter.get(
  "/history",
  validateQuery(moodHistoryQuerySchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const query = (req as typeof req & { validatedQuery: z.infer<typeof moodHistoryQuerySchema> }).validatedQuery;
    sendSuccess(res, 200, await getMoodHistory(userId, query.from, query.to));
  }),
);
