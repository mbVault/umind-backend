import { AdminRoleCode } from "@prisma/client";

/** Exact permission identifiers seeded and enforced in the backend. */
export const ADMIN_PERMISSIONS = [
  "psychologist.read",
  "psychologist.verify",
  "psychologist.publish",
  "psychologist.suspend",
  "verification_documents.read",
  "safety_alerts.read",
  "sessions.read",
  "payouts.read",
  "payouts.manage",
  "audio.read",
  "audio.manage",
  "admin_memberships.manage",
  "audit_logs.read",
] as const;

export type AdminPermissionCode = (typeof ADMIN_PERMISSIONS)[number];

export const ADMIN_ROLE_NAMES: Record<AdminRoleCode, string> = {
  FOUNDER_SUPER_ADMIN: "Founder / Super Admin",
  VERIFICATION_OFFICER: "Verification Officer",
  SAFETY_LEAD: "Safety Lead",
  FINANCE: "Finance",
  CONTENT_EDITOR: "Content Editor",
};

/** Role → permission mapping aligned with the admin product specification. */
export const ROLE_PERMISSION_MAP: Record<AdminRoleCode, readonly AdminPermissionCode[]> = {
  FOUNDER_SUPER_ADMIN: [...ADMIN_PERMISSIONS],
  VERIFICATION_OFFICER: [
    "psychologist.read",
    "psychologist.verify",
    "psychologist.publish",
    "verification_documents.read",
    "audit_logs.read",
  ],
  SAFETY_LEAD: ["psychologist.read", "safety_alerts.read", "audit_logs.read"],
  FINANCE: ["psychologist.read", "sessions.read", "payouts.read", "payouts.manage", "audit_logs.read"],
  CONTENT_EDITOR: ["audio.read", "audio.manage"],
};

export const REQUIRED_DOCUMENT_KINDS = [
  "ID_FRONT",
  "ID_BACK",
  "LIVE_SELFIE",
  "PASSPORT_PHOTO",
  "DEGREE_CERTIFICATE",
  "RCI_CERTIFICATE",
  "EXPERIENCE_LETTER",
] as const;

export const REQUIRED_VERIFICATION_CHECKS = [
  "IDENTITY",
  "RCI_REGISTRATION",
  "DEGREE",
  "YEARS_OF_EXPERIENCE",
] as const;
