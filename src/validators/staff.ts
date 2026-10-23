import { z } from "zod";

export const applicationBodySchema = z.object({
  legalFullName: z.string().min(2).max(120).optional(),
  rciRegistrationNumber: z.string().min(5).max(64).optional(),
  highestDegree: z.string().min(2).max(120).optional(),
  yearsPractising: z.number().int().min(0).max(50).optional(),
  specialisations: z
    .array(
      z.enum([
        "STRESS",
        "ANXIETY",
        "SLEEP",
        "BURNOUT",
        "RELATIONSHIPS",
        "TEENS",
        "WOMENS_HEALTH",
        "GRIEF",
      ])
    )
    .optional(),
  languages: z.array(z.enum(["HINDI", "ENGLISH", "MARATHI", "PUNJABI", "TAMIL"])).optional(),
  idDocumentType: z.enum(["AADHAAR", "PAN", "PASSPORT", "DRIVING_LICENCE"]).optional(),
  aadhaarLast4: z.string().max(12).optional(),
});

export const profilePatchSchema = z.object({
  visibilityMode: z.enum(["REAL_NAME_AND_PHOTO", "DISPLAY_NAME_AND_AVATAR"]).optional(),
  displayName: z.string().min(1).max(80).optional(),
  avatarColor: z.string().max(16).optional(),
  avatarInitials: z.string().max(4).optional(),
  publicPhotoObjectKey: z.string().max(512).nullable().optional(),
});

export const uploadUrlBodySchema = z.object({
  kind: z.enum([
    "ID_FRONT",
    "ID_BACK",
    "LIVE_SELFIE",
    "PASSPORT_PHOTO",
    "DEGREE_CERTIFICATE",
    "RCI_CERTIFICATE",
    "EXPERIENCE_LETTER",
  ]),
  contentType: z.string().min(3).max(100),
  byteSize: z.number().int().positive(),
});

export const confirmUploadBodySchema = z.object({
  kind: z.enum([
    "ID_FRONT",
    "ID_BACK",
    "LIVE_SELFIE",
    "PASSPORT_PHOTO",
    "DEGREE_CERTIFICATE",
    "RCI_CERTIFICATE",
    "EXPERIENCE_LETTER",
  ]),
  objectKey: z.string().min(8).max(512),
  contentType: z.string().min(3).max(100),
  byteSize: z.number().int().positive(),
});

export const replacementUploadBodySchema = z.object({
  contentType: z.string().min(3).max(100),
  byteSize: z.number().int().positive(),
});

export const replacementConfirmBodySchema = z.object({
  objectKey: z.string().min(8).max(512),
  contentType: z.string().min(3).max(100),
  byteSize: z.number().int().positive(),
});

export const checkDecisionBodySchema = z.object({
  decision: z.enum(["VERIFIED", "NEEDS_ATTENTION"]),
  reason: z.string().max(1000).optional(),
});

export const suspendBodySchema = z.object({
  reason: z.string().min(3).max(500),
});

export const invitationBodySchema = z.object({
  email: z.string().email().max(320),
  roleCodes: z
    .array(
      z.enum([
        "FOUNDER_SUPER_ADMIN",
        "VERIFICATION_OFFICER",
        "SAFETY_LEAD",
        "FINANCE",
        "CONTENT_EDITOR",
      ])
    )
    .min(1),
});

export const acceptInvitationBodySchema = z.object({
  token: z.string().min(20).max(200),
});

export const membershipRolesBodySchema = z.object({
  roleCodes: z
    .array(
      z.enum([
        "FOUNDER_SUPER_ADMIN",
        "VERIFICATION_OFFICER",
        "SAFETY_LEAD",
        "FINANCE",
        "CONTENT_EDITOR",
      ])
    )
    .min(1),
});

export const psychologistListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  publicationStatus: z
    .enum(["NOT_SUBMITTED", "PENDING_VERIFICATION", "VERIFIED_UNPUBLISHED", "LIVE", "NEEDS_ATTENTION"])
    .optional(),
  search: z.string().max(100).optional(),
});

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().max(80).optional(),
});

export const uuidParamSchema = z.object({
  psychologistId: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
  checkId: z.string().uuid().optional(),
  membershipId: z.string().uuid().optional(),
});
