import { Router } from "express";
import type { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler";
import { sendSuccess } from "../lib/apiResponse";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { validateBody, validateParams, validateQuery } from "../middleware/validate";
import {
  deleteDiaryEntry,
  getDiaryEntry,
  getDiaryStreak,
  listDiaryEntries,
  upsertDiaryEntry,
} from "../modules/diary/diaryService";
import {
  diaryEntryDateParamSchema,
  diaryRangeQuerySchema,
  putDiaryEntryBodySchema,
} from "../validators/diary";

export const diaryRouter = Router();

diaryRouter.use(authenticate);

diaryRouter.get(
  "/streak",
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    sendSuccess(res, 200, await getDiaryStreak(userId));
  }),
);

diaryRouter.get(
  "/",
  validateQuery(diaryRangeQuerySchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const query = (req as typeof req & { validatedQuery: z.infer<typeof diaryRangeQuerySchema> }).validatedQuery;
    sendSuccess(res, 200, await listDiaryEntries(userId, query.from, query.to));
  }),
);

diaryRouter.get(
  "/:entryDate",
  validateParams(diaryEntryDateParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const { entryDate } = diaryEntryDateParamSchema.parse(req.params);
    sendSuccess(res, 200, await getDiaryEntry(userId, entryDate));
  }),
);

diaryRouter.put(
  "/:entryDate",
  validateParams(diaryEntryDateParamSchema),
  validateBody(putDiaryEntryBodySchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const { entryDate } = diaryEntryDateParamSchema.parse(req.params);
    const body = putDiaryEntryBodySchema.parse(req.body);
    sendSuccess(res, 200, await upsertDiaryEntry(userId, entryDate, body));
  }),
);

diaryRouter.delete(
  "/:entryDate",
  validateParams(diaryEntryDateParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const { entryDate } = diaryEntryDateParamSchema.parse(req.params);
    sendSuccess(res, 200, await deleteDiaryEntry(userId, entryDate));
  }),
);
