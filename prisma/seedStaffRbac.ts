/**
 * Idempotent seed for AdminRole / AdminPermission / AdminRolePermission catalogs.
 * Does not grant founder access to any account.
 *
 * Run: npx tsx prisma/seedStaffRbac.ts
 */
import { AdminRoleCode, PrismaClient } from "@prisma/client";
import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLE_NAMES,
  ROLE_PERMISSION_MAP,
} from "../src/modules/staff/permissions";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  for (const code of ADMIN_PERMISSIONS) {
    await prisma.adminPermission.upsert({
      where: { code },
      create: { code, description: code },
      update: { description: code },
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
    const adminRoleId = roleByCode.get(roleCode);
    if (!adminRoleId) {
      throw new Error(`Missing admin role ${roleCode}`);
    }

    for (const permCode of permCodes) {
      const adminPermissionId = permissionByCode.get(permCode);
      if (!adminPermissionId) {
        throw new Error(`Missing permission ${permCode}`);
      }
      await prisma.adminRolePermission.upsert({
        where: {
          adminRoleId_adminPermissionId: { adminRoleId, adminPermissionId },
        },
        create: { adminRoleId, adminPermissionId },
        update: {},
      });
    }
  }

  console.log("Staff RBAC seed complete:", {
    permissions: ADMIN_PERMISSIONS.length,
    roles: Object.keys(ADMIN_ROLE_NAMES).length,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
