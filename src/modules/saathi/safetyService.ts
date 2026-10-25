import { INDIA_CRISIS_RESOURCES, formatCrisisResourcesForUser } from "./crisisResources";

export type SafetyLevel = "NORMAL" | "ELEVATED" | "IMMEDIATE" | "OUT_OF_SCOPE";

export type SafetyAssessment = {
  level: SafetyLevel;
  reasons: string[];
  /** When IMMEDIATE/ELEVATED, preferred user-facing reply (may be refined by orchestrator). */
  suggestedReply?: string;
};

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

/** Lightweight contextual heuristics — not a clinical assessment and not keyword-only. */
export const assessSafety = (message: string, recentUserTexts: string[] = []): SafetyAssessment => {
  const text = normalize(message);
  const window = normalize([message, ...recentUserTexts.slice(-4)].join(" "));

  const negation =
    /\b(not|never|no longer|didn't|did not|nahi|नहीं)\b/.test(text) &&
    /\b(kill|suicide|die|harm|hurt)\b/.test(text);

  const immediatePatterns = [
    /\b(kill myself|kys|end my life|suicide|suicidal)\b/,
    /\b(want to die|gonna die|going to die|end it all)\b/,
    /\b(hang myself|overdose|slit my|cut myself badly)\b/,
    /\b(marna chahta|marna chahti|jaan de|khudkushi|aatmahatya)\b/,
    /\b(i have a plan to (die|kill)|attempt(ing)? suicide)\b/,
    /\b(going to (hurt|kill) (him|her|them|someone))\b/,
  ];

  const elevatedPatterns = [
    /\b(self[- ]?harm|cutting myself|hurt myself)\b/,
    /\b(no reason to live|better off dead|can't go on|cant go on)\b/,
    /\b(hopeless|worthless|unbearable|can't cope|cant cope)\b/,
    /\b(jee nahi|jeene ka mann nahi|bahut bura lag|ghabrahat bahut)\b/,
  ];

  const outOfScopePatterns = [
    /\b(when will i (get )?married|shaadi kab)\b/,
    /\brecommend\b[\s\S]{0,40}\b(movie|book|series|song)s?\b/,
    /\b(write (me )?(code|python|javascript)|leetcode|debug my)\b/,
    /\b(who won the (match|election)|stock tip|crypto tip)\b/,
    /\b(homework answer|exam cheat)\b/,
  ];

  if (!negation) {
    for (const re of immediatePatterns) {
      if (re.test(text) || re.test(window)) {
        return {
          level: "IMMEDIATE",
          reasons: ["credible_imminent_harm_language"],
          suggestedReply: immediateReply(),
        };
      }
    }
  }

  for (const re of outOfScopePatterns) {
    if (re.test(text)) {
      return {
        level: "OUT_OF_SCOPE",
        reasons: ["non_wellness_request"],
        suggestedReply:
          "Main mental wellness pe focus karta/karti hoon — stress, neend, ghabrahat, overthinking. Usse related kuch share karo; shaadi predictions, movies, ya coding tips mere scope mein nahi hain.",
      };
    }
  }

  for (const re of elevatedPatterns) {
    if (re.test(text) || re.test(window)) {
      return {
        level: "ELEVATED",
        reasons: ["severe_distress_language"],
        suggestedReply: elevatedReply(),
      };
    }
  }

  return { level: "NORMAL", reasons: [] };
};

const immediateReply = (): string =>
  [
    "I'm really glad you told me. Your safety comes first — I'm an AI companion, not a crisis service or a doctor.",
    "If you might hurt yourself or someone else, or you're in danger right now, please contact help immediately:",
    formatCrisisResourcesForUser(),
    "If you can, reach a trusted person nearby. You don't have to face this alone.",
  ].join("\n\n");

const elevatedReply = (): string =>
  [
    "That sounds incredibly heavy. I'm here with you, without judgment.",
    "Are you safe right now, or do you feel like you might hurt yourself?",
    "If things feel urgent, these lines can help:",
    INDIA_CRISIS_RESOURCES.map((r) => `${r.label}: ${r.phone}`).join(" · "),
    "We can also slow your breathing together, or I can help you find a verified psychologist when you're ready.",
  ].join("\n\n");

export const shouldPersistWellnessMemory = (assessment: SafetyAssessment): boolean =>
  assessment.level === "NORMAL" || assessment.level === "ELEVATED";
