import {
  DocumentStatus,
  PsychologistApplicantNextAction,
  PsychologistDocumentKind,
  VerificationCheckStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { assertStorageConfigured, objectStorage } from "../../lib/objectStorage";
import { writeAuditLog } from "./auditService";

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

const MAX_BYTES = 10 * 1024 * 1024;

export const listPsychologistDocuments = async (psychologistProfileId: string) => {
  return prisma.psychologistDocument.findMany({
    where: { psychologistProfileId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      kind: true,
      contentType: true,
      byteSize: true,
      status: true,
      uploadedAt: true,
      replacedAt: true,
      rejectionReason: true,
      createdAt: true,
      // intentionally omit storageObjectKey from client DTOs at route layer
      storageObjectKey: true,
    },
  });
};

export const requestUploadUrl = async (input: {
  psychologistProfileId: string;
  accountId: string;
  kind: PsychologistDocumentKind;
  contentType: string;
  byteSize: number;
}) => {
  assertStorageConfigured();
  if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
    fail(400, "Validation failed", { contentType: ["Unsupported content type"] });
  }
  if (input.byteSize <= 0 || input.byteSize > MAX_BYTES) {
    fail(400, "Validation failed", { byteSize: [`Must be between 1 and ${MAX_BYTES} bytes`] });
  }

  const objectKey = `psychologists/${input.psychologistProfileId}/${input.kind}/${randomUUID()}`;
  const signed = await objectStorage.createUploadUrl({
    objectKey,
    contentType: input.contentType,
    byteSize: input.byteSize,
  });

  return { objectKey, ...signed };
};

export const confirmUpload = async (input: {
  psychologistProfileId: string;
  accountId: string;
  kind: PsychologistDocumentKind;
  objectKey: string;
  contentType: string;
  byteSize: number;
}) => {
  assertStorageConfigured();

  const expectedPrefix = `psychologists/${input.psychologistProfileId}/`;
  if (!input.objectKey.startsWith(expectedPrefix)) {
    fail(400, "Validation failed", { objectKey: ["Invalid object key"] });
  }

  const head = await objectStorage.headObject(input.objectKey);
  if (head.contentType !== input.contentType) {
    fail(400, "Uploaded object content type mismatch");
  }
  if (head.byteSize !== input.byteSize) {
    fail(400, "Uploaded object size mismatch");
  }

  return prisma.psychologistDocument.create({
    data: {
      psychologistProfileId: input.psychologistProfileId,
      kind: input.kind,
      storageObjectKey: input.objectKey,
      contentType: head.contentType,
      byteSize: head.byteSize,
      checksum: head.checksum ?? null,
      status: DocumentStatus.UPLOADED,
      uploadedAt: new Date(),
      uploadedByAccountId: input.accountId,
    },
  });
};

export const requestReplacementUploadUrl = async (input: {
  psychologistProfileId: string;
  documentId: string;
  accountId: string;
  contentType: string;
  byteSize: number;
}) => {
  const existing = await prisma.psychologistDocument.findFirst({
    where: { id: input.documentId, psychologistProfileId: input.psychologistProfileId },
  });
  if (!existing) fail(404, "Document not found");
  if (
    existing.status !== DocumentStatus.REJECTED_NEED_REUPLOAD &&
    existing.status !== DocumentStatus.UPLOADED
  ) {
    fail(409, "Document is not eligible for replacement");
  }

  return requestUploadUrl({
    psychologistProfileId: input.psychologistProfileId,
    accountId: input.accountId,
    kind: existing.kind,
    contentType: input.contentType,
    byteSize: input.byteSize,
  });
};

export const confirmReplacement = async (input: {
  psychologistProfileId: string;
  documentId: string;
  accountId: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
}) => {
  assertStorageConfigured();
  const existing = await prisma.psychologistDocument.findFirst({
    where: { id: input.documentId, psychologistProfileId: input.psychologistProfileId },
  });
  if (!existing) fail(404, "Document not found");

  const expectedPrefix = `psychologists/${input.psychologistProfileId}/`;
  if (!input.objectKey.startsWith(expectedPrefix)) {
    fail(400, "Validation failed", { objectKey: ["Invalid object key"] });
  }

  const head = await objectStorage.headObject(input.objectKey);
  if (head.contentType !== input.contentType || head.byteSize !== input.byteSize) {
    fail(400, "Uploaded object metadata mismatch");
  }

  return prisma.$transaction(async (tx) => {
    await tx.psychologistDocument.update({
      where: { id: existing.id },
      data: { status: DocumentStatus.REPLACED, replacedAt: new Date() },
    });

    const created = await tx.psychologistDocument.create({
      data: {
        psychologistProfileId: input.psychologistProfileId,
        kind: existing.kind,
        storageObjectKey: input.objectKey,
        contentType: head.contentType,
        byteSize: head.byteSize,
        checksum: head.checksum ?? null,
        status: DocumentStatus.UPLOADED,
        uploadedAt: new Date(),
        uploadedByAccountId: input.accountId,
        replacesDocumentId: existing.id,
      },
    });

    // Related checks return to review — never auto-verify.
    const relatedTypes = relatedChecksForDocumentKind(existing.kind);
    if (relatedTypes.length) {
      await tx.psychologistVerificationCheck.updateMany({
        where: {
          psychologistProfileId: input.psychologistProfileId,
          type: { in: relatedTypes },
        },
        data: {
          status: VerificationCheckStatus.QUEUED,
          reason: "Document replaced; awaiting re-review",
          reviewedAt: null,
          reviewerAccountId: null,
        },
      });
    }

    const stillNeedsReupload = await tx.psychologistDocument.count({
      where: {
        psychologistProfileId: input.psychologistProfileId,
        status: DocumentStatus.REJECTED_NEED_REUPLOAD,
      },
    });
    if (stillNeedsReupload === 0) {
      await tx.psychologistProfile.update({
        where: { id: input.psychologistProfileId },
        data: {
          applicantNextAction: PsychologistApplicantNextAction.WAIT,
          applicantMessage: null,
        },
      });
    }

    return created;
  });
};

