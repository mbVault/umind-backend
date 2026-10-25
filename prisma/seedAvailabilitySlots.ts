/**
 * Dev seed: open availability slots for all LIVE bookable psychologist profiles.
 * Usage: npx tsx prisma/seedAvailabilitySlots.ts
 */
import { PsychologistAccountStatus, PsychologistPublicationStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { seedAvailabilitySlotsForPsychologist } from "../src/modules/bookings/availabilityService";
import { isPsychologistBookable } from "../src/modules/staff/psychologistService";

const main = async (): Promise<void> => {
  const profiles = await prisma.psychologistProfile.findMany({
    where: {
      publicationStatus: PsychologistPublicationStatus.LIVE,
      accountStatus: PsychologistAccountStatus.ACTIVE,
    },
    include: { specialisations: true, languages: true, checks: true },
  });

  let total = 0;
  for (const profile of profiles) {
    if (!isPsychologistBookable(profile)) {
      continue;
    }
    const count = await seedAvailabilitySlotsForPsychologist({
      psychologistProfileId: profile.id,
      daysAhead: 21,
    });
    total += count;
    console.log(`Seeded ${count} slots for ${profile.displayName ?? profile.id}`);
  }

  console.log(`Done. ${total} slots created (duplicates skipped).`);
};

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
