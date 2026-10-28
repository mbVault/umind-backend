import { AudioCategory, User } from "@prisma/client";
import { recommendAudioForUser } from "../audio/audioQuery";

/** Map the user's opening issue to preferred Listen categories (best-first). */
export const inferIssueCategories = (message: string): AudioCategory[] => {
  const t = message.toLowerCase();

  const hits: { cat: AudioCategory; score: number }[] = [];
  const bump = (cat: AudioCategory, score: number) => {
    const row = hits.find((h) => h.cat === cat);
    if (row) row.score += score;
    else hits.push({ cat, score });
  };

  if (/\b(sleep|neend|nind|insomnia|raat|night|restless)\b/.test(t)) bump(AudioCategory.SLEEP, 3);
  if (/\b(anxiet|ghabrahat|panic|racing heart|dil tez|overthink|worry|worried)\b/.test(t)) {
    bump(AudioCategory.ANXIETY, 3);
  }
  if (/\b(stress|exam|padhai|deadline|burnout|pressure|kaam)\b/.test(t)) bump(AudioCategory.STRESS, 3);
  if (/\b(focus|concentrate|distracted|padh nahi)\b/.test(t)) bump(AudioCategory.FOCUS, 2);
  if (/\b(relationship|ghar|ladai|breakup|lonely|akela|family|papa|mummy|partner)\b/.test(t)) {
    bump(AudioCategory.RELATIONSHIPS, 3);
  }
  if (/\b(body|pain|headache|thakaan|tired|fatigue)\b/.test(t)) bump(AudioCategory.BODY, 2);
  if (/\b(period|cycle|pms|cramp)\b/.test(t)) bump(AudioCategory.HER_CYCLE, 3);

  hits.sort((a, b) => b.score - a.score);
  const ordered = hits.map((h) => h.cat);
  // Soft defaults when we can't infer — stress/anxiety are common openers.
  if (ordered.length === 0) {
    return [AudioCategory.STRESS, AudioCategory.ANXIETY, AudioCategory.SLEEP];
  }
  return ordered;
};

export type FirstReplyAudio = Awaited<ReturnType<typeof recommendAudioForUser>>;

/** Prefer tracks whose category matches the opening issue; always try to return ≥1 when catalogue allows. */
export const pickFirstReplyAudio = async (
  user: User,
  openingMessage: string,
): Promise<FirstReplyAudio> => {
  const preferred = inferIssueCategories(openingMessage);
  const pool = await recommendAudioForUser(user, { limit: 20 });
  if (pool.length === 0) return [];

  const ranked = [...pool].sort((a, b) => {
    const ai = preferred.indexOf(a.category);
    const bi = preferred.indexOf(b.category);
    const as = ai === -1 ? 99 : ai;
    const bs = bi === -1 ? 99 : bi;
    return as - bs;
  });

  return ranked.slice(0, 1);
};

/** Short empathy-only opener; audio card carries the “do this next” action. */
export const buildFirstReplyEmpathyText = (input: {
  alias: string;
  language: string;
  userMessage: string;
  audioTitle: string | null;
}): string => {
  const hinglish = input.language === "HINGLISH" || input.language === "HINDI";
  const snippet = input.userMessage.trim().slice(0, 80);
  const listenBit = input.audioTitle
    ? hinglish
      ? ` Iske liye ek short listen hai: “${input.audioTitle}”.`
      : ` Here's a short listen for this: “${input.audioTitle}”.`
    : hinglish
      ? " Jab ready ho, Listen mein ek short session try kar sakte ho."
      : " When you're ready, you can try a short session in Listen.";

  if (hinglish) {
    return `Hey ${input.alias}, main yahan hoon — “${snippet}${input.userMessage.length > 80 ? "…" : ""}” sun ke lagta hai yeh bhaari hai.${listenBit} Baad mein jo mann kare, bata dena.`;
  }

  return `Hey ${input.alias}, I'm here with you — hearing “${snippet}${input.userMessage.length > 80 ? "…" : ""}” sounds heavy.${listenBit} We can talk more whenever you're ready.`;
};
