import {
  AccountStatus,
  AdminMembershipStatus,
  AdminRoleCode,
  StaffRole,
} from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { ROLE_PERMISSION_MAP, ADMIN_PERMISSIONS, ADMIN_ROLE_NAMES } from "../src/modules/staff/permissions";

export const resetStaffTables = async (): Promise<void> => {
  await prisma.sessionComplaint.deleteMany();
  await prisma.psychologistPayout.deleteMany();
  await prisma.paymentStatusHistory.deleteMany();
  await prisma.paymentRefund.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.order.deleteMany();
  await prisma.sessionRecordingConsent.deleteMany();
  await prisma.attendanceEvent.deleteMany();
  await prisma.psychologistSession.deleteMany();
  await prisma.psychologistBooking.deleteMany();
  await prisma.psychologistAvailabilitySlot.deleteMany();
  await prisma.adminAuditLog.deleteMany();
  await prisma.adminInvitation.deleteMany();
  await prisma.adminMembershipRole.deleteMany();
  await prisma.adminRolePermission.deleteMany();
  await prisma.adminPermission.deleteMany();
  await prisma.adminRole.deleteMany();
  await prisma.adminMembership.deleteMany();
  await prisma.psychologistVerificationCheck.deleteMany();
  await prisma.psychologistDocument.deleteMany();
  await prisma.psychologistSpecialisation.deleteMany();
  await prisma.psychologistLanguage.deleteMany();
  await prisma.psychologistProfile.deleteMany();
  await prisma.accountRole.deleteMany();
  await prisma.account.deleteMany();
};

export const seedRbacCatalog = async (): Promise<void> => {
  for (const code of ADMIN_PERMISSIONS) {
    await prisma.adminPermission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
  }
  for (const roleCode of Object.values(AdminRoleCode)) {
    await prisma.adminRole.upsert({
      where: { code: roleCode },
      create: { code: roleCode, name: ADMIN_ROLE_NAMES[roleCode] },
      update: { name: ADMIN_ROLE_NAMES[roleCode] },
    });
  }
  const permissions = await prisma.adminPermission.findMany();
  const permissionByCode = new Map(permissions.map((p) => [p.code, p.id]));
  const roles = await prisma.adminRole.findMany();
  const roleByCode = new Map(roles.map((r) => [r.code, r.id]));

  for (const [roleCode, permCodes] of Object.entries(ROLE_PERMISSION_MAP) as [
    AdminRoleCode,
    readonly string[],
  ][]) {
    const adminRoleId = roleByCode.get(roleCode)!;
    for (const permCode of permCodes) {
      const adminPermissionId = permissionByCode.get(permCode)!;
      await prisma.adminRolePermission.upsert({
        where: { adminRoleId_adminPermissionId: { adminRoleId, adminPermissionId } },
        create: { adminRoleId, adminPermissionId },
        update: {},
      });
    }
  }
};

export const createStaffAccount = async (input: {
  superTokensUserId: string;
  email?: string;
  roles?: StaffRole[];
  status?: AccountStatus;
  adminRoles?: AdminRoleCode[];
  membershipStatus?: AdminMembershipStatus;
}) => {
  const account = await prisma.account.create({
    data: {
      superTokensUserId: input.superTokensUserId,
      email: input.email ?? null,
      status: input.status ?? AccountStatus.ACTIVE,
      roles: {
        create: (input.roles ?? []).map((role) => ({ role })),
      },
    },
  });

  if (input.adminRoles?.length) {
    const membership = await prisma.adminMembership.create({
      data: {
        accountId: account.id,
        status: input.membershipStatus ?? AdminMembershipStatus.ACTIVE,
      },
    });
    const roles = await prisma.adminRole.findMany({ where: { code: { in: input.adminRoles } } });
    for (const role of roles) {
      await prisma.adminMembershipRole.create({
        data: { adminMembershipId: membership.id, adminRoleId: role.id },
      });
    }
  }

  return account;
};

export const staffAuthHeader = (superTokensUserId: string) => ({
  "X-Test-SuperTokens-User-Id": superTokensUserId,
});
