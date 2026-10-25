-- AlterTable
ALTER TABLE "PaymentRefund" ADD COLUMN "idempotencyKey" VARCHAR(64);

-- AlterTable
ALTER TABLE "SessionComplaint" ADD COLUMN "replacementBookingId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_idempotencyKey_key" ON "PaymentRefund"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SessionComplaint_replacementBookingId_key" ON "SessionComplaint"("replacementBookingId");

-- AddForeignKey
ALTER TABLE "SessionComplaint" ADD CONSTRAINT "SessionComplaint_replacementBookingId_fkey" FOREIGN KEY ("replacementBookingId") REFERENCES "PsychologistBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
