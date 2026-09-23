import {
  evaluatedErrorSchema,
  learningEvaluationSchema,
  masterySignalSchema,
  type LearningEvaluation,
} from "@dp/domain/evaluation";
import { cefrLevelSchema } from "@dp/domain/cefr";
import { nonEmptyTextSchema } from "@dp/domain/primitives";
import { grammarPatternKeySchema } from "@dp/domain/grammar";

/**
 * Salvaging a nearly-valid evaluation.
 *
 * A model that returns forty-nine good error entries and one with an invented
 * error type has produced something worth keeping. Rejecting the whole object
 * throws away forty-nine correct observations to punish one wrong one, and
 * then costs a repair call to get them back.
 *
 * What this will not do is invent. There are exactly two moves: drop an
 * element or a field that does not validate, and clamp a number that is the
 * right kind of thing but out of range — a model reporting fluency 1.2 means
 * "very high", and 1.0 is the honest reading of that.
 *
 * Two fields have no safe recovery and make the whole attempt fail: the level
 * estimate and the skill estimates. Both are written into learner state and
 * both move a learner's path through the curriculum, so a guessed value is
 * worse than no evaluation at all.
 */

const MAX_LIST = 50;

export interface Recovery {
  readonly evaluation: LearningEvaluation;
  /** What was dropped or clamped, by path. Never the offending values. */
  readonly repairs: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keeps the elements that validate and names the positions that did not. */
function salvageList<T>(
  value: unknown,
  item: { safeParse(input: unknown): { success: boolean; data?: T } },
  path: string,
  repairs: string[],
): T[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) repairs.push(`${path}: not a list`);
    return [];
  }

  const kept: T[] = [];

  for (const [index, element] of value.entries()) {
    if (kept.length >= MAX_LIST) {
      repairs.push(`${path}: truncated past ${MAX_LIST}`);
      break;
    }

    const parsed = item.safeParse(element);
    if (parsed.success) kept.push(parsed.data as T);
    else repairs.push(`${path}[${index}]: dropped`);
  }

  return kept;
}

/**
 * A score the model got roughly right.
 *
 * Out of range is clamped, because a model saying 1.2 is saying "very high"
 * and refusing to read that is pedantry. Not a number at all is a failure,
 * because there is nothing to read.
 */
function salvageScore(
  value: unknown,
  path: string,
  repairs: string[],
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  const clamped = Math.max(0, Math.min(1, value));
  if (clamped !== value) repairs.push(`${path}: clamped`);

  return clamped;
}

export function recoverEvaluation(value: unknown): Recovery | null {
  if (!isRecord(value)) return null;

  const repairs: string[] = [];

  // Core, and not recoverable. A guessed level moves a learner up or down the
  // curriculum on the strength of a malformed response.
  const level = cefrLevelSchema.safeParse(value.estimatedLevel);
  if (!level.success) return null;

  const skills = value.skillEstimates;
  if (!isRecord(skills)) return null;

  const fluency = salvageScore(skills.fluency, "skillEstimates.fluency", repairs);
  const comprehension = salvageScore(
    skills.comprehension,
    "skillEstimates.comprehension",
    repairs,
  );
  const accuracy = salvageScore(skills.accuracy, "skillEstimates.accuracy", repairs);
  const range = salvageScore(skills.range, "skillEstimates.range", repairs);

  if (
    fluency === null ||
    comprehension === null ||
    accuracy === null ||
    range === null
  ) {
    return null;
  }

  // A missing confidence is zero rather than a guess: it says the estimate
  // should carry no weight, which is exactly what an unreadable field means.
  const confidence = salvageScore(value.levelConfidence, "levelConfidence", repairs);
  if (confidence === null) repairs.push("levelConfidence: defaulted to zero");

  const lemma = nonEmptyTextSchema(64);

  const candidate = {
    estimatedLevel: level.data,
    levelConfidence: confidence ?? 0,
    vocabularyUsed: salvageList(value.vocabularyUsed, lemma, "vocabularyUsed", repairs),
    vocabularyWeaknesses: salvageList(
      value.vocabularyWeaknesses,
      lemma,
      "vocabularyWeaknesses",
      repairs,
    ),
    grammarPatternsUsed: salvageList(
      value.grammarPatternsUsed,
      grammarPatternKeySchema,
      "grammarPatternsUsed",
      repairs,
    ),
    errors: salvageList(value.errors, evaluatedErrorSchema, "errors", repairs),
    skillEstimates: { fluency, comprehension, accuracy, range },
    masterySignals: salvageList(
      value.masterySignals,
      masterySignalSchema,
      "masterySignals",
      repairs,
    ),
    reviewCandidates: salvageList(
      value.reviewCandidates,
      lemma,
      "reviewCandidates",
      repairs,
    ),
    recommendationSignals: salvageList(
      value.recommendationSignals,
      nonEmptyTextSchema(64),
      "recommendationSignals",
      repairs,
    ),
  };

  // Validated as a whole rather than trusted: this function is the last thing
  // between a malformed response and learner state.
  const parsed = learningEvaluationSchema.safeParse(candidate);

  return parsed.success ? { evaluation: parsed.data, repairs } : null;
}
