import { Router } from "express";
import { AdminRoleCode, StaffRole } from "@prisma/client";
import { asyncHandler } from "../../lib/asyncHandler";
import { sendSuccess } from "../../lib/apiResponse";
import { prisma } from "../../lib/prisma";
import { param } from "../../lib/routeParams";
import { invitationRateLimiter } from "../../middleware/rateLimit";
import {
  requireAdminPermission,
  requireStaffAccount,
  requireStaffRole,
  StaffAuthenticatedRequest,
} from "../../middleware/staffAuth";
import { validateBody, validateQuery } from "../../middleware/validate";
import {
  createAdminInvitation,
  revokeAdminMembership,
  updateMembershipRoles,
} from "../../modules/staff/invitationService";
import {
  auditLogQuerySchema,
  invitationBodySchema,
  membershipRolesBodySchema,
} from "../../validators/staff";

export const adminMembersRouter = Router();

adminMembersRouter.use(requireStaffAccount, requireStaffRole(StaffRole.ADMIN));

adminMembersRouter.get(
  "/members",
  requireAdminPermission("admin_memberships.manage"),
  asyncHandler(async (_req, res) => {
    const members = await prisma.adminMembership.findMany({
      include: {
        account: { select: { id: true, email: true, status: true } },
        roles: { include: { role: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, 200, {
      members: members.map((m) => ({
        id: m.id,
        status: m.status,
        revokedAt: m.revokedAt?.toISOString() ?? null,
        account: m.account,
        roles: m.roles.map((r) => r.role.code),
      })),
    });
  })
);

adminMembersRouter.post(
  "/members/invitations",
  invitationRateLimiter,
  requireAdminPermission("admin_memberships.manage"),
  validateBody(invitationBodySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const body = req.body as { email: string; roleCodes: AdminRoleCode[] };
    const inviterRoleCodes = (account.adminMembership?.roles ?? []).map(
      (r) => r.role.code as AdminRoleCode
    );
    const result = await createAdminInvitation({
      email: body.email,
      roleCodes: body.roleCodes,
      invitedByAccountId: account.id,
      inviterPermissionCodes: account.permissionCodes,
      inviterRoleCodes,
    });
    sendSuccess(res, 201, {
      invitationId: result.invitation.id,
      email: result.invitation.email,
      roleCodes: result.invitation.roleCodes,
      expiresAt: result.invitation.expiresAt.toISOString(),
      token: result.rawToken,
    });
  })
);

adminMembersRouter.patch(
  "/members/:membershipId/roles",
  requireAdminPermission("admin_memberships.manage"),
  validateBody(membershipRolesBodySchema),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const body = req.body as { roleCodes: AdminRoleCode[] };
    const inviterRoleCodes = (account.adminMembership?.roles ?? []).map(
      (r) => r.role.code as AdminRoleCode
    );
    const updated = await updateMembershipRoles({
      membershipId: param(req.params.membershipId, "membershipId"),
      roleCodes: body.roleCodes,
      actorAccountId: account.id,
      actorPermissionCodes: account.permissionCodes,
      actorRoleCodes: inviterRoleCodes,
    });
    sendSuccess(res, 200, {
      id: updated.id,
      roles: updated.roles.map((r) => r.role.code),
    });
  })
);

adminMembersRouter.post(
  "/members/:membershipId/revoke",
  requireAdminPermission("admin_memberships.manage"),
  asyncHandler(async (req, res) => {
    const { account } = (req as StaffAuthenticatedRequest).staff;
    const updated = await revokeAdminMembership({
      membershipId: param(req.params.membershipId, "membershipId"),
      actorAccountId: account.id,
    });
    sendSuccess(res, 200, {
      id: updated.id,
      status: updated.status,
      revokedAt: updated.revokedAt?.toISOString() ?? null,
    });
  })
);

adminMembersRouter.get(
  "/audit-logs",
  requireAdminPermission("audit_logs.read"),
  validateQuery(auditLogQuerySchema),
  asyncHandler(async (req, res) => {
    const query = (
      req as typeof req & {
        validatedQuery: { page: number; pageSize: number; action?: string };
      }
    ).validatedQuery;
    const where = query.action ? { action: query.action } : {};
    const [total, rows] = await Promise.all([
      prisma.adminAuditLog.count({ where }),
      prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    sendSuccess(res, 200, {
      page: query.page,
      pageSize: query.pageSize,
      total,
      items: rows.map((r) => ({
        id: r.id,
        actorAccountId: r.actorAccountId,
        actorType: r.actorType,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  })
);
