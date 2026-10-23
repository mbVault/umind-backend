import {
  AccountStatus,
  AdminInvitationStatus,
  AdminMembershipStatus,
  AdminRoleCode,
  StaffRole,
} from "@prisma/client";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env";
import { fail } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "./auditService";
import { ROLE_PERMISSION_MAP } from "./permissions";

const hashToken = (rawToken: string): string => {
  return createHash("sha256").update(`${env.INVITATION_TOKEN_PEPPER}:${rawToken}`).digest("hex");
};

const tokensEqual = (a: string, b: string): boolean => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
};

const permissionsForRoles = (roles: AdminRoleCode[]): Set<string> => {
  const set = new Set<string>();
  for (const role of roles) {
    for (const p of ROLE_PERMISSION_MAP[role]) set.add(p);
  }
  return set;
};

/** Inviter may only assign roles whose permissions are a subset of their own (except Founder who can assign any). */
export const assertInviterMayGrantRoles = (
  inviterPermissionCodes: string[],
  inviterRoleCodes: AdminRoleCode[],
  requestedRoles: AdminRoleCode[]
): void => {
  if (requestedRoles.includes(AdminRoleCode.FOUNDER_SUPER_ADMIN)) {
    if (!inviterRoleCodes.includes(AdminRoleCode.FOUNDER_SUPER_ADMIN)) {
      fail(403, "Cannot grant founder privileges");
    }
  }

  const inviterPerms = new Set(inviterPermissionCodes);
  const requestedPerms = permissionsForRoles(requestedRoles);
  for (const p of requestedPerms) {
    if (!inviterPerms.has(p)) {
      fail(403, "Cannot grant roles beyond inviter authority");
    }
  }
};

export const createAdminInvitation = async (input: {
  email: string;
  roleCodes: AdminRoleCode[];
  invitedByAccountId: string;
  inviterPermissionCodes: string[];
  inviterRoleCodes: AdminRoleCode[];
}) => {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) {
    fail(400, "Validation failed", { email: ["Invalid email"] });
  }
  if (!input.roleCodes.length) {
    fail(400, "Validation failed", { roleCodes: ["At least one role required"] });
  }

  assertInviterMayGrantRoles(input.inviterPermissionCodes, input.inviterRoleCodes, input.roleCodes);

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + env.INVITATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  const invitation = await prisma.adminInvitation.create({
    data: {
      email,
      tokenHash,
      invitedByAccountId: input.invitedByAccountId,
      roleCodes: input.roleCodes,
      expiresAt,
      status: AdminInvitationStatus.PENDING,
    },
  });

  await writeAuditLog({
    actorAccountId: input.invitedByAccountId,
    action: "ADMIN_INVITATION_CREATED",
    targetType: "AdminInvitation",
    targetId: invitation.id,
    metadata: { email, roleCodes: input.roleCodes },
  });

  // Raw token returned once — never stored.
  return { invitation, rawToken };
};

