import type { CEFRLevel } from "@/domain/cefr";
import {
  learningEvaluationSchema,
  parseModelJson,
  parseModelObject,
  type LearningEvaluation,
} from "@/domain/evaluation";
import { callSpecFor } from "@/lib/ai/gateway/call-spec";
import type {
  CallContext,
  GatewayPrompt,
  ModelGateway,
} from "@/lib/ai/gateway/gateway";
import { recoverEvaluation } from "@/lib/ai/evaluation/recovery";
import { triageMessage, type TriageReason } from "@/lib/ai/evaluation/triage";
import {
  behaviorPolicyFor,
  buildPrompt,
  fingerprint,
  promptEntry,
  repairInstruction,
  versionedText,
  type BuildRequest,
} from "@/lib/ai/prompts";
import { nullLogger, type Logger } from "@/lib/observability/logger";

/**
 * Learning evaluation.
 *
 * Separate from conversation generation, on a different tier, and run after
 * the reply has streamed (business-objective.md S17). The learner is not
 * waiting for this, which is what makes it affordable to do properly.
 *
 * Model output is never trusted. It is parsed, validated, repaired once if it
 * has to be, and dropped entirely if it cannot be made valid — because this
 * output is written into learner state, and a plausible-looking wrong
 * evaluation moves someone up or down the curriculum on the strength of a
 * malformed response.
 */

/** The prompt entry name. Versioned, budgeted, and locked to its own text. */
const PROMPT = "evaluation.learner_message";

/**
 * The routing document's rule: one repair, then the safe path. A second
 * failure is a model that cannot produce this shape today, and a third call
 * costs money to learn that again.
 */
export const MAX_REPAIR_ATTEMPTS = 1;

const EVALUATION_TIMEOUT_MS = 30_000;

export interface PrecedingTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface EvaluationRequest {
  readonly learnerMessage: string;
  /** What the learner is believed to be at. Used for budgeting, not shown. */
  readonly cefr: CEFRLevel;
  /** The tutor's last turns. Comprehension cannot be judged without them. */
  readonly precedingTurns?: readonly PrecedingTurn[];
}

export type EvaluationFailure =
  | "invalid_request"
  | "over_budget"
  | "model_unavailable"
  | "unusable_output";

export type EvaluationOutcome =
  | {
      readonly status: "evaluated";
      readonly evaluation: LearningEvaluation;
      /** True when the object was salvaged rather than returned clean. */
      readonly recovered: boolean;
      /** What was dropped or clamped, by path. Never the offending values. */
      readonly repairs: readonly string[];
      readonly attempts: number;
      readonly costEur: number;
    }
  | { readonly status: "skipped"; readonly reason: TriageReason }
  | {
      readonly status: "failed";
      readonly reason: EvaluationFailure;
      readonly detail: string;
      readonly attempts: number;
      readonly costEur: number;
    };

export interface EvaluatorDeps {
  readonly gateway: ModelGateway;
  readonly logger?: Logger;
}

export interface Evaluator {
  evaluateLearnerMessage(
    request: EvaluationRequest,
    context: CallContext,
  ): Promise<EvaluationOutcome>;
}

/** A projection with the fields the evaluation prompt actually renders. */
function promptFor(
  request: EvaluationRequest,
  repair: string | null,
): BuildRequest {
  return {
    policy: behaviorPolicyFor({ cefr: request.cefr }),
    cefr: request.cefr,
    // The evaluation entry declares no learner_state block, so this projection
    // is never rendered. It is required by the build request's shape, and the
    // level it carries is the one the caller already knows.
    learner: {
      effectiveLevel: { cefr: request.cefr, plus: false },
      miniLevel: 1,
      theme: "—",
      focus: "—",
      learningGoal: "—",
      interests: [],
      targetVocabulary: [],
      targetGrammar: [],
      dueVocabulary: [],
      recurringErrors: [],
    justMoved: null,
    },
    recentMessages: [...(request.precedingTurns ?? [])],
    userMessage: repair === null
      ? request.learnerMessage
      : `${request.learnerMessage}${repair}`,
  };
}

