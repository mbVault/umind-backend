import {
  Account,
  AccountRole,
  AccountStatus,
  AdminMembership,
  AdminMembershipStatus,
  StaffRole,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";

export type StaffAccountContext = Account & {
  roles: AccountRole[];
  adminMembership:
    | (AdminMembership & {
        roles: { role: { code: string; id: string }; }[];
      })
    | null;
  psychologistProfile: { id: string } | null;
  permissionCodes: string[];
};

export const loadStaffAccountBySuperTokensUserId = async (
  superTokensUserId: string
): Promise<StaffAccountContext> => {
  const account = await prisma.account.findUnique({
    where: { superTokensUserId },
    include: {
      roles: true,
      psychologistProfile: { select: { id: true } },
      adminMembership: {
        include: {
          roles: {
            include: {
              role: {
                include: {
                  permissions: { include: { permission: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!account || account.deletedAt || account.status === AccountStatus.DELETED) {
    fail(403, "Staff account is not provisioned");
  }
  if (account.status === AccountStatus.DISABLED) {
    fail(403, "Staff account is disabled");
  }

  const permissionCodes = new Set<string>();
  if (
    account.adminMembership &&
    account.adminMembership.status === AdminMembershipStatus.ACTIVE &&
    !account.adminMembership.revokedAt
  ) {
    for (const link of account.adminMembership.roles) {
      for (const rp of link.role.permissions) {
        permissionCodes.add(rp.permission.code);
      }
    }
  }

  return {
    ...account,
    permissionCodes: [...permissionCodes],
  };
};

export const accountHasRole = (account: StaffAccountContext, role: StaffRole): boolean => {
  return account.roles.some((r) => r.role === role);
};

export const assertActiveAdminMembership = (account: StaffAccountContext): void => {
  if (!accountHasRole(account, StaffRole.ADMIN)) {
    fail(403, "Admin role required");
  }
  const membership = account.adminMembership;
  if (!membership || membership.revokedAt || membership.status !== AdminMembershipStatus.ACTIVE) {
    fail(403, "Active admin membership required");
  }
};

export const assertAdminPermission = (account: StaffAccountContext, permission: string): void => {
  assertActiveAdminMembership(account);
  if (!account.permissionCodes.includes(permission)) {
    fail(403, "Insufficient permissions");
  }
};
