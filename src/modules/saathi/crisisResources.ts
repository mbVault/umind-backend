/** India crisis resources — single source of truth (not scattered in prompts/UI copy alone). */
export type CrisisResource = {
  id: string;
  label: string;
  phone: string;
  note: string;
};

export const INDIA_CRISIS_RESOURCES: CrisisResource[] = [
  {
    id: "emergency",
    label: "Emergency",
    phone: "112",
    note: "Immediate emergency assistance in India",
  },
  {
    id: "tele_manas",
    label: "Tele-MANAS",
    phone: "14416",
    note: "National mental-health support helpline — free, 24×7",
  },
];

export const formatCrisisResourcesForUser = (): string =>
  INDIA_CRISIS_RESOURCES.map((r) => `${r.label}: ${r.phone} (${r.note})`).join("\n");
