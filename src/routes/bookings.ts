import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { sendSuccess } from "../lib/apiResponse";
import { fail } from "../lib/errors";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { validateBody, validateParams } from "../middleware/validate";
import {
  cancelBookingByCustomer,
  rescheduleBookingByCustomer,
} from "../modules/bookings/bookingLifecycleService";
import {
  createBookingFromSlot,
  getBookingForUser,
  listBookingsForUser,
  startBookingCheckout,
} from "../modules/bookings/bookingService";
import {
  bookingIdParamSchema,
  cancelBookingBodySchema,
  createBookingBodySchema,
  rescheduleBookingBodySchema,
} from "../validators/bookings";

export const bookingsRouter = Router();

bookingsRouter.use(authenticate);

bookingsRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const data = await listBookingsForUser(userId);
    sendSuccess(res, 200, data);
  }),
);

bookingsRouter.post(
  "/",
  validateBody(createBookingBodySchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const body = createBookingBodySchema.parse(req.body);
    const data = await createBookingFromSlot({ userId, ...body });
    sendSuccess(res, 201, data);
  }),
);

bookingsRouter.get(
  "/:bookingId",
  validateParams(bookingIdParamSchema),
  asyncHandler(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const { userId } = (req as AuthenticatedRequest).auth;
    const data = await getBookingForUser(userId, bookingId);
    sendSuccess(res, 200, data);
  }),
);

bookingsRouter.post(
  "/:bookingId/cancel",
  validateParams(bookingIdParamSchema),
  validateBody(cancelBookingBodySchema),
  asyncHandler(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const { userId } = (req as AuthenticatedRequest).auth;
    const { reason } = cancelBookingBodySchema.parse(req.body);
    const data = await cancelBookingByCustomer({ userId, bookingId, reason });
    sendSuccess(res, 200, data);
  }),
);

bookingsRouter.post(
  "/:bookingId/reschedule",
  validateParams(bookingIdParamSchema),
  validateBody(rescheduleBookingBodySchema),
  asyncHandler(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const { userId } = (req as AuthenticatedRequest).auth;
    const { slotId } = rescheduleBookingBodySchema.parse(req.body);
    const data = await rescheduleBookingByCustomer({ userId, bookingId, slotId });
    sendSuccess(res, 200, data);
  }),
);

bookingsRouter.post(
  "/:bookingId/checkout",
  validateParams(bookingIdParamSchema),
  asyncHandler(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const { userId } = (req as AuthenticatedRequest).auth;
    const idempotencyKey = req.header("idempotency-key")?.trim() || undefined;
    if (idempotencyKey && idempotencyKey.length > 64) {
      fail(400, "Idempotency-Key must be at most 64 characters");
    }
    const data = await startBookingCheckout({ userId, bookingId, idempotencyKey });
    sendSuccess(res, 201, data);
  }),
);
