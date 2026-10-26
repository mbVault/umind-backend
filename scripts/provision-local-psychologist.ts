/**
 * Local-only: create a SuperTokens EmailPassword user + Prisma psychologist Account
 * so you can sign in on the mobile expert app and walk the flow.
 *
 * Usage:
 *   npx tsx scripts/provision-local-psychologist.ts
 *   npx tsx scripts/provision-local-psychologist.ts --email you@clinic.com --password 'YourPass123!'
 *   npx tsx scripts/provision-local-psychologist.ts --live   # skip onboarding → Main tabs (LIVE profile)
 *
 * Does not print secrets. Default password is shown once so you can log in.
 */
import "dotenv/config";
import {
  AccountStatus,
  CommunicationMode,
  PrismaClient,
  PsychologistHrApprovalStatus,
  PsychologistOnboardingStep,
  PsychologistPresence,
  StaffRole,
  VerificationCheckStatus,
  VerificationCheckType,
} from "@prisma/client";

const prisma = new PrismaClient();

const REQUIRED_CHECKS: VerificationCheckType[] = [
  VerificationCheckType.IDENTITY,
  VerificationCheckType.RCI_REGISTRATION,
  VerificationCheckType.DEGREE,
  VerificationCheckType.YEARS_OF_EXPERIENCE,
];

type Args = {
  email: string;
  password: string;
  live: boolean;
};

const parseArgs = (): Args => {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    email: (get("--email") ?? "psych@umind.local").trim().toLowerCase(),
    password: get("--password") ?? "UMindPsych1!",
    live: argv.includes("--live"),
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

  // SuperTokens Core CDI (EmailPassword signup) — public app signupPOST is disabled; Core allows this.
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

  // Already exists → look up by email and reset password so local login stays predictable
  if (body.status === "EMAIL_ALREADY_EXISTS_ERROR" || res.status === 400) {
    const lookup = await fetch(
      `${uri}/recipe/user?email=${encodeURIComponent(email)}`,
      { headers: apiKey ? { "api-key": apiKey } : {} }
    );
    const found = (await lookup.json().catch(() => ({}))) as {
      status?: string;
      user?: { id?: string };
    };
    const id = found.user?.id;
    if (!id) {
      throw new Error(
        `Email exists but user lookup failed: ${JSON.stringify(found).slice(0, 300)}`
      );
    }
    const reset = await fetch(`${uri}/recipe/user/password`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ userId: id, newPassword: password }),
    });
    const resetBody = (await reset.json().catch(() => ({}))) as { status?: string };
    if (!reset.ok || (resetBody.status && resetBody.status !== "OK")) {
      // Older Core paths may use recipeUserId
      const reset2 = await fetch(`${uri}/recipe/user/password`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ recipeUserId: id, newPassword: password }),
      });
      const reset2Body = (await reset2.json().catch(() => ({}))) as { status?: string };
      if (!reset2.ok || (reset2Body.status && reset2Body.status !== "OK")) {
        console.warn(
          `Password reset skipped/failed (${reset.status}/${reset2.status}); trying existing password.`
        );
      }
    }
    return id;
  }

  throw new Error(
    `SuperTokens Core signup failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`
  );
};

const ensureAccount = async (superTokensUserId: string, email: string, live: boolean) => {
  let account = await prisma.account.findUnique({
    where: { superTokensUserId },
    include: { psychologistProfile: true, roles: true },
  });

  if (!account) {
    account = await prisma.account.create({
      data: {
        superTokensUserId,
        email,
        status: AccountStatus.ACTIVE,
        roles: { create: [{ role: StaffRole.PSYCHOLOGIST }] },
      },
      include: { psychologistProfile: true, roles: true },
    });
  } else if (!account.roles.some((r) => r.role === StaffRole.PSYCHOLOGIST)) {
    await prisma.accountRole.create({
      data: { accountId: account.id, role: StaffRole.PSYCHOLOGIST },
    });
  }

  if (!account.psychologistProfile) {
    await prisma.psychologistProfile.create({
      data: {
        accountId: account.id,
        legalFullName: live ? "Dr Local Psych" : null,
        displayName: live ? "Dr Local" : null,
        avatarInitials: live ? "DL" : null,
        avatarColor: live ? "#5B45E0" : null,
        rciRegistrationNumber: live ? "A00001" : null,
        highestDegree: live ? "M.Phil Clinical Psychology" : null,
        yearsPractising: live ? 6 : null,
        onboardingStep: live ? PsychologistOnboardingStep.COMPLETE : PsychologistOnboardingStep.APPLY,
        hrApprovalStatus: PsychologistHrApprovalStatus.APPROVED,
        publicationStatus: live ? "LIVE" : "NOT_SUBMITTED",
        accountStatus: "ACTIVE",
        publishedAt: live ? new Date() : null,
        presence: PsychologistPresence.ONLINE,
        acceptingNewClients: true,
        maxSessionsPerDay: 6,
        sessionModes: [CommunicationMode.CHAT, CommunicationMode.VOICE, CommunicationMode.VIDEO],
        weeklyHours: {
          mon: [{ start: "10:00", end: "10:40" }],
          tue: [{ start: "10:00", end: "10:40" }],
          wed: [{ start: "10:00", end: "10:40" }],
          thu: [{ start: "10:00", end: "10:40" }],
          fri: [{ start: "10:00", end: "10:40" }],
        },
        ...(live
          ? {
              specialisations: {
                create: [{ code: "STRESS" }, { code: "SLEEP" }],
              },
              languages: {
                create: [{ code: "ENGLISH" }, { code: "HINDI" }],
              },
              checks: {
                create: REQUIRED_CHECKS.map((type) => ({
                  type,
                  status: VerificationCheckStatus.VERIFIED,
                })),
              },
            }
          : {}),
      },
    });
  } else if (live) {
    await prisma.psychologistProfile.update({
      where: { id: account.psychologistProfile.id },
      data: {
        publicationStatus: "LIVE",
        hrApprovalStatus: PsychologistHrApprovalStatus.APPROVED,
        onboardingStep: PsychologistOnboardingStep.COMPLETE,
        publishedAt: new Date(),
        presence: PsychologistPresence.ONLINE,
        displayName: account.psychologistProfile.displayName ?? "Dr Local",
        legalFullName: account.psychologistProfile.legalFullName ?? "Dr Local Psych",
      },
    });
    for (const type of REQUIRED_CHECKS) {
      await prisma.psychologistVerificationCheck.upsert({
        where: {
          psychologistProfileId_type: {
            psychologistProfileId: account.psychologistProfile.id,
            type,
          },
        },
        create: {
          psychologistProfileId: account.psychologistProfile.id,
          type,
          status: VerificationCheckStatus.VERIFIED,
        },
        update: { status: VerificationCheckStatus.VERIFIED },
      });
    }
  }
};

async function main() {
  const { email, password, live } = parseArgs();
  console.log(`Provisioning local psychologist for ${email} (${live ? "LIVE / Main tabs" : "onboarding from Apply"})…`);

  const stUserId = await coreSignup(email, password);
  await ensureAccount(stUserId, email, live);

  console.log("Done.");
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log(`  stUserId: ${stUserId}`);
  console.log(
    live
      ? "  Sign in on the expert app → you should land on Today / Hours / Clients / Earnings."
      : "  Sign in on the expert app → Apply → Profile → Documents → BGV → Main."
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
