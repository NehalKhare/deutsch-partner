import { z } from "zod";

import { nonEmptyTextSchema, timestampSchema, uuidSchema } from "./primitives";

/**
 * How one learner wants to be coached, as the Trainer has learned it.
 *
 * Feedback is the input; this is what it becomes. A learner who marks a reply
 * "too long" twice has told the product something worth keeping, and keeping
 * it as a paragraph of prose would be keeping it in the one place a prompt
 * cannot be versioned, budgeted or reasoned about. So it is kept as dials —
 * closed sets a database CHECK can hold and a template can render — and the
 * rules that move them live in code (lib/trainer/coaching.ts), not in a model.
 * That is the same split the vocabulary engine makes: the model judges, the
 * arithmetic decides, and here the learner judges and the arithmetic decides.
 *
 * Each dial changes something the trainer can actually do differently — how
 * it explains, how hard it sets exercises, how long a sitting runs, what mix
 * the agenda holds, whether it ends on the news — rather than merely asking
 * the model to try harder. The dials are visible on the settings page and
 * can be reset there, which guardrails S15 requires of anything remembered.
 */

/** How much a correction explains. "brief" is the rule and the form; "detailed" adds the why. */
export const EXPLANATION_DEPTHS = ["brief", "standard", "detailed"] as const;
export type ExplanationDepth = (typeof EXPLANATION_DEPTHS)[number];

/** How far an exercise stretches past the level's own material. */
export const CHALLENGE_LEVELS = ["gentler", "standard", "harder"] as const;
export type ChallengeLevel = (typeof CHALLENGE_LEVELS)[number];

/** How many items one sitting plans. "short" is for a coffee break. */
export const SESSION_LENGTHS = ["short", "standard"] as const;
export type SessionLength = (typeof SESSION_LENGTHS)[number];

/** Which kind of work the agenda leans towards. */
export const PRACTICE_FOCUSES = ["balanced", "vocabulary", "grammar"] as const;
export type PracticeFocus = (typeof PRACTICE_FOCUSES)[number];

/**
 * How many disputed corrections it takes before the trainer is told to check
 * a rule before correcting. Two, not one: a single dispute may be the learner
 * being wrong, and the product should not turn cautious on one vote. Held
 * here rather than in the rules module because the CHECK on the column and
 * the threshold belong to the same closed fact.
 */
export const DISPUTE_THRESHOLD = 2;

/** The counter is bounded so a held-down button cannot make it unbounded. */
export const MAX_DISPUTED_CORRECTIONS = 99;

/** The dials alone: what a request may set and what a response reports. */
export const coachingDialsSchema = z.strictObject({
  explanationDepth: z.enum(EXPLANATION_DEPTHS),
  challenge: z.enum(CHALLENGE_LEVELS),
  sessionLength: z.enum(SESSION_LENGTHS),
  focus: z.enum(PRACTICE_FOCUSES),
  /** Whether a session still ends on the reading item. */
  news: z.boolean(),
});

export type CoachingDials = z.infer<typeof coachingDialsSchema>;

export const DEFAULT_COACHING_DIALS: CoachingDials = {
  explanationDepth: "standard",
  challenge: "standard",
  sessionLength: "standard",
  focus: "balanced",
  news: true,
};

export const trainerCoachingProfileSchema = coachingDialsSchema.extend({
  learnerId: uuidSchema,
  /**
   * Corrections the learner has marked wrong, less the helpful votes since.
   * Past DISPUTE_THRESHOLD the trainer is told to verify before it corrects.
   */
  disputedCorrections: z.number().int().min(0).max(MAX_DISPUTED_CORRECTIONS),
  helpfulCount: z.number().int().min(0),
  unhelpfulCount: z.number().int().min(0),
  updatedAt: timestampSchema,
});

export type TrainerCoachingProfile = z.infer<typeof trainerCoachingProfileSchema>;

/** The profile a learner has before they have said anything about the coaching. */
export function defaultCoachingProfile(
  learnerId: string,
  at: Date,
): TrainerCoachingProfile {
  return {
    ...DEFAULT_COACHING_DIALS,
    learnerId,
    disputedCorrections: 0,
    helpfulCount: 0,
    unhelpfulCount: 0,
    updatedAt: at,
  };
}

/** The dials of a profile, without the bookkeeping. */
export function dialsOf(profile: TrainerCoachingProfile): CoachingDials {
  return {
    explanationDepth: profile.explanationDepth,
    challenge: profile.challenge,
    sessionLength: profile.sessionLength,
    focus: profile.focus,
    news: profile.news,
  };
}

