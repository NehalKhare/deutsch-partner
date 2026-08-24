import {
  MAX_STORED_EXAMPLES,
  type ErrorObservation,
  type ErrorType,
  type LearnerError,
} from "@/domain/learner-error";

/**
 * The learner error engine.
 *
 * One learner making the same mistake forty times is one thing to work on,
 * not forty. Everything here exists to turn a stream of individual
 * observations into that single aggregate, and then to decide which
 * aggregates are worth putting in front of the learner.
 *
 * The aggregation rule is written twice on purpose: here, as a pure function
 * the rest of the application can reason with, and in SQL, where it has to be
 * atomic because two turns can report the same mistake at once. A database
 * test replays the same observations through both and asserts they agree, so
 * the duplication is checked rather than trusted.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Three times is a habit; twice is a coincidence. Below this an aggregate is
 * still counted and stored, it just does not yet earn the learner's attention.
 */
export const RECURRING_THRESHOLD = 3;

/** Days after which a mistake counts for half as much. */
export const SIGNAL_HALF_LIFE_DAYS = 14;

/** Signals are rendered into a prompt, so the list is bounded, not merely short. */
export const MAX_LEARNING_SIGNALS = 5;

/**
 * Newest first, deduplicated, capped.
 *
 * Keeping the oldest examples would freeze the evidence at whatever the
 * learner happened to do first, which is the least useful thing to show them.
 */
function mergeExamples(
  existing: readonly string[],
  utterance: string | undefined,
): string[] {
  const combined = utterance ? [utterance, ...existing] : [...existing];

  return [...new Set(combined)].slice(0, MAX_STORED_EXAMPLES);
}

/**
 * Folds one observation into the aggregate, opening it if there is none.
 *
 * The seen window widens in both directions rather than only forward: an
 * observation that arrives with an earlier timestamp is clock skew, and a row
 * whose last_seen_at precedes its first_seen_at is one the database refuses.
 */
export function aggregateObservation(
  existing: LearnerError | null,
  observation: ErrorObservation,
  id: string,
): LearnerError {
  if (existing === null) {
    return {
      id,
      learnerId: observation.learnerId,
      errorType: observation.errorType,
      pattern: observation.pattern,
      occurrenceCount: 1,
      firstSeenAt: observation.observedAt,
      lastSeenAt: observation.observedAt,
      resolved: false,
      exampleUtterances: mergeExamples([], observation.utterance),
    };
  }

  const observedAt = observation.observedAt;

  return {
    ...existing,
    occurrenceCount: existing.occurrenceCount + 1,
    firstSeenAt:
      observedAt < existing.firstSeenAt ? observedAt : existing.firstSeenAt,
    lastSeenAt: observedAt > existing.lastSeenAt ? observedAt : existing.lastSeenAt,
    // It came back, so it was not corrected after all.
    resolved: false,
    exampleUtterances: mergeExamples(
      existing.exampleUtterances,
      observation.utterance,
    ),
  };
}

export function markResolved(error: LearnerError): LearnerError {
  return { ...error, resolved: true };
}

export function isRecurring(error: LearnerError): boolean {
  return error.occurrenceCount >= RECURRING_THRESHOLD;
}

export interface LearningSignal {
  readonly errorType: ErrorType;
  readonly pattern: string;
  readonly occurrenceCount: number;
  readonly lastSeenAt: Date;
  readonly examples: readonly string[];
  /** Occurrences discounted by how long ago the mistake was last made. */
  readonly priority: number;
}

function priorityOf(error: LearnerError, now: Date): number {
  const daysSince = Math.max(
    0,
    (now.getTime() - error.lastSeenAt.getTime()) / DAY_MS,
  );

  return error.occurrenceCount * 0.5 ** (daysSince / SIGNAL_HALF_LIFE_DAYS);
}

/**
 * The mistakes worth working on now, most pressing first.
 *
 * Resolved patterns are out, one-offs are out, and what is left is discounted
 * by age: something last done three months ago is weaker evidence than
 * something from yesterday, however often it happened back then.
 */
export function learningSignals(
  errors: readonly LearnerError[],
  now: Date,
  limit: number = MAX_LEARNING_SIGNALS,
): readonly LearningSignal[] {
  return errors
    .filter((error) => !error.resolved && isRecurring(error))
    .map((error) => ({
      errorType: error.errorType,
      pattern: error.pattern,
      occurrenceCount: error.occurrenceCount,
      lastSeenAt: error.lastSeenAt,
      examples: error.exampleUtterances,
      priority: priorityOf(error, now),
    }))
    .sort((left, right) => right.priority - left.priority)
    .slice(0, Math.min(limit, MAX_LEARNING_SIGNALS));
}