export const acceptAdminInvitation = async (input: {
  rawToken: string;
  acceptorSuperTokensUserId: string;
  acceptorEmail?: string | null;
}) => {
  const tokenHash = hashToken(input.rawToken);

  return prisma.$transaction(async (tx) => {
    const invitation = await tx.adminInvitation.findUnique({ where: { tokenHash } });
    if (!invitation) fail(404, "Invitation not found");
    if (invitation.status === AdminInvitationStatus.REVOKED) fail(409, "Invitation has been revoked");
    if (invitation.status === AdminInvitationStatus.ACCEPTED) fail(409, "Invitation already accepted");
    if (invitation.expiresAt.getTime() <= Date.now() || invitation.status === AdminInvitationStatus.EXPIRED) {
      await tx.adminInvitation.update({
        where: { id: invitation.id },
        data: { status: AdminInvitationStatus.EXPIRED },
      });
      fail(409, "Invitation has expired");
    }
    if (!tokensEqual(invitation.tokenHash, tokenHash)) {
      fail(404, "Invitation not found");
    }

    if (input.acceptorEmail) {
      const normalized = input.acceptorEmail.trim().toLowerCase();
      if (normalized !== invitation.email) {
        fail(403, "Invitation email does not match authenticated user");
      }
    }

    // Re-check inviter still has authority at acceptance time.
    const inviter = await tx.account.findUnique({
      where: { id: invitation.invitedByAccountId },
      include: {
        roles: true,
        adminMembership: {
          include: {
            roles: {
              include: {
                role: { include: { permissions: { include: { permission: true } } } },
              },
            },
          },
        },
      },
    });
    if (!inviter || inviter.status !== AccountStatus.ACTIVE) {
      fail(403, "Inviter is no longer active");
    }
    const inviterRoleCodes = (inviter.adminMembership?.roles ?? []).map((r) => r.role.code);
    const inviterPerms = new Set<string>();
    for (const link of inviter.adminMembership?.roles ?? []) {
      for (const rp of link.role.permissions) inviterPerms.add(rp.permission.code);
    }
    assertInviterMayGrantRoles([...inviterPerms], inviterRoleCodes, invitation.roleCodes);

    let account = await tx.account.findUnique({
      where: { superTokensUserId: input.acceptorSuperTokensUserId },
    });
    if (!account) {
      account = await tx.account.create({
        data: {
          superTokensUserId: input.acceptorSuperTokensUserId,
          email: invitation.email,
          status: AccountStatus.ACTIVE,
        },
      });
    } else if (account.status !== AccountStatus.ACTIVE) {
      fail(403, "Account is not active");
    } else if (!account.email) {
      account = await tx.account.update({
        where: { id: account.id },
        data: { email: invitation.email },
      });
    }

    await tx.accountRole.upsert({
      where: { accountId_role: { accountId: account.id, role: StaffRole.ADMIN } },
      create: { accountId: account.id, role: StaffRole.ADMIN },
      update: {},
    });

    let membership = await tx.adminMembership.findUnique({ where: { accountId: account.id } });
    if (membership?.status === AdminMembershipStatus.REVOKED || membership?.revokedAt) {
      membership = await tx.adminMembership.update({
        where: { id: membership.id },
        data: {
          status: AdminMembershipStatus.ACTIVE,
          revokedAt: null,
          invitedByAccountId: invitation.invitedByAccountId,
        },
      });
    } else if (!membership) {
      membership = await tx.adminMembership.create({
        data: {
          accountId: account.id,
          status: AdminMembershipStatus.ACTIVE,
          invitedByAccountId: invitation.invitedByAccountId,
        },
      });
    }

    const adminRoles = await tx.adminRole.findMany({
      where: { code: { in: invitation.roleCodes } },
    });
    if (adminRoles.length !== invitation.roleCodes.length) {
      fail(500, "Admin role catalog is incomplete; run the RBAC seed");
    }

    for (const role of adminRoles) {
      await tx.adminMembershipRole.upsert({
        where: {
          adminMembershipId_adminRoleId: {
            adminMembershipId: membership.id,
            adminRoleId: role.id,
          },
        },
        create: {
          adminMembershipId: membership.id,
          adminRoleId: role.id,
          assignedByAccountId: invitation.invitedByAccountId,
        },
        update: {},
      });
    }

    await tx.adminInvitation.update({
      where: { id: invitation.id },
      data: {
        status: AdminInvitationStatus.ACCEPTED,
        acceptedAt: new Date(),
        acceptedByAccountId: account.id,
        resultingMembershipId: membership.id,
        // Invalidate token by rotating hash to a dead value (single-use).
        tokenHash: hashToken(`used:${invitation.id}:${randomBytes(16).toString("hex")}`),
      },
    });

    await writeAuditLog({
      tx,
      actorAccountId: account.id,
      action: "ADMIN_INVITATION_ACCEPTED",
      targetType: "AdminInvitation",
      targetId: invitation.id,
      metadata: { roleCodes: invitation.roleCodes, membershipId: membership.id },
    });

    return { accountId: account.id, membershipId: membership.id, roleCodes: invitation.roleCodes };
  });
};

export const revokeAdminMembership = async (input: {
  membershipId: string;
  actorAccountId: string;
}) => {
  const membership = await prisma.adminMembership.findUnique({ where: { id: input.membershipId } });
  if (!membership) fail(404, "Membership not found");

  const updated = await prisma.adminMembership.update({
    where: { id: membership.id },
    data: {
      status: AdminMembershipStatus.REVOKED,
      revokedAt: new Date(),
    },
  });

  await writeAuditLog({
    actorAccountId: input.actorAccountId,
    action: "ADMIN_MEMBERSHIP_REVOKED",
    targetType: "AdminMembership",
    targetId: membership.id,
  });

  return updated;
};

export const updateMembershipRoles = async (input: {
  membershipId: string;
  roleCodes: AdminRoleCode[];
  actorAccountId: string;
  actorPermissionCodes: string[];
  actorRoleCodes: AdminRoleCode[];
}) => {
  assertInviterMayGrantRoles(input.actorPermissionCodes, input.actorRoleCodes, input.roleCodes);

  const membership = await prisma.adminMembership.findUnique({
    where: { id: input.membershipId },
    include: { roles: { include: { role: true } } },
  });
  if (!membership || membership.status !== AdminMembershipStatus.ACTIVE) {
    fail(404, "Active membership not found");
  }

  return prisma.$transaction(async (tx) => {
    await tx.adminMembershipRole.deleteMany({ where: { adminMembershipId: membership.id } });
    const roles = await tx.adminRole.findMany({ where: { code: { in: input.roleCodes } } });
    for (const role of roles) {
      await tx.adminMembershipRole.create({
        data: {
          adminMembershipId: membership.id,
          adminRoleId: role.id,
          assignedByAccountId: input.actorAccountId,
        },
      });
    }

    await writeAuditLog({
      tx,
      actorAccountId: input.actorAccountId,
      action: "ADMIN_MEMBERSHIP_UPDATED",
      targetType: "AdminMembership",
      targetId: membership.id,
      metadata: { roleCodes: input.roleCodes },
    });

    return tx.adminMembership.findUniqueOrThrow({
      where: { id: membership.id },
      include: { roles: { include: { role: true } } },
    });
  });
};
