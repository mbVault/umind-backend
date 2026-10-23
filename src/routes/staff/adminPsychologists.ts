import { Router } from "express";
import { Prisma, StaffRole } from "@prisma/client";
import { asyncHandler } from "../../lib/asyncHandler";
import { sendSuccess } from "../../lib/apiResponse";
import { fail } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { param } from "../../lib/routeParams";
import {
  requireAdminPermission,
  requireStaffAccount,
  requireStaffRole,
  StaffAuthenticatedRequest,
} from "../../middleware/staffAuth";
import { validateBody, validateQuery } from "../../middleware/validate";
import {
  createDocumentViewUrl,
  listPsychologistDocuments,
  toDocumentMetaDto,
} from "../../modules/staff/documentService";
import { toPsychologistProfileDto } from "../../modules/staff/dtos";
import {
  decideVerificationCheck,
  publishPsychologist,
  reactivatePsychologist,
  startVerificationCheck,
  suspendPsychologist,
} from "../../modules/staff/psychologistService";
import {
  checkDecisionBodySchema,
  psychologistListQuerySchema,
  suspendBodySchema,
} from "../../validators/staff";

export const adminPsychologistsRouter = Router();

adminPsychologistsRouter.use(
  requireStaffAccount,
  requireStaffRole(StaffRole.ADMIN),
  requireAdminPermission("psychologist.read")
);

adminPsychologistsRouter.get(
  "/",
  validateQuery(psychologistListQuerySchema),
  asyncHandler(async (req, res) => {
    const query = (req as typeof req & { validatedQuery: {
      page: number;
      pageSize: number;
      publicationStatus?: string;
      search?: string;
    } }).validatedQuery;

    const where: Prisma.PsychologistProfileWhereInput = {};
    if (query.publicationStatus) {
      where.publicationStatus = query.publicationStatus as never;
    }
    if (query.search) {
      where.OR = [
        { legalFullName: { contains: query.search, mode: "insensitive" } },
        { displayName: { contains: query.search, mode: "insensitive" } },
        { rciRegistrationNumber: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.psychologistProfile.count({ where }),
      prisma.psychologistProfile.findMany({
        where,
        include: { specialisations: true, languages: true, checks: true },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    sendSuccess(res, 200, {
      page: query.page,
      pageSize: query.pageSize,
      total,
      items: rows.map(toPsychologistProfileDto),
    });
  })
);

adminPsychologistsRouter.get(
  "/:psychologistId",
  asyncHandler(async (req, res) => {
    const profile = await prisma.psychologistProfile.findUnique({
      where: { id: param(req.params.psychologistId, "psychologistId") },
      include: { specialisations: true, languages: true, checks: true },
    });
    if (!profile) fail(404, "Psychologist not found");
    sendSuccess(res, 200, toPsychologistProfileDto(profile));
  })
);

adminPsychologistsRouter.get(
  "/:psychologistId/documents",
  requireAdminPermission("verification_documents.read"),
  asyncHandler(async (req, res) => {
    const profile = await prisma.psychologistProfile.findUnique({
      where: { id: param(req.params.psychologistId, "psychologistId") },
    });
    if (!profile) fail(404, "Psychologist not found");
    const docs = await listPsychologistDocuments(profile.id);
    sendSuccess(res, 200, { documents: docs.map(toDocumentMetaDto) });
  })
);

adminPsychologistsRouter.post(
  "/:psychologistId/documents/:documentId/view-url",
  requireAdminPermission("verification_documents.read"),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const result = await createDocumentViewUrl({
      psychologistId: param(req.params.psychologistId, "psychologistId"),
      documentId: param(req.params.documentId, "documentId"),
      actorAccountId: account.id,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    sendSuccess(res, 200, {
      viewUrl: result.url,
      expiresAt: result.expiresAt.toISOString(),
    });
  })
);

adminPsychologistsRouter.get(
  "/:psychologistId/verification-checks",
  requireAdminPermission("psychologist.verify"),
  asyncHandler(async (req, res) => {
    const checks = await prisma.psychologistVerificationCheck.findMany({
      where: { psychologistProfileId: param(req.params.psychologistId, "psychologistId") },
      orderBy: { type: "asc" },
    });
    sendSuccess(res, 200, {
      checks: checks.map((c) => ({
        id: c.id,
        type: c.type,
        status: c.status,
        reason: c.reason,
        reviewedAt: c.reviewedAt?.toISOString() ?? null,
      })),
    });
  })
);

adminPsychologistsRouter.post(
  "/:psychologistId/verification-checks/:checkId/start",
  requireAdminPermission("psychologist.verify"),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const check = await startVerificationCheck(
      param(req.params.psychologistId, "psychologistId"),
      param(req.params.checkId, "checkId"),
      account.id
    );
    sendSuccess(res, 200, {
      id: check.id,
      type: check.type,
      status: check.status,
    });
  })
);

adminPsychologistsRouter.post(
  "/:psychologistId/verification-checks/:checkId/decision",
  requireAdminPermission("psychologist.verify"),
  validateBody(checkDecisionBodySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const body = req.body as { decision: "VERIFIED" | "NEEDS_ATTENTION"; reason?: string };
    const check = await decideVerificationCheck(
      param(req.params.psychologistId, "psychologistId"),
      param(req.params.checkId, "checkId"),
      account.id,
      body.decision,
      body.reason
    );
    sendSuccess(res, 200, {
      id: check.id,
      type: check.type,
      status: check.status,
      reason: check.reason,
    });
  })
);

adminPsychologistsRouter.post(
  "/:psychologistId/publish",
  requireAdminPermission("psychologist.publish"),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const profile = await publishPsychologist(param(req.params.psychologistId, "psychologistId"), account.id);
    sendSuccess(res, 200, toPsychologistProfileDto(profile));
  })
);

adminPsychologistsRouter.post(
  "/:psychologistId/suspend",
  requireAdminPermission("psychologist.suspend"),
  validateBody(suspendBodySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const profile = await suspendPsychologist(
      param(req.params.psychologistId, "psychologistId"),
      account.id,
      (req.body as { reason: string }).reason
    );
    sendSuccess(res, 200, toPsychologistProfileDto(profile));
  })
);

adminPsychologistsRouter.post(
  "/:psychologistId/reactivate",
  requireAdminPermission("psychologist.suspend"),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const profile = await reactivatePsychologist(param(req.params.psychologistId, "psychologistId"), account.id);
    sendSuccess(res, 200, toPsychologistProfileDto(profile));
  })
);
