import { triageMessage, type TriageReason } from "@/lib/ai/evaluation/triage";

/**
 * Deciding whether a trainer turn carries German worth analyzing.
 *
 * The analyzer is a model call in the reply path, so the gate is deterministic
 * and errs on the cheap side, per the triage module's own rule: a cheap model
 * deciding whether to call another cheap model is two calls where one would
 * do. Triage removes what carries no signal at all — empty, formulaic, too
 * short — and the German check removes the messages that are plainly English:
 * a question about grammar asked in English has nothing for a grammar checker
 * to check.
 */

export type AnalysisGateReason = TriageReason | "not_german";

export type AnalysisGate =
  | { readonly analyze: true }
  | { readonly analyze: false; readonly reason: AnalysisGateReason };

/**
 * Function words, not vocabulary: a learner's German answer at any level
 * carries articles, pronouns or auxiliaries, while an English sentence about
 * German usually quotes content words alone. Lowercased, matched whole.
 */
const GERMAN_SIGNALS = new Set([
  "der", "die", "das", "den", "dem", "des",
  "ein", "eine", "einen", "einem", "einer",
  "ich", "du", "er", "sie", "es", "wir", "ihr",
  "mich", "dich", "mir", "dir", "uns", "euch", "ihnen",
  "mein", "meine", "dein", "deine", "sein", "seine", "kein", "keine",
  "bin", "bist", "ist", "sind", "seid",
  "habe", "hast", "hat", "haben", "habt",
  "war", "waren", "wird", "werden", "wurde",
  "kann", "kannst", "muss", "musst", "will", "möchte", "mag", "soll", "darf",
  "nicht", "und", "oder", "aber", "auch", "sehr", "schon", "noch",
  "mit", "auf", "in", "im", "an", "am", "zu", "zum", "zur", "bei", "beim",
  "für", "von", "vom", "nach", "über", "unter", "aus",
  "heute", "morgen", "gestern", "jetzt", "hier", "dort",
  "was", "wer", "wie", "wo", "wann", "warum", "weil", "dass", "wenn",
]);

/** ä, ö, ü, ß in either case: a letter English never writes. */
const GERMAN_LETTERS = /[äöüßÄÖÜẞ]/u;

export function shouldAnalyze(message: string): AnalysisGate {
  const triage = triageMessage(message);
  if (!triage.evaluate) return { analyze: false, reason: triage.reason };

  if (GERMAN_LETTERS.test(message)) return { analyze: true };

  const words = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  if (words.some((word) => GERMAN_SIGNALS.has(word))) return { analyze: true };

  return { analyze: false, reason: "not_german" };
}