export function createEvaluator(deps: EvaluatorDeps): Evaluator {
  const logger = deps.logger ?? nullLogger;
  const entry = promptEntry(PROMPT);

  return {
    async evaluateLearnerMessage(request, context) {
      // Cheapest possible answer first: a one-word reply carries no signal,
      // and scoring it costs money and adds noise to a learner's level.
      const triage = triageMessage(request.learnerMessage);
      if (!triage.evaluate) {
        logger.debug("evaluation.skipped", {
          reason: triage.reason,
          requestId: context.requestId,
        });
        return { status: "skipped", reason: triage.reason };
      }

      const spec = callSpecFor("evaluation.learner_message", {
        timeoutMs: EVALUATION_TIMEOUT_MS,
        // Required for every non-conversation task, and the schema the reply
        // is actually validated against.
        outputSchema: learningEvaluationSchema,
      });
      if (!spec.ok) {
        return {
          status: "failed",
          reason: "invalid_request",
          detail: spec.detail,
          attempts: 0,
          costEur: 0,
        };
      }

      let repair: string | null = null;
      let costEur = 0;
      let lastIssues: readonly string[] = [];

      for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS + 1; attempt += 1) {
        const built = buildPrompt(entry, promptFor(request, repair));
        if (!built.ok) {
          return {
            status: "failed",
            reason: built.reason === "over_budget" ? "over_budget" : "invalid_request",
            detail: built.detail,
            attempts: attempt - 1,
            costEur,
          };
        }

        const prompt: GatewayPrompt = {
          system: built.prompt.system,
          user: built.prompt.user,
          inputTokens: built.prompt.tokens.total,
        };

        const outcome = await deps.gateway.complete(spec.data, prompt, {
          ...context,
          prompt: {
            name: entry.name,
            version: entry.version,
            // The version's own text, not this turn's: a fingerprint that
            // changes with the conversation records nothing about the prompt.
            fingerprint: fingerprint(versionedText(built.prompt)),
          },
        });

        if (!outcome.ok) {
          // A denial or a provider failure is not something a retry fixes, and
          // the gateway has already accounted for it.
          return {
            status: "failed",
            reason:
              outcome.failure === "budget_denied" || outcome.failure === "ceiling_denied"
                ? "over_budget"
                : "model_unavailable",
            detail: outcome.failure,
            attempts: attempt,
            costEur,
          };
        }

        costEur += outcome.data.costEur;

        const parsed = parseModelJson(outcome.data.text, learningEvaluationSchema);
        if (parsed.ok) {
          return {
            status: "evaluated",
            evaluation: parsed.data,
            recovered: false,
            repairs: [],
            attempts: attempt,
            costEur,
          };
        }

        lastIssues = parsed.issues;
        logger.warn("evaluation.output_invalid", {
          attempt,
          reason: parsed.reason,
          issues: parsed.issues.slice(0, 8).join(", "),
          requestId: context.requestId,
        });

        // Salvage before spending another call. Forty-nine good error entries
        // and one bad one is worth keeping, and keeping it costs nothing.
        const salvaged = salvage(outcome.data.text);
        if (salvaged) {
          logger.info("evaluation.recovered", {
            attempt,
            repairs: salvaged.repairs.slice(0, 8).join(", "),
            requestId: context.requestId,
          });
          return {
            status: "evaluated",
            evaluation: salvaged.evaluation,
            recovered: true,
            repairs: salvaged.repairs,
            attempts: attempt,
            costEur,
          };
        }

        repair = repairInstruction(parsed.issues);
      }

      // One repair, then the safe path: no evaluation rather than a guessed
      // one. Nothing is written, and the learner's state stands.
      logger.error("evaluation.unusable", {
        issues: lastIssues.slice(0, 8).join(", "),
        requestId: context.requestId,
      });

      return {
        status: "failed",
        reason: "unusable_output",
        detail: lastIssues.slice(0, 4).join(", "),
        attempts: MAX_REPAIR_ATTEMPTS + 1,
        costEur,
      };
    },
  };
}

/** Parses loosely enough to try recovery, without trusting anything it finds. */
function salvage(raw: string) {
  const loose = parseModelObject(raw);
  return loose.ok ? recoverEvaluation(loose.data) : null;
}
