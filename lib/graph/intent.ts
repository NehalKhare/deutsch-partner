import { RETRIEVAL_INTENTS, type RetrievalIntent } from "@/domain/retrieval";

/**
 * Where a learner's question should be answered from.
 *
 * Deterministic first. The routing document pairs this task with the nano
 * tier, and a nano call is cheap rather than free — most learner messages
 * announce their own intent with a handful of words, and matching those costs
 * nothing and cannot hallucinate a label.
 *
 * The model is the fallback for the messages this cannot read, which is why
 * `classifyIntent` returns null rather than guessing: a wrong "culture" label
 * quietly changes which half of the corpus a learner can reach.
 */

interface Rule {
  readonly intent: RetrievalIntent;
  readonly pattern: RegExp;
}

/**
 * Ordered: the first match wins, and the more specific rules come first. A
 * question about a word ("was heißt trotzdem") is a vocabulary question even
 * though it is also, technically, a question.
 */
const RULES: readonly Rule[] = [
  // Anything anchored to now. The corpus is pedagogical content and has no
  // current facts in it, so this routes away from retrieval entirely.
  {
    intent: "web",
    pattern:
      /\b(heute|gerade jetzt|aktuell|momentan|neueste[nrs]?|dieses jahr|letzte woche|wetter|nachrichten|news|today|right now|latest|current)\b/iu,
  },
  {
    intent: "vocabulary",
    pattern:
      /\b(was (heißt|bedeutet)|wie sagt man|was ist der unterschied zwischen|synonym|übersetz|vokabel|wortschatz|what does .* mean|translate)\b/iu,
  },
  {
    intent: "grammar",
    pattern:
      /\b(warum (sagt|heißt|ist|steht)|wieso (sagt|heißt|ist)|grammatik|dativ|akkusativ|genitiv|nominativ|konjunktiv|passiv|perfekt|präteritum|plusquamperfekt|artikel|deklination|konjugation|wortstellung|why (is|do|does) .* (der|die|das|dem|den)|grammar|which case|welcher fall)\b/iu,
  },
  {
    intent: "culture",
    pattern:
      /\b(in deutschland|in österreich|in der schweiz|deutsche[nr]? (leute|kultur|sitten)|macht man das|üblich|höflich|unhöflich|feiertag|tradition|germans?( normally| usually)?|culture|custom|etiquette|polite)\b/iu,
  },
];

/**
 * A label, or null when nothing in the message says which one it is.
 *
 * Null means "ask a model", not "conversation". Defaulting an unreadable
 * message to conversation would be a guess dressed as a rule.
 */
export function classifyIntent(message: string): RetrievalIntent | null {
  const text = message.trim();
  if (text.length === 0) return null;

  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.intent;
  }

  // A statement rather than a question is somebody talking, which is the
  // product's whole point and the one intent worth defaulting to.
  return /[?？]/u.test(text) ? null : "conversation";
}

/** The label the graph falls back to when nothing else could decide. */
export const DEFAULT_INTENT: RetrievalIntent = "conversation";

export const isRetrievalIntent = (value: unknown): value is RetrievalIntent =>
  typeof value === "string" &&
  (RETRIEVAL_INTENTS as readonly string[]).includes(value);
