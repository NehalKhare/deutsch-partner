import type { CEFRLevel } from "@/domain/cefr";
import { parseModelJson } from "@/domain/evaluation";
import {
  answerAnalysisSchema,
  type AnswerAnalysis,
} from "@/domain/trainer-analysis";
import { callSpecFor } from "@/lib/ai/gateway/call-spec";
import type {
  CallContext,
  GatewayPrompt,
  ModelGateway,
} from "@/lib/ai/gateway/gateway";
import {
  behaviorPolicyFor,
  buildPrompt,
  fingerprint,
  promptEntry,
  versionedText,
  type BuildRequest,
} from "@/lib/ai/prompts";
import { wrapUntrusted } from "@/lib/ai/prompts/delimiters";
import { analysisFraming } from "@/lib/ai/prompts/trainer";
import { nullLogger, type Logger } from "@/lib/observability/logger";

/**
 * The Trainer's answer analyzer: one structured pass over one learner answer,
 * in the reply path, before the agent loop's first call.
 *
 * A specialist worker in the evaluator's mould, not a second agent: it holds
 * no conversation, calls no tools, and returns a typed verdict the trainer
 * consumes — the coach stays the only voice the learner hears. It shares the
 * request's euro budget through the CallContext it is handed, so its spend and
 * its refusals live under the same €0.05 ceiling as the loop it precedes.
 *
 * No repair pass, deliberately. The evaluator repairs because it runs after
 * the reply has streamed; this runs while the learner waits, and a second
 * model call to rescue a malformed verdict costs seconds to save a nicety.
 * Every failure is a value: the trainer judges unaided, as it did before.
 */

const PROMPT = "trainer.answer_analysis";

const ANALYSIS_TIMEOUT_MS = 12_000;

export interface PrecedingTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface AnalysisRequest {
  readonly message: string;
  /** For budgeting and policy shape, never shown to the analyzer as a claim. */
  readonly cefr: CEFRLevel;
  /** The trainer's preceding turns: an answer cannot be judged without its question. */
  readonly precedingTurns?: readonly PrecedingTurn[];
}

export type AnalysisSkipReason =
  | "invalid_request"
  | "over_budget"
  | "model_unavailable"
  | "invalid_output";

export type AnalysisOutcome =
  | {
      readonly status: "analyzed";
      readonly analysis: AnswerAnalysis;
      readonly costEur: number;
    }
  | { readonly status: "skipped"; readonly reason: AnalysisSkipReason };

export interface AnswerAnalyzerDeps {
  readonly gateway: ModelGateway;
  readonly logger?: Logger;
}

export interface AnswerAnalyzer {
  analyze(request: AnalysisRequest, context: CallContext): Promise<AnalysisOutcome>;
}

/** The build request, with the projections this entry never renders defaulted. */
function promptFor(request: AnalysisRequest): BuildRequest {
  return {
    policy: behaviorPolicyFor({ cefr: request.cefr }),
    cefr: request.cefr,
    // The analysis entry declares no learner_state block, so this projection
    // is never rendered. It is required by the build request's shape.
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
    userMessage: request.message,
  };
}

export function createAnswerAnalyzer(deps: AnswerAnalyzerDeps): AnswerAnalyzer {
  const logger = deps.logger ?? nullLogger;
  const entry = promptEntry(PROMPT);

  return {
    async analyze(request, context) {
      const skipped = (reason: AnalysisSkipReason): AnalysisOutcome => {
        logger.info("trainer.analysis_skipped", {
          reason,
          requestId: context.requestId,
          userIdHash: context.userIdHash,
        });
        return { status: "skipped", reason };
      };

      const spec = callSpecFor("trainer.answer_analysis", {
        timeoutMs: ANALYSIS_TIMEOUT_MS,
        outputSchema: answerAnalysisSchema,
      });
      if (!spec.ok) return skipped("invalid_request");

      const built = buildPrompt(entry, promptFor(request));
      if (!built.ok) {
        return skipped(built.reason === "over_budget" ? "over_budget" : "invalid_request");
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
          fingerprint: fingerprint(versionedText(built.prompt)),
        },
      });
      if (!outcome.ok) {
        return skipped(
          outcome.failure === "budget_denied" || outcome.failure === "ceiling_denied"
            ? "over_budget"
            : "model_unavailable",
        );
      }

      const parsed = parseModelJson(outcome.data.text, answerAnalysisSchema);
      if (!parsed.ok) {
        logger.warn("trainer.analysis_invalid", {
          reason: parsed.reason,
          issues: parsed.issues.slice(0, 8).join(", "),
          requestId: context.requestId,
        });
        return skipped("invalid_output");
      }

      logger.info("trainer.analysis", {
        requestId: context.requestId,
        userIdHash: context.userIdHash,
        verdict: parsed.data.verdict,
        findings: parsed.data.findings.length,
        costEur: Number(outcome.data.costEur.toFixed(8)),
      });

      return {
        status: "analyzed",
        analysis: parsed.data,
        costEur: outcome.data.costEur,
      };
    },
  };
}

/**
 * The block the agent loop appends to the learner's message: the trusted
 * framing outside the fence, the validated verdict — which quotes the
 * learner's own German — inside it.
 */
export function renderAnalysisBlock(analysis: AnswerAnalysis): string {
  return [
    analysisFraming(),
    wrapUntrusted("answer_analysis", JSON.stringify(analysis)),
  ].join("\n");
}
