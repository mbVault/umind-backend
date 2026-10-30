/**
 * Local-only: create SuperTokens EmailPassword user + Prisma ADMIN account
 * with active AdminMembership (FOUNDER_SUPER_ADMIN).
 *
 * Prerequisites:
 *   - SuperTokens Core running
 *   - npm run prisma:seed:staff-rbac
 *
 * Usage:
 *   npx tsx scripts/provision-local-admin.ts
 *   npx tsx scripts/provision-local-admin.ts --email admin@gmail.com --password admin123
 */
import "dotenv/config";
import {
  AccountStatus,
  AdminMembershipStatus,
  AdminRoleCode,
  PrismaClient,
  StaffRole,
} from "@prisma/client";

const prisma = new PrismaClient();

type Args = { email: string; password: string };

const parseArgs = (): Args => {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    email: (get("--email") ?? "admin@gmail.com").trim().toLowerCase(),
    password: get("--password") ?? "admin123",
  };
};

const coreSignup = async (email: string, password: string): Promise<string> => {
  const uri = (process.env.SUPERTOKENS_CONNECTION_URI ?? "").replace(/\/$/, "");
  const apiKey = process.env.SUPERTOKENS_API_KEY ?? "";
  if (!uri) {
    throw new Error("SUPERTOKENS_CONNECTION_URI is not set in .env");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["api-key"] = apiKey;

  const res = await fetch(`${uri}/recipe/signup`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    status?: string;
    user?: { id?: string };
    id?: string;
  };

  if (res.ok && (body.status === "OK" || body.user?.id || body.id)) {
    const id = body.user?.id ?? body.id;
    if (!id) throw new Error("Core signup OK but no user id in response");
    return id;
  }

  if (body.status === "EMAIL_ALREADY_EXISTS_ERROR" || res.status === 400) {
    const lookup = await fetch(
      `${uri}/recipe/user?email=${encodeURIComponent(email)}`,
      { headers: apiKey ? { "api-key": apiKey } : {} },
    );
    const found = (await lookup.json().catch(() => ({}))) as {
      status?: string;
      user?: { id?: string };
    };
    const id = found.user?.id;
    if (!id) {
      throw new Error(
        `Email exists but user lookup failed: ${JSON.stringify(found).slice(0, 300)}`,
      );
    }
    const reset = await fetch(`${uri}/recipe/user/password`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ userId: id, newPassword: password }),
    });
    const resetBody = (await reset.json().catch(() => ({}))) as { status?: string };
    if (!reset.ok || (resetBody.status && resetBody.status !== "OK")) {
      const reset2 = await fetch(`${uri}/recipe/user/password`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ recipeUserId: id, newPassword: password }),
      });
      const reset2Body = (await reset2.json().catch(() => ({}))) as { status?: string };
      if (!reset2.ok || (reset2Body.status && reset2Body.status !== "OK")) {
        console.warn(
          `Password reset skipped/failed (${reset.status}/${reset2.status}); trying existing password.`,
        );
      }
    }
    return id;
  }

  throw new Error(
    `SuperTokens Core signup failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`,
  );
};

async function ensureAdmin(superTokensUserId: string, email: string): Promise<void> {
  const founderRole = await prisma.adminRole.findUnique({
    where: { code: AdminRoleCode.FOUNDER_SUPER_ADMIN },
  });
  if (!founderRole) {
    throw new Error(
      "FOUNDER_SUPER_ADMIN role missing. Run: npm run prisma:seed:staff-rbac",
    );
  }

  let account = await prisma.account.findUnique({
    where: { superTokensUserId },
    include: { roles: true, adminMembership: true },
  });

  if (!account) {
    account = await prisma.account.create({
      data: {
        superTokensUserId,
        email,
        status: AccountStatus.ACTIVE,
        roles: { create: [{ role: StaffRole.ADMIN }] },
      },
      include: { roles: true, adminMembership: true },
    });
  } else {
    if (account.email !== email) {
      await prisma.account.update({
        where: { id: account.id },
        data: { email, status: AccountStatus.ACTIVE, deletedAt: null },
      });
    }
    if (!account.roles.some((r) => r.role === StaffRole.ADMIN)) {
      await prisma.accountRole.create({
        data: { accountId: account.id, role: StaffRole.ADMIN },
      });
    }
  }

  let membership = await prisma.adminMembership.findUnique({
    where: { accountId: account.id },
    include: { roles: true },
  });

  if (!membership) {
    membership = await prisma.adminMembership.create({
      data: {
        accountId: account.id,
        status: AdminMembershipStatus.ACTIVE,
        roles: { create: [{ adminRoleId: founderRole.id }] },
      },
      include: { roles: true },
    });
  } else {
    await prisma.adminMembership.update({
      where: { id: membership.id },
      data: {
        status: AdminMembershipStatus.ACTIVE,
        revokedAt: null,
      },
    });
    const hasFounder = membership.roles.some((r) => r.adminRoleId === founderRole.id);
    if (!hasFounder) {
      await prisma.adminMembershipRole.create({
        data: {
          adminMembershipId: membership.id,
          adminRoleId: founderRole.id,
        },
      });
    }
  }
}

async function main() {
  const { email, password } = parseArgs();
  console.log(`Provisioning local admin for ${email}…`);

  const stUserId = await coreSignup(email, password);
  await ensureAdmin(stUserId, email);

  console.log("Done.");
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log(`  stUserId: ${stUserId}`);
  console.log("  Open http://localhost:3000/admin/login");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