/** Whether every dial still stands where a new learner's does. */
export function isDefaultCoaching(dials: CoachingDials): boolean {
  return (Object.keys(DEFAULT_COACHING_DIALS) as Array<keyof CoachingDials>).every(
    (key) => dials[key] === DEFAULT_COACHING_DIALS[key],
  );
}

/** Whether the learner has disputed enough corrections to warrant caution. */
export function shouldVerifyBeforeCorrecting(profile: TrainerCoachingProfile): boolean {
  return profile.disputedCorrections >= DISPUTE_THRESHOLD;
}

// --- feedback ---------------------------------------------------------------

export const FEEDBACK_VERDICTS = ["helpful", "unhelpful"] as const;
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];

/**
 * Why a reply was not helpful, as a closed set.
 *
 * Each reason is one the rules can act on: it names a dial, or it names the
 * one failure — a wrong correction — that no dial fixes and that the trainer
 * is told to guard against instead. A reason that moved nothing would be a
 * survey question, and this is not a survey.
 */
export const FEEDBACK_REASONS = [
  "too_long",
  "too_short",
  "too_hard",
  "too_easy",
  "unclear",
  "wrong_correction",
  "skip_news",
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

/** A learner's own words about the coaching. Short: a request, not a diary. */
export const MAX_FEEDBACK_NOTE_LENGTH = 240;

/** How many tool names one reply's receipt may carry into the record. */
export const MAX_FEEDBACK_TOOLS = 8;

const toolNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/u);

const distinct = <T>(list: readonly T[]) => new Set(list).size === list.length;

export const trainerFeedbackSchema = z.strictObject({
  id: uuidSchema,
  learnerId: uuidSchema,
  verdict: z.enum(FEEDBACK_VERDICTS),
  reasons: z
    .array(z.enum(FEEDBACK_REASONS))
    .max(FEEDBACK_REASONS.length)
    .refine(distinct, { error: "each reason at most once" }),
  note: nonEmptyTextSchema(MAX_FEEDBACK_NOTE_LENGTH).nullable(),
  /** Which tools the reply used — the receipt, never the reply's text. */
  tools: z.array(toolNameSchema).max(MAX_FEEDBACK_TOOLS),
  /** The trainer prompt version the reply was written under. */
  promptVersion: z.number().int().positive(),
  createdAt: timestampSchema,
});

export type TrainerFeedback = z.infer<typeof trainerFeedbackSchema>;

// --- the operator's aggregate ------------------------------------------------

const count = z.coerce.number().int().min(0);

/**
 * What all learners' feedback adds up to, over a window.
 *
 * Aggregated by the database function learner_feedback_summary and read only
 * through the operator client: counts by verdict, reason, prompt version and
 * the tool receipt, plus the most recent notes in learners' own words. The
 * prompt version is the column that turns votes into evidence about a prompt
 * change rather than about a learner; the notes are the part that has to
 * stay fenced when a model reads it.
 */
export const learnerFeedbackSummarySchema = z.object({
  generatedAt: z.coerce.date(),
  window: z.object({ from: z.coerce.date(), to: z.coerce.date(), days: count }),
  totals: z.object({
    votes: count,
    helpful: count,
    unhelpful: count,
    /** Distinct learners who voted. A count, never who. */
    learners: count,
    noted: count,
  }),
  byReason: z.array(z.object({ reason: z.enum(FEEDBACK_REASONS), count })).max(FEEDBACK_REASONS.length),
  byPromptVersion: z
    .array(z.object({ promptVersion: count, votes: count, helpful: count, unhelpful: count }))
    .max(50),
  byTool: z.array(z.object({ tool: z.string(), votes: count, unhelpful: count })).max(50),
  recentNotes: z
    .array(
      z.object({
        note: z.string(),
        verdict: z.enum(FEEDBACK_VERDICTS),
        reasons: z.array(z.enum(FEEDBACK_REASONS)),
        createdAt: z.coerce.date(),
      }),
    )
    .max(100),
});

export type LearnerFeedbackSummary = z.infer<typeof learnerFeedbackSummarySchema>;

/**
 * Each reason in words, shared by the vote's chips and the operator's view so
 * a learner and an operator read the same thing about the same vote.
 */
export const FEEDBACK_REASON_LABELS: Readonly<Record<FeedbackReason, string>> = {
  too_long: "Too long",
  too_short: "Too brief",
  too_hard: "Too hard",
  too_easy: "Too easy",
  unclear: "Unclear",
  wrong_correction: "The correction was wrong",
  skip_news: "Skip the news",
};
