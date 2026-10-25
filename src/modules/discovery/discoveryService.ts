import { Prisma, PsychologistAccountStatus, PsychologistPublicationStatus, SpecialisationCode } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { fail } from "../../lib/errors";
import { isPsychologistBookable } from "../staff/psychologistService";
import { toPublicPsychologistDto } from "./publicPsychologistDto";

const listInclude = {
  specialisations: true,
  languages: true,
  checks: true,
} satisfies Prisma.PsychologistProfileInclude;

export const listBookablePsychologists = async (input: {
  page: number;
  pageSize: number;
  specialisation?: SpecialisationCode;
}) => {
  const candidates = await prisma.psychologistProfile.findMany({
    where: {
      publicationStatus: PsychologistPublicationStatus.LIVE,
      accountStatus: PsychologistAccountStatus.ACTIVE,
      ...(input.specialisation
        ? { specialisations: { some: { code: input.specialisation } } }
        : {}),
    },
    include: listInclude,
    orderBy: { publishedAt: "desc" },
  });

  const bookable = candidates.filter((p) => isPsychologistBookable(p));
  const total = bookable.length;
  const start = (input.page - 1) * input.pageSize;
  const pageItems = bookable.slice(start, start + input.pageSize);

  return {
    items: pageItems.map(toPublicPsychologistDto),
    page: input.page,
    pageSize: input.pageSize,
    total,
  };
};

export const getBookablePsychologistById = async (psychologistProfileId: string) => {
  const profile = await prisma.psychologistProfile.findUnique({
    where: { id: psychologistProfileId },
    include: listInclude,
  });
  if (!profile || !isPsychologistBookable(profile)) {
    fail(404, "Psychologist not found");
  }
  return toPublicPsychologistDto(profile);
};
