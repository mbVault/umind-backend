-- CreateTable
CREATE TABLE "PsychologistAvailabilitySlot" (
    "id" UUID NOT NULL,
    "psychologistProfileId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PsychologistAvailabilitySlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PsychologistAvailabilitySlot_psychologistProfileId_startsAt_key" ON "PsychologistAvailabilitySlot"("psychologistProfileId", "startsAt");

-- CreateIndex
CREATE INDEX "PsychologistAvailabilitySlot_psychologistProfileId_startsAt_idx" ON "PsychologistAvailabilitySlot"("psychologistProfileId", "startsAt");

-- AddForeignKey
ALTER TABLE "PsychologistAvailabilitySlot" ADD CONSTRAINT "PsychologistAvailabilitySlot_psychologistProfileId_fkey" FOREIGN KEY ("psychologistProfileId") REFERENCES "PsychologistProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
