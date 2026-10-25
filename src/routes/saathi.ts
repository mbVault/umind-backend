import { Router } from "express";
import type { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler";
import { sendSuccess } from "../lib/apiResponse";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { validateBody, validateParams, validateQuery } from "../middleware/validate";
import {
  createConversation,
  deleteConversation,
  getConversationWithMessages,
  listConversations,
  renameConversation,
} from "../modules/saathi/conversationService";
import { sendSaathiMessage } from "../modules/saathi/messageOrchestrator";
import { assertSaathiAccess } from "../modules/saathi/saathiAccess";
import {
  createSaathiConversationBodySchema,
  renameSaathiConversationBodySchema,
  saathiConversationIdParamSchema,
  saathiPaginationQuerySchema,
  sendSaathiMessageBodySchema,
} from "../validators/saathi";

export const saathiRouter = Router();

saathiRouter.use(authenticate);

saathiRouter.use(
  asyncHandler(async (req, _res, next) => {
    const { user } = (req as AuthenticatedRequest).auth;
    await assertSaathiAccess(user);
    next();
  }),
);

saathiRouter.post(
  "/conversations",
  validateBody(createSaathiConversationBodySchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const body = createSaathiConversationBodySchema.parse(req.body);
    const data = await createConversation(userId, body.title);
    sendSuccess(res, 201, data);
  }),
);

saathiRouter.get(
  "/conversations",
  validateQuery(saathiPaginationQuerySchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const query = (req as typeof req & { validatedQuery: z.infer<typeof saathiPaginationQuerySchema> })
      .validatedQuery;
    const data = await listConversations(userId, query);
    sendSuccess(res, 200, data);
  }),
);

saathiRouter.get(
  "/conversations/:id",
  validateParams(saathiConversationIdParamSchema),
  validateQuery(saathiPaginationQuerySchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const { id } = saathiConversationIdParamSchema.parse(req.params);
    const query = (req as typeof req & { validatedQuery: z.infer<typeof saathiPaginationQuerySchema> })
      .validatedQuery;
    const data = await getConversationWithMessages(userId, id, query);
    sendSuccess(res, 200, data);
  }),
);

saathiRouter.patch(
  "/conversations/:id",
  validateParams(saathiConversationIdParamSchema),
  validateBody(renameSaathiConversationBodySchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const { id } = saathiConversationIdParamSchema.parse(req.params);
    const body = renameSaathiConversationBodySchema.parse(req.body);
    const data = await renameConversation(userId, id, body.title);
    sendSuccess(res, 200, data);
  }),
);

saathiRouter.delete(
  "/conversations/:id",
  validateParams(saathiConversationIdParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).auth;
    const { id } = saathiConversationIdParamSchema.parse(req.params);
    const data = await deleteConversation(userId, id);
    sendSuccess(res, 200, data);
  }),
);

saathiRouter.post(
  "/conversations/:id/messages",
  validateParams(saathiConversationIdParamSchema),
  validateBody(sendSaathiMessageBodySchema),
  asyncHandler(async (req, res) => {
    const { user } = (req as AuthenticatedRequest).auth;
    const { id } = saathiConversationIdParamSchema.parse(req.params);
    const body = sendSaathiMessageBodySchema.parse(req.body);
    const idempotencyKey = req.header("idempotency-key")?.trim() || undefined;
    const data = await sendSaathiMessage({
      user,
      conversationId: id,
      content: body.content,
      diaryContext: body.diaryContext,
      clientLocalDate: req.header("x-client-local-date"),
      clientTimezone: req.header("x-client-timezone"),
      idempotencyKey,
    });
    sendSuccess(res, 201, data);
  }),
);
