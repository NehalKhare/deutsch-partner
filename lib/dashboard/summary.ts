import { z } from "zod";

import {
  CEFR_LEVELS,
  cefrLevelSchema,
  miniLevelSchema,
  miniLevelRangeFor,
  type CEFRLevel,
} from "@/domain/cefr";
import { errorTypeSchema } from "@/domain/learner-error";
import { nonEmptyTextSchema, unitIntervalSchema, uuidSchema } from "@/domain/primitives";
import {
  rankCandidates,
  type Candidate,
  type RankedCandidate,
} from "@/learning/recommendation-ranking";
import { fail, ok, repositoryError, type RepositoryResult } from "@/repositories/errors";
import type { DatabaseClient } from "@/repositories/types";

/**
 * The learner's dashboard, aggregated in the database.
 *
 * One function call, one object, one consistent view. The alternative — six
 * queries and a reduce in a component — is six chances for the page to
 * disagree with itself and a render that cannot be cached.
 *
 * The result is validated on the way out like every other read. A dashboard is
 * the one screen a learner uses to decide whether the product is working, and
 * a silently wrong number there is worse than an error.
 */

const numeric = z.coerce.number();

export const learnerSummarySchema = z.object({
  level: z.object({
    selected: cefrLevelSchema,
    estimated: cefrLevelSchema.nullable(),
    effective: cefrLevelSchema,
    plus: z.boolean(),
    miniLevel: miniLevelSchema,
  }),
  miniLevel: z.object({
    number: miniLevelSchema,
    theme: nonEmptyTextSchema(80),
    focus: nonEmptyTextSchema(120),
    targetVocabulary: z.array(z.string()).max(30),
    conversationFunctions: z.array(z.string()).max(10),
  }),
  skills: z.object({
    fluency: unitIntervalSchema,
    comprehension: unitIntervalSchema,
    confidence: unitIntervalSchema,
  }),
  vocabulary: z.object({
    total: numeric.int().min(0),
    mastered: numeric.int().min(0),
    learning: numeric.int().min(0),
    due: numeric.int().min(0),
    weak: numeric.int().min(0),
  }),
  /** One entry per mini-level the learner has been evaluated at. */
  levelScores: z
    .array(
      z.object({
        miniLevel: miniLevelSchema,
        score: numeric.min(0).max(1),
        turns: numeric.int().min(0),
        strongTurns: numeric.int().min(0),
      }),
    )
    .max(70),
  recurringMistakes: z
    .array(
      z.object({
        errorType: errorTypeSchema,
        pattern: nonEmptyTextSchema(300),
        occurrences: numeric.int().min(1),
      }),
    )
    .max(5),
  recentThreads: z
    .array(
      z.object({
        id: uuidSchema,
        title: nonEmptyTextSchema(200),
        topic: nonEmptyTextSchema(64),
        updatedAt: z.coerce.date(),
      }),
    )
    .max(5),
  generatedAt: z.coerce.date(),
});

export type LearnerSummary = z.infer<typeof learnerSummarySchema>;

export interface DashboardRepository {
  /** No learner id: the function reads it from the verified session. */
  summary(now?: Date): Promise<RepositoryResult<LearnerSummary>>;
}

export function createDashboardRepository(
  client: DatabaseClient,
): DashboardRepository {
  return {
    async summary(now) {
      const outcome = await client.rpc("learner_dashboard", {
        p_now: (now ?? new Date()).toISOString(),
      });

      if (outcome.error) return fail(repositoryError("unavailable", outcome.error));
      if (outcome.data === null) return fail(repositoryError("not_found"));

      const parsed = learnerSummarySchema.safeParse(outcome.data);

      return parsed.success
        ? ok(parsed.data)
        : fail(repositoryError("invalid_data", parsed.error));
    },
  };
}

// --- what the levels amount to ------------------------------------------------

export interface BandScore {
  readonly level: CEFRLevel;
  /** Mini-levels in this band with at least one evaluated turn. */
  readonly practised: number;
  readonly of: number;
  /** The mean of the practised levels' scores, or null before any practice. */
  readonly averageScore: number | null;
}

/**
 * A band's score is the average of its mini-level scores.
 *
 * Averaged over the levels actually practised, not over all fifteen: a
 * learner three levels into A1 with strong scores has an A1 average worth
 * showing, and diluting it with twelve untouched zeros would report their
 * future as their past. How much of the band that average covers is said
 * beside it, so the number cannot pose as more than it is.
 *
 * Pure arithmetic over stored tallies — the routing document forbids a model
 * anywhere near a score.
 */
