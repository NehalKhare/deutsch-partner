/**
 * Deciding whether a message is worth evaluating at all.
 *
 * Evaluation runs once per learner message on the mid tier, which makes it the
 * second most expensive thing a turn does. A large share of learner messages
 * are "ja", "danke", "ok" or an emoji, and none of those carries a level
 * signal, a grammar signal or a mastery signal. Scoring them costs money and
 * produces noise that then moves a learner's estimated level.
 *
 * Deterministic, per model-routing-and-cost-control.md S7: a cheap model
 * deciding whether to call a mid model is two calls where one would do.
 */

export const TRIAGE_REASONS = [
  "empty",
  "no_letters",
  "too_short",
  "formulaic",
] as const;

export type TriageReason = (typeof TRIAGE_REASONS)[number];

export type Triage =
  | { readonly evaluate: true }
  | { readonly evaluate: false; readonly reason: TriageReason };

/**
 * Below this a message cannot demonstrate word order, case or agreement, which
 * is most of what evaluation looks for.
 */
export const MIN_EVALUABLE_WORDS = 3;

/**
 * Fixed phrases a learner reproduces without composing anything.
 *
 * Lowercased and stripped of punctuation before matching, and matched against
 * the whole message rather than against a word inside it: "danke" alone is
 * formulaic, "danke, dass du mir geholfen hast" is a subordinate clause.
 */
const FORMULAIC = new Set([
  "ja",
  "nein",
  "ok",
  "okay",
  "gut",
  "danke",
  "danke schön",
  "vielen dank",
  "bitte",
  "hallo",
  "hi",
  "servus",
  "moin",
  "guten morgen",
  "guten tag",
  "guten abend",
  "gute nacht",
  "tschüss",
  "tschüs",
  "auf wiedersehen",
  "bis später",
  "bis bald",
  "bis morgen",
  "genau",
  "klar",
  "stimmt",
  "alles klar",
  "kein problem",
  "natürlich",
  "vielleicht",
  "ich weiß nicht",
  "wie geht es dir",
  "wie geht's",
  "mir geht es gut",
  "yes",
  "no",
  "thanks",
  "thank you",
]);

/** Letters in any script, so an emoji-only or digits-only reply has none. */
const HAS_LETTER = /\p{L}/u;

function canonical(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function triageMessage(message: string): Triage {
  const trimmed = message.trim();

  if (trimmed.length === 0) return { evaluate: false, reason: "empty" };
  if (!HAS_LETTER.test(trimmed)) return { evaluate: false, reason: "no_letters" };

  const normalised = canonical(trimmed);

  // Checked before the word count: "wie geht es dir" is five words and still
  // says nothing about what this learner can produce.
  if (FORMULAIC.has(normalised)) return { evaluate: false, reason: "formulaic" };

  const words = normalised.split(" ").filter((word) => word.length > 0);
  if (words.length < MIN_EVALUABLE_WORDS) {
    return { evaluate: false, reason: "too_short" };
  }

  return { evaluate: true };
}
