-- CreateEnum
CREATE TYPE "CommunicationMode" AS ENUM ('CHAT', 'VOICE', 'VIDEO');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "CancelledByParty" AS ENUM ('CUSTOMER', 'PSYCHOLOGIST', 'STAFF', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'INTERRUPTED', 'CANCELLED', 'NO_SHOW', 'DISPUTED');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('CUSTOMER', 'PSYCHOLOGIST');

-- CreateEnum
CREATE TYPE "AttendanceEventType" AS ENUM ('JOINED', 'LEFT', 'RECONNECTED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('NOT_APPLICABLE', 'CONSENT_PENDING', 'CONSENTED', 'RECORDING', 'AVAILABLE', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "OrderPurpose" AS ENUM ('PSYCHOLOGIST_BOOKING', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('RAZORPAY', 'STRIPE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'AUTHORIZED', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('CUSTOMER_CANCEL', 'CUSTOMER_LATE_CANCEL', 'PSYCHOLOGIST_CANCEL', 'PSYCHOLOGIST_NO_SHOW', 'COMPLAINT_FULL', 'COMPLAINT_PARTIAL', 'PAYMENT_AFTER_SLOT_RELEASED', 'ADMIN_ADJUSTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatusChangeSource" AS ENUM ('WEBHOOK', 'PROVIDER_API', 'RECONCILIATION', 'ADMIN');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'TRIALING', 'TRIAL_EXPIRED', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PlanInterval" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ComplaintCategory" AS ENUM ('SILENT_PSYCHOLOGIST', 'INAUDIBLE', 'UNRESPONSIVE', 'DISRUPTED', 'NOT_DELIVERED', 'OTHER');

-- CreateEnum
CREATE TYPE "ComplaintDecision" AS ENUM ('FULL_REFUND', 'PARTIAL_REFUND', 'NO_REFUND', 'FREE_RESCHEDULE');

-- CreateTable
CREATE TABLE "PsychologistBooking" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "psychologistProfileId" UUID NOT NULL,
    "scheduledStartAt" TIMESTAMPTZ(6) NOT NULL,
    "scheduledEndAt" TIMESTAMPTZ(6) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 40,
    "communicationMode" "CommunicationMode" NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "reservationExpiresAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelledByParty" "CancelledByParty",
    "cancellationReason" VARCHAR(1000),
    "policyVersion" VARCHAR(32) NOT NULL,
    "policySnapshot" JSONB,
    "rescheduledFromBookingId" UUID,
    "customerRescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "isFreeProviderReschedule" BOOLEAN NOT NULL DEFAULT false,
    "problemSnapshot" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PsychologistBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PsychologistSession" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "actualStartedAt" TIMESTAMPTZ(6),
    "actualEndedAt" TIMESTAMPTZ(6),
    "attendanceVerified" BOOLEAN NOT NULL DEFAULT false,
    "attendanceVerifiedAt" TIMESTAMPTZ(6),
    "attendanceSummary" JSONB,
    "recordingStatus" "RecordingStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "recordingObjectKey" VARCHAR(512),
    "recordingStartedAt" TIMESTAMPTZ(6),
    "recordingEndedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PsychologistSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionRecordingConsent" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "participantRole" "ParticipantRole" NOT NULL,
    "userId" UUID,
    "psychologistProfileId" UUID,
    "consentedAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "SessionRecordingConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceEvent" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "participantRole" "ParticipantRole" NOT NULL,
    "userId" UUID,
    "psychologistProfileId" UUID,
    "eventType" "AttendanceEventType" NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "priceMinorUnits" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "interval" "PlanInterval" NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "razorpayPlanId" VARCHAR(64),
    "stripePriceId" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "billingMode" "BillingMode" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "PaymentProvider" NOT NULL,
    "providerSubscriptionId" VARCHAR(128),
    "trialStartsAt" TIMESTAMPTZ(6),
    "trialEndsAt" TIMESTAMPTZ(6),
    "currentPeriodStart" TIMESTAMPTZ(6),
    "currentPeriodEnd" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "OrderPurpose" NOT NULL,
    "bookingId" UUID,
    "subscriptionId" UUID,
    "amountMinorUnits" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerOrderId" VARCHAR(128),
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "idempotencyKey" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerPaymentId" VARCHAR(128),
    "amountMinorUnits" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "providerStatus" VARCHAR(64),
    "paidAt" TIMESTAMPTZ(6),
    "failedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "amountMinorUnits" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" "RefundReason" NOT NULL,
    "reasonDetail" VARCHAR(1000),
    "providerRefundId" VARCHAR(128),
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "initiatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentStatusHistory" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "oldStatus" "PaymentStatus",
    "newStatus" "PaymentStatus" NOT NULL,
    "source" "PaymentStatusChangeSource" NOT NULL,
    "providerEventId" VARCHAR(128),
    "metadata" JSONB,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerEventId" VARCHAR(128) NOT NULL,
    "eventType" VARCHAR(128) NOT NULL,
    "payload" JSONB NOT NULL,
    "processingStatus" "WebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),
    "lastError" VARCHAR(2000),

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PsychologistPayout" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "psychologistProfileId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "grossAmountMinorUnits" INTEGER NOT NULL,
    "psychologistShareMinorUnits" INTEGER NOT NULL,
    "platformShareMinorUnits" INTEGER NOT NULL,
    "splitVersion" VARCHAR(32) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerTransferId" VARCHAR(128),
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "initiatedAt" TIMESTAMPTZ(6),
    "paidAt" TIMESTAMPTZ(6),
    "lastError" VARCHAR(2000),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PsychologistPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionComplaint" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" "ComplaintCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "reviewerAccountId" UUID,
    "decision" "ComplaintDecision",
    "decisionRationale" TEXT,
    "paymentRefundId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "SessionComplaint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PsychologistBooking_userId_status_idx" ON "PsychologistBooking"("userId", "status");

-- CreateIndex
CREATE INDEX "PsychologistBooking_psychologistProfileId_scheduledStartAt_idx" ON "PsychologistBooking"("psychologistProfileId", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "PsychologistBooking_status_reservationExpiresAt_idx" ON "PsychologistBooking"("status", "reservationExpiresAt");

-- CreateIndex
CREATE INDEX "PsychologistBooking_rescheduledFromBookingId_idx" ON "PsychologistBooking"("rescheduledFromBookingId");

-- CreateIndex
CREATE UNIQUE INDEX "PsychologistSession_bookingId_key" ON "PsychologistSession"("bookingId");

-- CreateIndex
CREATE INDEX "PsychologistSession_status_idx" ON "PsychologistSession"("status");

-- CreateIndex
CREATE INDEX "SessionRecordingConsent_sessionId_idx" ON "SessionRecordingConsent"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRecordingConsent_sessionId_participantRole_key" ON "SessionRecordingConsent"("sessionId", "participantRole");

-- CreateIndex
CREATE INDEX "AttendanceEvent_sessionId_occurredAt_idx" ON "AttendanceEvent"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "AttendanceEvent_sessionId_participantRole_occurredAt_idx" ON "AttendanceEvent"("sessionId", "participantRole", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE INDEX "Subscription_userId_status_idx" ON "Subscription"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_userId_status_idx" ON "Order"("userId", "status");

-- CreateIndex
CREATE INDEX "Order_bookingId_idx" ON "Order"("bookingId");

-- CreateIndex
CREATE INDEX "Order_subscriptionId_idx" ON "Order"("subscriptionId");

-- CreateIndex
CREATE INDEX "Payment_orderId_status_idx" ON "Payment"("orderId", "status");

-- CreateIndex
CREATE INDEX "PaymentRefund_paymentId_status_idx" ON "PaymentRefund"("paymentId", "status");

-- CreateIndex
CREATE INDEX "PaymentStatusHistory_paymentId_changedAt_idx" ON "PaymentStatusHistory"("paymentId", "changedAt");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_processingStatus_receivedAt_idx" ON "PaymentWebhookEvent"("processingStatus", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_providerEventId_key" ON "PaymentWebhookEvent"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "PsychologistPayout_sessionId_key" ON "PsychologistPayout"("sessionId");

-- CreateIndex
CREATE INDEX "PsychologistPayout_psychologistProfileId_status_idx" ON "PsychologistPayout"("psychologistProfileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SessionComplaint_paymentRefundId_key" ON "SessionComplaint"("paymentRefundId");

-- CreateIndex
CREATE INDEX "SessionComplaint_sessionId_idx" ON "SessionComplaint"("sessionId");

-- CreateIndex
CREATE INDEX "SessionComplaint_status_idx" ON "SessionComplaint"("status");

-- CreateIndex
CREATE INDEX "SessionComplaint_reviewerAccountId_idx" ON "SessionComplaint"("reviewerAccountId");

-- AddForeignKey
ALTER TABLE "PsychologistBooking" ADD CONSTRAINT "PsychologistBooking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychologistBooking" ADD CONSTRAINT "PsychologistBooking_psychologistProfileId_fkey" FOREIGN KEY ("psychologistProfileId") REFERENCES "PsychologistProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychologistBooking" ADD CONSTRAINT "PsychologistBooking_rescheduledFromBookingId_fkey" FOREIGN KEY ("rescheduledFromBookingId") REFERENCES "PsychologistBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychologistSession" ADD CONSTRAINT "PsychologistSession_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "PsychologistBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRecordingConsent" ADD CONSTRAINT "SessionRecordingConsent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PsychologistSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRecordingConsent" ADD CONSTRAINT "SessionRecordingConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRecordingConsent" ADD CONSTRAINT "SessionRecordingConsent_psychologistProfileId_fkey" FOREIGN KEY ("psychologistProfileId") REFERENCES "PsychologistProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PsychologistSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_psychologistProfileId_fkey" FOREIGN KEY ("psychologistProfileId") REFERENCES "PsychologistProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "PsychologistBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentStatusHistory" ADD CONSTRAINT "PaymentStatusHistory_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychologistPayout" ADD CONSTRAINT "PsychologistPayout_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PsychologistSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychologistPayout" ADD CONSTRAINT "PsychologistPayout_psychologistProfileId_fkey" FOREIGN KEY ("psychologistProfileId") REFERENCES "PsychologistProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychologistPayout" ADD CONSTRAINT "PsychologistPayout_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionComplaint" ADD CONSTRAINT "SessionComplaint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PsychologistSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionComplaint" ADD CONSTRAINT "SessionComplaint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionComplaint" ADD CONSTRAINT "SessionComplaint_reviewerAccountId_fkey" FOREIGN KEY ("reviewerAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionComplaint" ADD CONSTRAINT "SessionComplaint_paymentRefundId_fkey" FOREIGN KEY ("paymentRefundId") REFERENCES "PaymentRefund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Custom constraints (not expressible in Prisma schema)
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "PsychologistBooking"
ADD CONSTRAINT "psychologist_booking_no_overlap"
EXCLUDE USING gist (
  "psychologistProfileId" WITH =,
  tstzrange("scheduledStartAt", "scheduledEndAt", '[)') WITH &&
)
WHERE (status IN ('PENDING_PAYMENT', 'CONFIRMED'));

ALTER TABLE "Order"
ADD CONSTRAINT "order_single_purpose_target" CHECK (
  ("purpose" = 'PSYCHOLOGIST_BOOKING' AND "bookingId" IS NOT NULL AND "subscriptionId" IS NULL)
  OR
  ("purpose" = 'SUBSCRIPTION' AND "subscriptionId" IS NOT NULL AND "bookingId" IS NULL)
);

ALTER TABLE "AttendanceEvent"
ADD CONSTRAINT "attendance_participant_identity" CHECK (
  ("participantRole" = 'CUSTOMER' AND "userId" IS NOT NULL AND "psychologistProfileId" IS NULL)
  OR
  ("participantRole" = 'PSYCHOLOGIST' AND "psychologistProfileId" IS NOT NULL AND "userId" IS NULL)
);

ALTER TABLE "SessionRecordingConsent"
ADD CONSTRAINT "recording_consent_participant_identity" CHECK (
  ("participantRole" = 'CUSTOMER' AND "userId" IS NOT NULL AND "psychologistProfileId" IS NULL)
  OR
  ("participantRole" = 'PSYCHOLOGIST' AND "psychologistProfileId" IS NOT NULL AND "userId" IS NULL)
);

ALTER TABLE "PaymentRefund" ADD CONSTRAINT "refund_amount_positive" CHECK ("amountMinorUnits" > 0);

ALTER TABLE "PsychologistPayout"
ADD CONSTRAINT "payout_shares_sum" CHECK (
  "psychologistShareMinorUnits" + "platformShareMinorUnits" = "grossAmountMinorUnits"
);

CREATE UNIQUE INDEX "order_one_active_per_booking"
ON "Order" ("bookingId")
WHERE "status" IN ('CREATED', 'PENDING') AND "bookingId" IS NOT NULL;

CREATE UNIQUE INDEX "payment_provider_payment_id"
ON "Payment" ("provider", "providerPaymentId")
WHERE "providerPaymentId" IS NOT NULL;

CREATE UNIQUE INDEX "order_provider_order_id"
ON "Order" ("provider", "providerOrderId")
WHERE "providerOrderId" IS NOT NULL;

CREATE UNIQUE INDEX "subscription_provider_subscription_id"
ON "Subscription" ("provider", "providerSubscriptionId")
WHERE "providerSubscriptionId" IS NOT NULL;

CREATE UNIQUE INDEX "payout_provider_transfer_id"
ON "PsychologistPayout" ("provider", "providerTransferId")
WHERE "providerTransferId" IS NOT NULL;

CREATE UNIQUE INDEX "refund_provider_refund_id"
ON "PaymentRefund" ("provider", "providerRefundId")
WHERE "providerRefundId" IS NOT NULL;

INSERT INTO "SubscriptionPlan" ("id", "code", "name", "priceMinorUnits", "currency", "interval", "durationDays", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'MONTHLY', 'Monthly', 19900, 'INR', 'MONTHLY', 30, true, NOW(), NOW()),
  (gen_random_uuid(), 'QUARTERLY', '3 Months', 49900, 'INR', 'QUARTERLY', 90, true, NOW(), NOW()),
  (gen_random_uuid(), 'YEARLY', 'Yearly', 139900, 'INR', 'YEARLY', 365, true, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
