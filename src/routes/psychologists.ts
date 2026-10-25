import { Router } from "express";
import type { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler";
import { sendSuccess } from "../lib/apiResponse";
import { authenticate } from "../middleware/authenticate";
import { validateParams, validateQuery } from "../middleware/validate";
import { listOpenAvailabilityForPsychologist } from "../modules/bookings/availabilityService";
import { getBookablePsychologistById, listBookablePsychologists } from "../modules/discovery/discoveryService";
import { availabilityQuerySchema } from "../validators/bookings";
import { psychologistDirectoryQuerySchema, psychologistIdParamSchema } from "../validators/discovery";

export const psychologistsRouter = Router();

psychologistsRouter.use(authenticate);

psychologistsRouter.get(
  "/",
  validateQuery(psychologistDirectoryQuerySchema),
  asyncHandler(async (req, res) => {
    const query = (req as typeof req & { validatedQuery: z.infer<typeof psychologistDirectoryQuerySchema> })
      .validatedQuery;
    const result = await listBookablePsychologists(query);
    sendSuccess(res, 200, result);
  })
);

psychologistsRouter.get(
  "/:id/availability",
  validateParams(psychologistIdParamSchema),
  validateQuery(availabilityQuerySchema),
  asyncHandler(async (req, res) => {
    const { id } = psychologistIdParamSchema.parse(req.params);
    const query = (req as typeof req & { validatedQuery: z.infer<typeof availabilityQuerySchema> }).validatedQuery;
    const data = await listOpenAvailabilityForPsychologist({
      psychologistProfileId: id,
      from: new Date(query.from),
      to: new Date(query.to),
    });
    sendSuccess(res, 200, data);
  }),
);

psychologistsRouter.get(
  "/:id",
  validateParams(psychologistIdParamSchema),
  asyncHandler(async (req, res) => {
    const { id } = psychologistIdParamSchema.parse(req.params);
    const profile = await getBookablePsychologistById(id);
    sendSuccess(res, 200, profile);
  })
);
