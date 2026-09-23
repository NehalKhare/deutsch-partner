/**
 * Token counting for budget enforcement.
 *
 * This is an estimate, and it is deliberately biased high.
 *
 * There is no single correct answer: OpenRouter routes a tier to whichever
 * model is configured, and those models do not share a tokenizer. Shipping one
 * vendor's tokenizer would give an exact count for the wrong model. What the
 * budget actually needs is a bound it will not exceed, so this over-counts and
 * sheds a little early rather than under-counting and blowing a ceiling.
 *
 * German makes the usual chars-over-four rule of thumb dangerous:
 * Krankenversicherung is one word and several tokens, and umlauts and ß are
 * frequently multi-byte. The two terms below take the larger of a
 * character-based and a word-based estimate for that reason.
 *
 * Phase 10.5 may replace this with a per-model tokenizer behind the same
 * signature. Nothing outside this module should assume how the number is made.
 */

/** Deliberately below the common 4.0, because German runs token-dense. */
const CHARS_PER_TOKEN = 3.2;

/** Words rarely map to one token each once inflection and compounds are in. */
const TOKENS_PER_WORD = 1.45;

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;

  const words = trimmed.split(/\s+/u).length;

  return Math.max(
    1,
    Math.ceil(Math.max(trimmed.length / CHARS_PER_TOKEN, words * TOKENS_PER_WORD)),
  );
}

/** Cuts text to fit a token budget, on a word boundary where one is near. */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  if (estimateTokens(text) <= maxTokens) return text;

  const budgetChars = Math.floor(maxTokens * CHARS_PER_TOKEN);
  const hard = text.slice(0, budgetChars);
  const lastSpace = hard.lastIndexOf(" ");

  // Only prefer the word boundary if it does not throw most of the text away.
  const cut = lastSpace > budgetChars * 0.6 ? hard.slice(0, lastSpace) : hard;

  return cut.trimEnd();
}
