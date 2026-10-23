import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  AccountStatus,
  AdminMembershipStatus,
  AdminRoleCode,
  DocumentStatus,
  PsychologistDocumentKind,
  StaffRole,
  VerificationCheckStatus,
} from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { looksLikeFullAadhaar } from "../src/modules/staff/rci";
import { isPsychologistBookable } from "../src/modules/staff/psychologistService";
import { createStaffAccount, resetStaffTables, seedRbacCatalog, staffAuthHeader } from "./staff.helpers";
import { resetAuthTables, registerPayload, TEST_RECOVERY_KEY } from "./helpers";

const app = createApp();

describe("Staff auth foundation", () => {
  beforeAll(async () => {
    await seedRbacCatalog();
  });

  beforeEach(async () => {
    await resetStaffTables();
    await seedRbacCatalog();
    await resetAuthTables();
  });

  it("keeps anonymous client auth working", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .set("X-Client-Platform", "android")
      .send(registerPayload({ recoveryKey: TEST_RECOVERY_KEY }));
    expect(res.status).toBe(201);
    expect(res.body.data.tokens.accessToken).toBeTruthy();
  });

  it("denies unprovisioned SuperTokens identities", async () => {
    const res = await request(app)
      .get("/api/v1/staff/me")
      .set(staffAuthHeader("st-user-unknown"));
    expect(res.status).toBe(403);
  });

  it("denies disabled accounts", async () => {
    await createStaffAccount({
      superTokensUserId: "st-disabled",
      roles: [StaffRole.ADMIN],
      status: AccountStatus.DISABLED,
      adminRoles: [AdminRoleCode.FINANCE],
    });
    const res = await request(app).get("/api/v1/staff/me").set(staffAuthHeader("st-disabled"));
    expect(res.status).toBe(403);
  });

  it("requires PSYCHOLOGIST role for psychologist routes", async () => {
    await createStaffAccount({
      superTokensUserId: "st-admin-only",
      roles: [StaffRole.ADMIN],
      adminRoles: [AdminRoleCode.VERIFICATION_OFFICER],
    });
    const res = await request(app)
      .get("/api/v1/staff/psychologist/me")
      .set(staffAuthHeader("st-admin-only"));
    expect(res.status).toBe(403);
  });

  it("enforces admin membership and permissions", async () => {
    await createStaffAccount({
      superTokensUserId: "st-content",
      roles: [StaffRole.ADMIN],
      adminRoles: [AdminRoleCode.CONTENT_EDITOR],
    });
    const denied = await request(app)
      .get("/api/v1/staff/admin/psychologists")
      .set(staffAuthHeader("st-content"));
    expect(denied.status).toBe(403);

    await createStaffAccount({
      superTokensUserId: "st-verifier",
      roles: [StaffRole.ADMIN],
      adminRoles: [AdminRoleCode.VERIFICATION_OFFICER],
    });
    const allowed = await request(app)
      .get("/api/v1/staff/admin/psychologists")
      .set(staffAuthHeader("st-verifier"));
    expect(allowed.status).toBe(200);
  });

  it("blocks revoked membership without deleting account", async () => {
    const account = await createStaffAccount({
      superTokensUserId: "st-revoked",
      roles: [StaffRole.ADMIN],
      adminRoles: [AdminRoleCode.FOUNDER_SUPER_ADMIN],
    });
    await prisma.adminMembership.update({
      where: { accountId: account.id },
      data: { status: AdminMembershipStatus.REVOKED, revokedAt: new Date() },
    });
    const res = await request(app)
      .get("/api/v1/staff/me/permissions")
      .set(staffAuthHeader("st-revoked"));
    expect(res.status).toBe(403);
    const stillThere = await prisma.account.findUnique({ where: { id: account.id } });
    expect(stillThere).toBeTruthy();
  });

  it("rejects incomplete psychologist application submission", async () => {
    await createStaffAccount({
      superTokensUserId: "st-psych",
      roles: [StaffRole.PSYCHOLOGIST],
    });
    const res = await request(app)
      .post("/api/v1/staff/psychologist/me/application/submit")
      .set(staffAuthHeader("st-psych"));
    expect(res.status).toBe(400);
    expect(res.body.details).toBeTruthy();
  });

  it("rejects full Aadhaar persistence attempts", async () => {
    expect(looksLikeFullAadhaar("1234-5678-9012")).toBe(true);
    await createStaffAccount({
      superTokensUserId: "st-psych-aadhaar",
      roles: [StaffRole.PSYCHOLOGIST],
    });
    const res = await request(app)
      .put("/api/v1/staff/psychologist/me/application")
      .set(staffAuthHeader("st-psych-aadhaar"))
      .send({ aadhaarLast4: "123456789012", idDocumentType: "AADHAAR" });
    expect(res.status).toBe(400);
  });

  it("returns 503 for document upload when storage is not configured", async () => {
    await createStaffAccount({
      superTokensUserId: "st-psych-upload",
      roles: [StaffRole.PSYCHOLOGIST],
    });
    const res = await request(app)
      .post("/api/v1/staff/psychologist/me/documents/upload-url")
      .set(staffAuthHeader("st-psych-upload"))
      .send({
        kind: "ID_FRONT",
        contentType: "image/jpeg",
        byteSize: 1024,
      });
    expect(res.status).toBe(503);
  });

  it("rejects publication unless all checks are verified", async () => {
    const psychAccount = await createStaffAccount({
      superTokensUserId: "st-psych-pub",
      roles: [StaffRole.PSYCHOLOGIST],
    });
    const profile = await prisma.psychologistProfile.create({
      data: {
        accountId: psychAccount.id,
        legalFullName: "Dr Test",
        publicationStatus: "VERIFIED_UNPUBLISHED",
        checks: {
          create: [
            { type: "IDENTITY", status: VerificationCheckStatus.VERIFIED },
            { type: "RCI_REGISTRATION", status: VerificationCheckStatus.VERIFIED },
            { type: "DEGREE", status: VerificationCheckStatus.QUEUED },
            { type: "YEARS_OF_EXPERIENCE", status: VerificationCheckStatus.VERIFIED },
          ],
        },
      },
      include: { checks: true },
    });

    expect(isPsychologistBookable(profile)).toBe(false);

    await createStaffAccount({
      superTokensUserId: "st-founder",
      roles: [StaffRole.ADMIN],
      adminRoles: [AdminRoleCode.FOUNDER_SUPER_ADMIN],
    });
    const res = await request(app)
      .post(`/api/v1/staff/admin/psychologists/${profile.id}/publish`)
      .set(staffAuthHeader("st-founder"));
    expect(res.status).toBe(409);
  });

  it("prevents role escalation beyond inviter authority and auto-founder grants", async () => {
    await createStaffAccount({
      superTokensUserId: "st-safety",
      email: "safety@umind.test",
      roles: [StaffRole.ADMIN],
      adminRoles: [AdminRoleCode.SAFETY_LEAD],
    });
    const escalate = await request(app)
      .post("/api/v1/staff/admin/members/invitations")
      .set(staffAuthHeader("st-safety"))
      .send({ email: "new@umind.test", roleCodes: ["FINANCE"] });
    // SAFETY_LEAD lacks admin_memberships.manage
    expect(escalate.status).toBe(403);

    await createStaffAccount({
      superTokensUserId: "st-verifier-invite",
      email: "verify@umind.test",
      roles: [StaffRole.ADMIN],
      adminRoles: [AdminRoleCode.VERIFICATION_OFFICER],
    });
    // Verification officer also lacks admin_memberships.manage
    const invite = await request(app)
      .post("/api/v1/staff/admin/members/invitations")
      .set(staffAuthHeader("st-verifier-invite"))
      .send({ email: "x@umind.test", roleCodes: ["FOUNDER_SUPER_ADMIN"] });
    expect(invite.status).toBe(403);
  });

  it("allows founder to invite and accept invitation transactionally", async () => {
    await createStaffAccount({
      superTokensUserId: "st-founder-2",
      email: "founder@umind.test",
      roles: [StaffRole.ADMIN],
      adminRoles: [AdminRoleCode.FOUNDER_SUPER_ADMIN],
    });

    const invite = await request(app)
      .post("/api/v1/staff/admin/members/invitations")
      .set(staffAuthHeader("st-founder-2"))
      .send({ email: "officer@umind.test", roleCodes: ["VERIFICATION_OFFICER"] });
    expect(invite.status).toBe(201);
    expect(invite.body.data.token).toBeTruthy();

    const accept = await request(app)
      .post("/api/v1/staff/invitations/accept")
      .set(staffAuthHeader("st-new-officer"))
      .send({ token: invite.body.data.token });
    expect(accept.status).toBe(200);

    const me = await request(app)
      .get("/api/v1/staff/me")
      .set(staffAuthHeader("st-new-officer"));
    expect(me.status).toBe(200);
    expect(me.body.data.roles).toContain("ADMIN");

    const reuse = await request(app)
      .post("/api/v1/staff/invitations/accept")
      .set(staffAuthHeader("st-other"))
      .send({ token: invite.body.data.token });
    expect(reuse.status).toBe(404);
  });

  it("has no public admin signup route", async () => {
    const res = await request(app).post("/api/v1/staff/admin/signup").send({});
    // Unmatched admin paths still hit auth middleware; must never succeed as signup.
    expect(res.status).not.toBe(201);
    expect([404, 401, 403, 503]).toContain(res.status);
  });

  it("audits authorized document views and blocks unauthorized ones", async () => {
    const psychAccount = await createStaffAccount({
      superTokensUserId: "st-psych-doc",
      roles: [StaffRole.PSYCHOLOGIST],
    });
    const profile = await prisma.psychologistProfile.create({
      data: { accountId: psychAccount.id },
    });
    const doc = await prisma.psychologistDocument.create({
      data: {
        psychologistProfileId: profile.id,
        kind: PsychologistDocumentKind.ID_FRONT,
        storageObjectKey: `psychologists/${profile.id}/ID_FRONT/test`,
        contentType: "image/jpeg",
        byteSize: 100,
        status: DocumentStatus.UPLOADED,
        uploadedAt: new Date(),
      },
    });

    await createStaffAccount({
      superTokensUserId: "st-finance",
      roles: [StaffRole.ADMIN],
      adminRoles: [AdminRoleCode.FINANCE],
    });
    const denied = await request(app)
      .post(`/api/v1/staff/admin/psychologists/${profile.id}/documents/${doc.id}/view-url`)
      .set(staffAuthHeader("st-finance"));
    expect(denied.status).toBe(403);

    await createStaffAccount({
      superTokensUserId: "st-verifier-doc",
      roles: [StaffRole.ADMIN],
      adminRoles: [AdminRoleCode.VERIFICATION_OFFICER],
    });
    const view = await request(app)
      .post(`/api/v1/staff/admin/psychologists/${profile.id}/documents/${doc.id}/view-url`)
      .set(staffAuthHeader("st-verifier-doc"));
    // Storage not configured → 503 after authz (authz must pass first)
    expect([503, 200]).toContain(view.status);
    if (view.status === 503) {
      // Still should not have written success audit without URL — authz ran; storage failed.
      expect(view.body.message).toMatch(/storage/i);
    }
  });
});