const relatedChecksForDocumentKind = (kind: PsychologistDocumentKind) => {
  switch (kind) {
    case "ID_FRONT":
    case "ID_BACK":
    case "LIVE_SELFIE":
    case "PASSPORT_PHOTO":
      return ["IDENTITY" as const];
    case "RCI_CERTIFICATE":
      return ["RCI_REGISTRATION" as const];
    case "DEGREE_CERTIFICATE":
      return ["DEGREE" as const];
    case "EXPERIENCE_LETTER":
      return ["YEARS_OF_EXPERIENCE" as const];
    default:
      return [];
  }
};

/** Admin marks a document as needing re-upload (State 3). Does not reject the application. */
export const rejectDocumentForReupload = async (input: {
  psychologistProfileId: string;
  documentId: string;
  actorAccountId: string;
  applicantSafeReason: string;
}) => {
  const doc = await prisma.psychologistDocument.findFirst({
    where: { id: input.documentId, psychologistProfileId: input.psychologistProfileId },
  });
  if (!doc) fail(404, "Document not found");
  if (doc.status === DocumentStatus.REPLACED) {
    fail(409, "Document was already replaced; reject the current version");
  }
  if (doc.status === DocumentStatus.PENDING_UPLOAD) {
    fail(409, "Document has not been uploaded yet");
  }

  const reason = input.applicantSafeReason.slice(0, 500);
  const updated = await prisma.$transaction(async (tx) => {
    const document = await tx.psychologistDocument.update({
      where: { id: doc.id },
      data: {
        status: DocumentStatus.REJECTED_NEED_REUPLOAD,
        rejectionReason: reason,
      },
    });

    await tx.psychologistProfile.update({
      where: { id: input.psychologistProfileId },
      data: {
        applicantNextAction: PsychologistApplicantNextAction.UPLOAD_DOC,
        applicantMessage: reason,
      },
    });

    return document;
  });

  await writeAuditLog({
    actorAccountId: input.actorAccountId,
    action: "DOCUMENT_REJECTED_NEED_REUPLOAD",
    targetType: "PsychologistDocument",
    targetId: doc.id,
    metadata: {
      psychologistProfileId: input.psychologistProfileId,
      kind: doc.kind,
      reason: reason.slice(0, 200),
    },
  });

  return updated;
};

export const createDocumentViewUrl = async (input: {
  psychologistId: string;
  documentId: string;
  actorAccountId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) => {
  assertStorageConfigured();
  const doc = await prisma.psychologistDocument.findFirst({
    where: { id: input.documentId, psychologistProfileId: input.psychologistId },
  });
  if (!doc) fail(404, "Document not found");

  const signed = await objectStorage.createViewUrl(doc.storageObjectKey);

  await writeAuditLog({
    actorAccountId: input.actorAccountId,
    action: "DOCUMENT_VIEWED",
    targetType: "PsychologistDocument",
    targetId: doc.id,
    metadata: { psychologistProfileId: input.psychologistId, kind: doc.kind },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return { expiresAt: signed.expiresAt, url: signed.url };
};

export const toDocumentMetaDto = (doc: {
  id: string;
  kind: PsychologistDocumentKind;
  contentType: string;
  byteSize: number;
  status: DocumentStatus;
  uploadedAt: Date | null;
  replacedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
}) => ({
  id: doc.id,
  kind: doc.kind,
  contentType: doc.contentType,
  byteSize: doc.byteSize,
  status: doc.status,
  uploadedAt: doc.uploadedAt?.toISOString() ?? null,
  replacedAt: doc.replacedAt?.toISOString() ?? null,
  rejectionReason: doc.rejectionReason,
  createdAt: doc.createdAt.toISOString(),
});
