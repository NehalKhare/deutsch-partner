import { CEFR_LEVELS, type CEFRLevel } from "@/domain/cefr";
import type {
  KnowledgeContentType,
  RetrievalContext,
  RetrievalIntent,
} from "@/domain/retrieval";

/**
 * What is eligible to be retrieved for a learner, before anything is ranked.
 *
 * Filtering first is the whole point. Rank first and filter after, and the
 * candidate list is whatever the corpus happens to be most similar to, which
 * for a beginner's question is very often a B1 explanation that answers it
 * perfectly in words they cannot read.
 */

/**
 * How far above the current mini-level a chunk may still be shown.
 *
 * The 80/20 principle from the business objective: mostly at the learner's
 * level, a little beyond it. Small, because "a little beyond" is the next
 * lesson and not the next band.
 */
export const MINI_LEVEL_LOOKAHEAD = 6;

/**
 * Where each kind of question is best answered from.
 *
 * These are preferences, not a whitelist. A grammar question is usually
 * answered by a grammar explanation, but the dialogue that demonstrates the
 * point is often the better answer, so the other types stay eligible and are
 * weighted down instead of removed.
 */
export const PREFERRED_TYPES: Readonly<
  Record<RetrievalIntent, readonly KnowledgeContentType[]>
> = {
  vocabulary: ["vocabulary", "sentence_pattern"],
  grammar: ["grammar", "mistake_pattern", "sentence_pattern"],
  conversation: ["dialogue", "situation", "conversation_function", "curriculum"],
  culture: ["culture", "situation"],
  // Nothing local answers a question about today. The corpus is pedagogical
  // content, not news, and pretending otherwise is how a tutor states last
  // year's train fare as fact.
  web: [],
};

export interface CandidateFilter {
  /** The bands a chunk may carry. Null means unfiltered. */
  readonly cefr: readonly CEFRLevel[];
  readonly maxMiniLevel: number;
  /** Null when every type is eligible; the intent narrows nothing by itself. */
  readonly contentTypes: readonly KnowledgeContentType[] | null;
}

/**
 * The bands a learner may be shown.
 *
 * Everything at or below their own, because earlier material is what review
 * and reinforcement are made of, plus exactly one band above. Two bands above
 * is not a stretch, it is a different language course.
 */
export function eligibleBands(cefr: CEFRLevel): readonly CEFRLevel[] {
  const index = CEFR_LEVELS.indexOf(cefr);

  return CEFR_LEVELS.slice(0, index + 2);
}

export function candidateFilter(context: RetrievalContext): CandidateFilter {
  return {
    cefr: eligibleBands(context.cefr),
    maxMiniLevel: context.miniLevel + MINI_LEVEL_LOOKAHEAD,
    // Deliberately null: the intent shapes the score, not the candidate set.
    contentTypes: null,
  };
}

/** True when this kind of content is what the intent normally wants. */
export function isPreferredType(
  intent: RetrievalIntent,
  contentType: KnowledgeContentType,
): boolean {
  return PREFERRED_TYPES[intent].includes(contentType);
}
