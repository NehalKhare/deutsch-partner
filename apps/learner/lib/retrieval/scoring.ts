import { CEFR_LEVELS, type CEFRLevel } from "@dp/domain/cefr";
import type {
  KnowledgeContentType,
  RetrievalContext,
} from "@dp/domain/retrieval";
import { isPreferredType } from "@/lib/retrieval/filters";

/**
 * Ranking a candidate for a particular learner.
 *
 * Similarity is the largest single term and deliberately not the only one.
 * A vector store asked "why is it mit dem Zug" will happily return the most
 * semantically similar thing in the corpus, and for a corpus that spans A1 to
 * B1 that is frequently a B1 explanation of prepositional case government —
 * which is the correct answer to the question and the wrong answer for the
 * person asking it.
 *
 * So the score also carries who is asking: what level they are at, what they
 * are currently working on, and what they keep getting wrong. Every term is a
 * pure function of a candidate and a context, which is what makes a ranking
 * decision explainable after the fact rather than merely observed.
 */

export interface RetrievalCandidate {
  readonly id: number;
  readonly documentId: number;
  readonly content: string;
  readonly cefr: CEFRLevel | null;
  readonly miniLevel: number | null;
  readonly topic: string | null;
  readonly skill: string | null;
  readonly grammarTarget: string | null;
  readonly contentType: KnowledgeContentType;
  readonly difficulty: number | null;
  readonly tokenCount: number | null;
  /** 0 to 1, from whichever arm found it, after fusion. */
  readonly similarity: number;
}

export interface ScoreBreakdown {
  readonly similarity: number;
  readonly levelFit: number;
  readonly typeFit: number;
  readonly grammarFit: number;
  readonly topicFit: number;
  readonly weaknessFit: number;
  readonly vocabularyFit: number;
}

export interface ScoredCandidate {
  readonly candidate: RetrievalCandidate;
  readonly score: number;
  /** Kept so a ranking can be explained rather than only observed. */
  readonly breakdown: ScoreBreakdown;
}

/**
 * Weights, summing to one.
 *
 * Similarity is half. The learner-aware terms together are the other half,
 * which is the difference between a vector store and a tutor: enough to move a
 * well-matched on-level chunk above a slightly better-matched off-level one,
 * not enough to promote something that is simply not about the question.
 */
export const WEIGHTS = {
  similarity: 0.5,
  level: 0.2,
  type: 0.12,
  grammar: 0.08,
  topic: 0.04,
  weakness: 0.04,
  vocabulary: 0.02,
} as const;

/** One band up is a stretch; one band down is review; two of either is neither. */
const BAND_FIT: Readonly<Record<number, number>> = {
  0: 1,
  [-1]: 0.7,
  [-2]: 0.45,
  1: 0.3,
  2: 0.05,
};

/** Roughly one CEFR band's worth of mini-levels. */
const MINI_LEVEL_SPAN = 14;

function bandFit(learner: CEFRLevel, chunk: CEFRLevel | null): number {
  // An unlabelled chunk is not penalised and not rewarded: it is usable, and
  // pretending to know its level would be worse than admitting we do not.
  if (chunk === null) return 0.5;

  const distance = CEFR_LEVELS.indexOf(chunk) - CEFR_LEVELS.indexOf(learner);

  return BAND_FIT[distance] ?? 0;
}

function miniLevelFit(learner: number, chunk: number | null): number {
  if (chunk === null) return 0.5;

  const distance = chunk - learner;
  // Above costs twice as much as below. Material a learner has passed is worth
  // revisiting; material they have not reached is worth very little to them
  // today, however well it matches.
  const penalty = distance > 0 ? distance * 2 : -distance;

  return Math.max(0, 1 - penalty / MINI_LEVEL_SPAN);
}

export function levelFit(
  context: RetrievalContext,
  candidate: RetrievalCandidate,
): number {
  return (
    0.6 * bandFit(context.cefr, candidate.cefr) +
    0.4 * miniLevelFit(context.miniLevel, candidate.miniLevel)
  );
}

function grammarFit(
  context: RetrievalContext,
  candidate: RetrievalCandidate,
): number {
  if (candidate.grammarTarget === null) return 0;

  // What the learner keeps getting wrong outranks what the level happens to
  // be teaching: a recurring mistake is a request for help nobody typed.
  if (context.weakGrammarKeys.includes(candidate.grammarTarget)) return 1;
  if (context.currentLessonTarget === candidate.grammarTarget) return 0.7;

  return 0;
}

function weaknessFit(
  context: RetrievalContext,
  candidate: RetrievalCandidate,
): number {
  if (context.recurringErrorTypes.length === 0) return 0;

  // The error taxonomy and the grammar slugs do not share a vocabulary, so
  // this matches on the shared words rather than pretending they do.
  const haystack = `${candidate.grammarTarget ?? ""} ${candidate.skill ?? ""}`.toLowerCase();

  return context.recurringErrorTypes.some((type) =>
    type
      .split("_")
      .filter((part) => part.length > 3)
      .some((part) => haystack.includes(part)),
  )
    ? 1
    : 0;
}

function vocabularyFit(
  context: RetrievalContext,
  candidate: RetrievalCandidate,
): number {
  if (context.targetVocabularyLemmas.length === 0) return 0;

  const content = candidate.content.toLowerCase();
  const hits = context.targetVocabularyLemmas.filter((lemma) =>
    content.includes(lemma.toLowerCase()),
  ).length;

  // Saturating: one target word in a chunk is a signal, five is not five
  // times the signal.
  return Math.min(1, hits / 3);
}

export function scoreCandidate(
  context: RetrievalContext,
  candidate: RetrievalCandidate,
): ScoredCandidate {
  const breakdown: ScoreBreakdown = {
    similarity: Math.max(0, Math.min(1, candidate.similarity)),
    levelFit: levelFit(context, candidate),
    typeFit: isPreferredType(context.intent, candidate.contentType) ? 1 : 0.25,
    grammarFit: grammarFit(context, candidate),
    topicFit:
      context.topic !== undefined && candidate.topic === context.topic ? 1 : 0,
    weaknessFit: weaknessFit(context, candidate),
    vocabularyFit: vocabularyFit(context, candidate),
  };

  return {
    candidate,
    score:
      WEIGHTS.similarity * breakdown.similarity +
      WEIGHTS.level * breakdown.levelFit +
      WEIGHTS.type * breakdown.typeFit +
      WEIGHTS.grammar * breakdown.grammarFit +
      WEIGHTS.topic * breakdown.topicFit +
      WEIGHTS.weakness * breakdown.weaknessFit +
      WEIGHTS.vocabulary * breakdown.vocabularyFit,
    breakdown,
  };
}

export function rankCandidates(
  context: RetrievalContext,
  candidates: readonly RetrievalCandidate[],
): readonly ScoredCandidate[] {
  return candidates
    .map((candidate) => scoreCandidate(context, candidate))
    // Ties broken by id, so the same query returns the same order twice. A
    // ranking that shuffles under a tie is a ranking nobody can debug.
    .sort((a, b) => b.score - a.score || a.candidate.id - b.candidate.id);
}
