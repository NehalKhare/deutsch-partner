import { z } from "zod";

import { isSafeToStoreAsMemory } from "@/domain/memory";
import {
  FEEDBACK_REASONS,
  FEEDBACK_VERDICTS,
  MAX_FEEDBACK_NOTE_LENGTH,
  MAX_FEEDBACK_TOOLS,
  defaultCoachingProfile,
  dialsOf,
  type CoachingDials,
  type TrainerFeedback,
} from "@/domain/trainer-coaching";
import { TRAINER_PROMPT_VERSION } from "@/lib/ai/prompts/trainer";
import { applyFeedback, type DialChange } from "@/lib/trainer/coaching";
import { nullLogger, type Logger } from "@/lib/observability/logger";
import type { TrainerCoachingRepository } from "@/repositories/trainer-coaching-repository";

/**
 * The feedback endpoint's logic, with the framework left outside.
 *
 * A vote on one trainer reply arrives here: a verdict, the closed-set reasons
 * behind it, an optional note in the learner's words, and the reply's tool
 * receipt. Three things happen, in an order chosen so that a failure leaves
 * the least surprising state: the profile is read, the vote is folded into
 * it by the rules in lib/trainer/coaching.ts and written back, and then the
 * vote itself is recorded. A profile written without its vote is a trainer
 * that adjusted as asked and forgot why; a vote written without the profile
 * would be a learner told nothing changed when it should have.
 *
 * No model is called. What the learner said about the coaching becomes
 * coaching through arithmetic, which is the same discipline as the review
 * engine: the learner judges, the code decides.
 */

const distinct = <T>(list: readonly T[]) => new Set(list).size === list.length;

export const trainerFeedbackRequestSchema = z.strictObject({
  verdict: z.enum(FEEDBACK_VERDICTS),
  reasons: z
    .array(z.enum(FEEDBACK_REASONS))
    .max(FEEDBACK_REASONS.length)
    .refine(distinct)
    .default([]),
  // Trimmed, bounded, optional. An empty string is no note.
  note: z
    .string()
    .trim()
    .max(MAX_FEEDBACK_NOTE_LENGTH)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .default(null),
  // The receipt the reply came with: tool names, which are slugs. What the
  // reply said stays in the browser.
  tools: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[a-z][a-z0-9_]*$/u),
    )
    .max(MAX_FEEDBACK_TOOLS)
    .default([]),
});

export type TrainerFeedbackRequest = z.infer<typeof trainerFeedbackRequestSchema>;

export const TRAINER_FEEDBACK_ERRORS = [
  "unauthenticated",
  "invalid_body",
  "rate_limited",
  "unavailable",
] as const;

export type TrainerFeedbackError = (typeof TRAINER_FEEDBACK_ERRORS)[number];

const RESPONSES: Readonly<
  Record<TrainerFeedbackError, { status: number; message: string }>
> = {
  unauthenticated: { status: 401, message: "Please sign in to send feedback." },
  invalid_body: { status: 400, message: "That feedback could not be sent." },
  rate_limited: { status: 429, message: "That is a lot of feedback at once. Give it a moment." },
  unavailable: {
    status: 503,
    message: "Your feedback could not be saved right now. Please try again shortly.",
  },
};

export const trainerFeedbackErrorResponse = (error: TrainerFeedbackError) =>
  RESPONSES[error];

export interface TrainerFeedbackDeps {
  readonly coaching: TrainerCoachingRepository;
  /** Mints the vote's id. Injected so a test can pin it. */
  readonly newId: () => string;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

export interface TrainerFeedbackPayload {
  /** Every dial as it now stands. */
  readonly coaching: CoachingDials;
  /** What this vote moved, for the confirmation the learner sees. */
  readonly changed: readonly DialChange[];
  /** True when a note was sent and refused by the secret filter. */
  readonly noteDropped: boolean;
}

export type TrainerFeedbackResult =
  | { readonly ok: true; readonly payload: TrainerFeedbackPayload }
  | { readonly ok: false; readonly error: TrainerFeedbackError };

export async function handleTrainerFeedback(
  body: unknown,
  identity: {
    readonly learnerId: string;
    readonly userIdHash: string;
    readonly requestId: string;
  },
  deps: TrainerFeedbackDeps,
): Promise<TrainerFeedbackResult> {
  const logger = deps.logger ?? nullLogger;
  const now = deps.now ?? (() => new Date());

  const parsed = trainerFeedbackRequestSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: "invalid_body" };

  const at = now();
  const current = await deps.coaching.getProfile(identity.learnerId).catch(() => null);
  if (current === null || !current.ok) return { ok: false, error: "unavailable" };

  const update = applyFeedback(
    current.data ?? defaultCoachingProfile(identity.learnerId, at),
    parsed.data,
    at,
  );

  const saved = await deps.coaching.upsertProfile(update.profile).catch(() => null);
  if (saved === null || !saved.ok) return { ok: false, error: "unavailable" };

  // The note is the learner's words and passes the memory filter before it
  // is kept. A note that fails it is dropped and the vote stands: losing a
  // sentence of feedback costs nothing, storing a pasted password is
  // unrecoverable (guardrails S15). The repository checks again on the way
  // in, so this is the friendly refusal and that is the control.
  const noteDropped = parsed.data.note !== null && !isSafeToStoreAsMemory(parsed.data.note);
  const feedback: TrainerFeedback = {
    id: deps.newId(),
    learnerId: identity.learnerId,
    verdict: parsed.data.verdict,
    reasons: parsed.data.reasons,
    note: noteDropped ? null : parsed.data.note,
    tools: parsed.data.tools,
    promptVersion: TRAINER_PROMPT_VERSION,
    createdAt: at,
  };
  const recorded = await deps.coaching.recordFeedback(feedback).catch(() => null);
  if (recorded === null || !recorded.ok) {
    // The dials moved and the record did not. Said in the log, and the
    // learner still gets the truth about their trainer.
    logger.warn("trainer.feedback_unrecorded", {
      requestId: identity.requestId,
      userIdHash: identity.userIdHash,
    });
  }

  // Which way the vote went and which dials moved are audited; the note and
  // the reply it was about never are (guardrails S24).
  logger.info("trainer.feedback_recorded", {
    audit: true,
    requestId: identity.requestId,
    userIdHash: identity.userIdHash,
    verdict: parsed.data.verdict,
    reasons: parsed.data.reasons,
    changed: update.changed.map((change) => change.dial),
    noted: feedback.note !== null,
    noteDropped,
    promptVersion: TRAINER_PROMPT_VERSION,
  });

  return {
    ok: true,
    payload: {
      coaching: dialsOf(saved.data),
      changed: update.changed,
      noteDropped,
    },
  };
}
