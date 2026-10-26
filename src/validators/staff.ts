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

export const hrRejectBodySchema = z
  .object({
    reason: z.string().min(3).max(500),
  })
  .strict();

export const profilePatchSchema = z.object({
  visibilityMode: z.enum(["REAL_NAME_AND_PHOTO", "DISPLAY_NAME_AND_AVATAR"]).optional(),
  displayName: z.string().min(1).max(80).optional(),
  avatarColor: z.string().max(16).optional(),
  avatarInitials: z.string().max(4).optional(),
  publicPhotoObjectKey: z.string().max(512).nullable().optional(),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

const dayWindowsSchema = z
  .array(
    z
      .object({ start: hhmm, end: hhmm })
      .refine((w) => w.start < w.end, { message: "start must be before end" })
  )
  .max(12);

export const weeklyHoursSchema = z
  .object({
    mon: dayWindowsSchema.default([]),
    tue: dayWindowsSchema.default([]),
    wed: dayWindowsSchema.default([]),
    thu: dayWindowsSchema.default([]),
    fri: dayWindowsSchema.default([]),
    sat: dayWindowsSchema.default([]),
    sun: dayWindowsSchema.default([]),
  })
  .strict();

export const presencePatchSchema = z
  .object({
    presence: z.enum(["ONLINE", "AWAY"]),
  })
  .strict();

export const hoursPatchSchema = z
  .object({
    presence: z.enum(["ONLINE", "AWAY"]).optional(),
    acceptingNewClients: z.boolean().optional(),
    maxSessionsPerDay: z.number().int().min(1).max(24).nullable().optional(),
    sessionModes: z.array(z.enum(["CHAT", "VOICE", "VIDEO"])).min(1).max(3).optional(),
    weeklyHours: weeklyHoursSchema.nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "At least one field required" });

export const staffAvailabilityQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export const staffAvailabilityPutSchema = z
  .object({
    replaceOpenSlots: z
      .array(
        z.object({
          startsAt: z.coerce.date(),
          endsAt: z.coerce.date(),
        })
      )
      .max(500),
  })
  .strict();

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

export const dashboardQuerySchema = z.object({
  date: z.coerce.date().optional(),
});

export const bookingsDateQuerySchema = z.object({
  date: z.coerce.date(),
});

export const earningsMonthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

export const payoutsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const sessionNotesBodySchema = z
  .object({
    privateNotes: z.string().max(20000).nullable().optional(),
    privateNoteTags: z.array(z.string().min(1).max(40)).max(20).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "At least one field required" });

export const afterSessionBodySchema = z
  .object({
    riskLevel: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]),
    recommendedAudioIds: z.array(z.string().uuid()).max(10).optional(),
    followUpRecommended: z.boolean().optional(),
    followUpNote: z.string().max(1000).nullable().optional(),
    clientFacingNote: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const bookingIdParamSchema = z.object({
  bookingId: z.string().uuid(),
});

export const sessionIdParamSchema = z.object({
  sessionId: z.string().uuid(),
});

export const clientRefParamSchema = z.object({
  clientRef: z.string().min(8).max(64),
});

export const payoutIdParamSchema = z.object({
  payoutId: z.string().uuid(),
});