export function bandScores(
  levelScores: LearnerSummary["levelScores"],
): readonly BandScore[] {
  return CEFR_LEVELS.map((level) => {
    const { first, last } = miniLevelRangeFor(level);
    const inBand = levelScores.filter(
      (entry) => entry.miniLevel >= first && entry.miniLevel <= last && entry.turns > 0,
    );

    return {
      level,
      practised: inBand.length,
      of: last - first + 1,
      averageScore:
        inBand.length === 0
          ? null
          : inBand.reduce((sum, entry) => sum + entry.score, 0) / inBand.length,
    };
  });
}

/** The tally for the level the learner is standing on, if any turns exist. */
export function currentLevelTally(
  summary: Pick<LearnerSummary, "levelScores" | "level">,
): LearnerSummary["levelScores"][number] | null {
  return (
    summary.levelScores.find(
      (entry) => entry.miniLevel === summary.level.miniLevel && entry.turns > 0,
    ) ?? null
  );
}

// --- what to do next --------------------------------------------------------

/**
 * How far through the current mini-level the learner is.
 *
 * Against the level's own mastery criterion rather than against a global
 * number, because "five words" means something different at mini-level 3 and
 * at mini-level 60.
 */
export function levelProgress(
  summary: LearnerSummary,
  vocabularyTarget: number,
): number {
  if (vocabularyTarget <= 0) return 0;

  return Math.min(1, summary.vocabulary.mastered / vocabularyTarget);
}

/**
 * The candidates the deterministic ranker chooses between.
 *
 * Built from the summary, so what a learner is offered is a function of what
 * the dashboard is already showing them. A recommendation that cannot be
 * explained by the numbers on the same page is a recommendation nobody trusts.
 */
export function candidatesFor(
  summary: LearnerSummary,
  interests: readonly string[],
): readonly Candidate[] {
  const topMistake = summary.recurringMistakes[0];
  const matchesInterest = interests.includes(summary.miniLevel.theme.toLowerCase());

  const candidates: Candidate[] = [
    {
      activityType: "conversation",
      title: `Talk about ${summary.miniLevel.focus}`,
      reason: { kind: "level_progression", miniLevel: summary.level.miniLevel },
      inputs: {
        overdueReviewItems: 0,
        unresolvedErrors: 0,
        levelDistance: 0,
        matchesInterest,
        turnsSinceRecommended: null,
        addsDiversity: true,
      },
    },
  ];

  if (summary.vocabulary.due > 0) {
    candidates.push({
      activityType: "review",
      title: `Catch up on ${summary.vocabulary.due} word${summary.vocabulary.due === 1 ? "" : "s"}`,
      reason: { kind: "review_due", dueCount: summary.vocabulary.due },
      inputs: {
        overdueReviewItems: summary.vocabulary.due,
        unresolvedErrors: 0,
        levelDistance: 0,
        matchesInterest: false,
        turnsSinceRecommended: null,
        addsDiversity: true,
      },
    });
  }

  if (topMistake) {
    candidates.push({
      activityType: "grammar_drill",
      title: `Practise ${topMistake.errorType.replace(/_/gu, " ")}`,
      reason: { kind: "weakness", errorType: topMistake.errorType },
      inputs: {
        overdueReviewItems: 0,
        unresolvedErrors: summary.recurringMistakes.length,
        levelDistance: 0,
        matchesInterest: false,
        turnsSinceRecommended: null,
        addsDiversity: true,
      },
    });
  }

  if (summary.vocabulary.weak > 0) {
    candidates.push({
      activityType: "vocabulary_drill",
      title: `Work on ${summary.vocabulary.weak} tricky word${summary.vocabulary.weak === 1 ? "" : "s"}`,
      reason: { kind: "review_due", dueCount: summary.vocabulary.weak },
      inputs: {
        overdueReviewItems: 0,
        unresolvedErrors: summary.vocabulary.weak,
        levelDistance: 0,
        matchesInterest: false,
        turnsSinceRecommended: null,
        addsDiversity: true,
      },
    });
  }

  return candidates;
}

export function recommendNext(
  summary: LearnerSummary,
  interests: readonly string[],
): RankedCandidate | null {
  const ranked = rankCandidates(candidatesFor(summary, interests));
  return ranked[0] ?? null;
}
