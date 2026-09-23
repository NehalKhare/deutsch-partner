import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import {
  MiddlewareError,
  MultipleStructuredOutputsError,
  StructuredOutputParsingError,
  ToolCallLimitExceededError,
  createAgent,
  modelCallLimitMiddleware,
  summarizationMiddleware,
  toolCallLimitMiddleware,
  toolStrategy,
  type AnyAgentMiddleware,
  type ResponseFormat,
} from "langchain";
import { z, type ZodType } from "zod";

import type { CallContext } from "@dp/gateway/gateway";
import {
  ModelBudgetExhausted,
  isModelUnavailableError,
  isTransientModelError,
  type TaskModelContext,
  type TrainerModel,
} from "@dp/gateway/langchain-model";
import { fingerprint } from "@dp/prompts/fingerprint";
import {
  missingAnswerRepairInstruction,
  repairInstruction,
  truncationRepairInstruction,
} from "@dp/prompts/repair";
import type { UntrustedTag } from "@dp/prompts/delimiters";
import {
  PRODUCT_OPS_AGENT_PROMPT_VERSION,
  productOpsAgentPrompt,
  productOpsAgentPromptName,
  productOpsAgentPromptText,
  type ProductOpsAgentName,
} from "@dp/prompts/product-ops-agents";
import { ceilingsFor, type TaskId } from "@dp/domain/tasks";
import { nullLogger, type Logger } from "@dp/observability/logger";
import {
  cacheMarksMiddleware,
  fencedToolResultsMiddleware,
  progressMiddleware,
  isToolProgress,
  runBudgetMiddleware,
  type AgentProgress,
} from "./middleware";

export type { AgentProgress, ModelProgress, ToolProgress } from "./middleware";

/**
 * One product-ops agent run: a bounded tool-calling loop with a structured
 * answer.
 *
 * The four agents in this directory share this shape and differ only in their
 * prompt, their tools and the schema of what they hand back. What lives here
 * is everything that bounds them: the model ladder from the gateway, the euro
 * budget, the tool and model call caps, the fence around every tool result,
 * summarisation of an overlong transcript, and the validation of the final
 * structured answer against the schema the prompt was generated from.
 *
 * A failure is a typed value. Nothing here throws to its caller, and nothing
 * here puts a provider's words or a tool's output into a log line.
 */

/**
 * How many graph steps one tool round may take, with this middleware stack.
 *
 * The loop's real bounds are the tool and model call caps below, which end a
 * run as a typed failure. The graph's recursion limit is the backstop behind
 * them, and it counts nodes, not rounds: every beforeModel and afterModel
 * hook in the stack is a node of its own, so one model call plus one tool
 * call is eight or so steps rather than two. The first real planning run hit
 * a limit sized for two per round after a handful of reads, which the loop
 * could only report as a failure of the model. Generous on purpose: a run
 * that reaches this has already got past both caps, and that is the bug.
 */
export const GRAPH_STEPS_PER_ROUND = 10;

/** The recursion limit for a run allowed this many calls. */
export function recursionLimitFor(limits: AgentLimits): number {
  return (limits.modelCalls + limits.toolCalls) * GRAPH_STEPS_PER_ROUND + 2;
}

/** Where summarisation kicks in: a fraction of the task's input ceiling. */
const SUMMARISE_AT = 0.7;

/** Roughly four characters per token, as LangChain's own counter assumes. */
const CHARS_PER_TOKEN = 4;

/** The cache-marks middleware, by the name it registers under. */
const CACHE_MARKS = "productops-cache-marks";

/** The summariser reads fenced tool output; the cheap tier compresses it. */
const SUMMARY_TASK: TaskId = "productops.context_summary";

/**
 * The synthetic tool the model answers through.
 *
 * Named, so a test can script the call and so a trace reads as an answer
 * rather than as "extract-7". The arguments are the reply and are validated
 * against the Zod schema afterwards regardless of what the framework parsed.
 */
export const ANSWER_TOOL = "productops_answer";

/**
 * The routing document's rule for structured output: one repair, then the
 * safe path. The framework would otherwise ask again until a call cap ended
 * the run, and every one of those asks is a paid call.
 */
export const MAX_ANSWER_REPAIRS = 1;

function answerFormat<T>(schema: ZodType<T>): ResponseFormat {
  return toolStrategy(
    {
      ...z.toJSONSchema(schema),
      title: ANSWER_TOOL,
      description: "Your final answer, in the structure the instructions describe.",
    } as never,
    // Throw rather than ask again: the repair is the loop's, see below.
    { handleError: false },
  ) as unknown as ResponseFormat;
}

export type AgentFailure =
  | "over_budget"
  | "model_unavailable"
  /** Every rung of the ladder timed out or came back with a transient error. */
  | "timeout"
  | "tool_limit"
  | "invalid_output";

export type AgentOutcome<T> =
  | {
      readonly status: "ok";
      readonly value: T;
      readonly costEur: number;
      readonly toolCalls: number;
    }
  | {
      readonly status: "failed";
      readonly reason: AgentFailure;
      /** A code or an issue path. Never a provider message or a payload. */
      readonly detail: string;
      readonly costEur: number;
      readonly toolCalls: number;
    };

/** Builds the tier's ladder for a task. Supplied by the composition root. */
export type ModelLadderFactory = (
  context: TaskModelContext,
) => readonly TrainerModel[];

export type AgentModelFactory = ModelLadderFactory;

export interface AgentDeps {
  readonly models: ModelLadderFactory;
  readonly logger?: Logger;
  /** Where each tool and model call is reported. The dashboard's liveness signal. */
  readonly onProgress?: (progress: AgentProgress) => Promise<void> | void;
}

/**
 * The call context, as the gateway spells it. The turn budget is the run's
 * remaining euros, reconstructed from its timeline; a context without one is
 * refused before any model call, because an unbudgeted loop is exactly the
 * thing the spec forbids.
 */
export type AgentContext = CallContext;

export interface AgentLimits {
  /** Tool calls this run may make. Exceeding it ends the run as a failure. */
  readonly toolCalls: number;
  /** Model calls, sitting just above the tool cap as a second bound. */
  readonly modelCalls: number;
}

export interface AgentRequest<T> {
  readonly agent: ProductOpsAgentName;
  readonly task: TaskId;
  readonly tools: readonly StructuredToolInterface[];
  /** Which fence each tool's output belongs in. */
  readonly fences: Readonly<Record<string, UntrustedTag>>;
  readonly schema: ZodType<T>;
  /** The trusted framing: what this run is asking for. */
  readonly message: string;
  readonly limits: AgentLimits;
  readonly context: AgentContext;
}

/**
 * The error as thrown, not as the framework re-threw it.
 *
 * Anything thrown through a wrapModelCall middleware comes out wrapped in a
 * MiddlewareError that keeps the name and carries the original as its cause,
 * but not its status or its class. The loop below classifies on both, so it
 * looks at the cause. Nothing here is a middleware error of its own making.
 */
function unwrapped(error: unknown): unknown {
  if (MiddlewareError.isInstance(error) && error.cause instanceof Error) {
    return unwrapped(error.cause);
  }
  return error;
}

const errorName = (error: unknown): string =>
  error instanceof Error && error.name.length > 0
    ? error.name.slice(0, 64)
    : "unknown_error";

/**
 * The framework's own verdict that the answer did not fit its schema. The
 * same failure as a Zod rejection of the parsed answer, and reported as one.
 */
function isInvalidAnswer(error: unknown): boolean {
  return (
    error instanceof StructuredOutputParsingError ||
    error instanceof MultipleStructuredOutputsError
  );
}

/**
 * A loop bound, by whichever mechanism ended it. The graph's own recursion
 * limit is here too: it means the same thing as the caps — the loop did not
 * finish — and is not a statement about the model.
 */
function isToolLimit(error: unknown): boolean {
  return (
    error instanceof ToolCallLimitExceededError ||
    errorName(error) === "ToolCallLimitExceededError" ||
    errorName(error) === "ModelCallLimitExceededError" ||
    errorName(error) === "GraphRecursionError"
  );
}

/**
 * Whether the loop's last turn was cut off by the output ceiling.
 *
 * Read from the message's metadata, never its content: the provider's finish
 * reason, or a tool call whose arguments did not parse because they stopped
 * mid-object. A reasoning-tier proposal that runs past 2000 tokens ends
 * exactly this way, and the repair for it is "shorter", not "call the tool".
 */
function wasTruncated(messages: readonly BaseMessage[] | undefined): boolean {
  const last = messages?.at(-1);
  if (!(last instanceof AIMessage)) return false;
  const finish = (last.response_metadata as { finish_reason?: unknown } | undefined)
    ?.finish_reason;
  return finish === "length" || (last.invalid_tool_calls?.length ?? 0) > 0;
}

export async function runAgent<T>(
  deps: AgentDeps,
  request: AgentRequest<T>,
): Promise<AgentOutcome<T>> {
  const logger = deps.logger ?? nullLogger;
  let toolCalls = 0;

  const turn = request.context.turn;
  if (turn === undefined) {
    return { status: "failed", reason: "over_budget", detail: "no_budget", costEur: 0, toolCalls };
  }
  const spentBefore = turn.spentEur();
  const cost = () => Math.max(0, turn.spentEur() - spentBefore);

  const promptText = productOpsAgentPromptText(request.agent);
  const identity = {
    name: productOpsAgentPromptName(request.agent),
    version: PRODUCT_OPS_AGENT_PROMPT_VERSION[request.agent],
    fingerprint: fingerprint(promptText),
  };
  const modelContext: TaskModelContext = {
    requestId: request.context.requestId ?? "00000000-0000-4000-8000-000000000000",
    userIdHash: request.context.userIdHash ?? "operator",
    turn,
    prompt: identity,
    task: request.task,
  };

  const ladder = deps.models(modelContext);
  if (ladder.length === 0) {
    return { status: "failed", reason: "model_unavailable", detail: "no_model", costEur: 0, toolCalls };
  }

  const summariser = deps.models({ ...modelContext, task: SUMMARY_TASK })[0];
  const inputCeiling = ceilingsFor(request.task).maxInputTokens;

  const middleware: AnyAgentMiddleware[] = [
    runBudgetMiddleware(turn),
    cacheMarksMiddleware(),
    // "continue", not "error": a model that asks for more calls in one turn
    // than remain gets the ones that fit, an error message for the rest, and
    // a chance to answer with what it has. Set to throw, one over-eager batch
    // of parallel reads ended a whole planning stage before a single file
    // was read. The model-call cap below is the hard bound, and it throws.
    toolCallLimitMiddleware({ runLimit: request.limits.toolCalls, exitBehavior: "continue" }),
    modelCallLimitMiddleware({ runLimit: request.limits.modelCalls, exitBehavior: "error" }),
    fencedToolResultsMiddleware(request.fences),
    progressMiddleware(async (progress) => {
      if (isToolProgress(progress)) toolCalls += 1;
      await deps.onProgress?.(progress);
    }),
  ];

  if (summariser !== undefined) {
    middleware.push(
      summarizationMiddleware({
        model: summariser.model,
        trigger: { tokens: Math.floor(inputCeiling * SUMMARISE_AT) },
        keep: { messages: 4 },
        tokenCounter: (messages) =>
          Math.ceil(
            messages.reduce(
              (sum, message) =>
                sum +
                (typeof message.content === "string"
                  ? message.content.length
                  : JSON.stringify(message.content).length),
              0,
            ) / CHARS_PER_TOKEN,
          ),
      }),
    );
  }

  const systemPrompt = productOpsAgentPrompt(request.agent, request.schema);

  /**
   * One repair, done here rather than by the framework.
   *
   * The tool strategy can ask the model again itself, but with more than one
   * middleware active it writes the repaired answer to its state twice and
   * the graph refuses the update. So the strategy is told to throw, and the
   * loop is run once more with the repair instruction appended to the
   * request — the same shape the specialist runner uses, and for the same
   * reason: the model needs to see the request it is answering again.
   */
  let repair: string | null = null;

  for (const [attempt, candidate] of ladder.entries()) {
    for (let answerAttempt = 0; answerAttempt <= MAX_ANSWER_REPAIRS; answerAttempt += 1) {
      const agent = createAgent({
        model: candidate.model,
        tools: [...request.tools],
        systemPrompt,
        // The domain schema itself, as a tool-calling strategy: the model
        // answers by calling a synthetic tool whose arguments are the reply,
        // which every tool-capable model on the ladder can do.
        responseFormat: answerFormat(request.schema),
        // Cache marks only for a provider that reads them; a mark a provider
        // does not know is a request it may refuse.
        middleware: candidate.cacheMarks
          ? middleware
          : middleware.filter((entry) => entry.name !== CACHE_MARKS),
      });

      const message = repair === null ? request.message : `${request.message}${repair}`;

      let result: { structuredResponse?: unknown; messages?: BaseMessage[] };
      try {
        result = await agent.invoke(
          { messages: [{ role: "user", content: message }] },
          { recursionLimit: recursionLimitFor(request.limits) },
        );
      } catch (thrown) {
        const error = unwrapped(thrown);
        if (error instanceof ModelBudgetExhausted) {
          logger.warn("productops.agent_over_budget", { agent: request.agent });
          return { status: "failed", reason: "over_budget", detail: "run_budget", costEur: cost(), toolCalls };
        }
        if (isInvalidAnswer(error)) {
          logger.warn("productops.agent_output_invalid", {
            agent: request.agent,
            attempt: answerAttempt + 1,
            issues: "answer_rejected",
            requestId: request.context.requestId,
          });
          if (answerAttempt < MAX_ANSWER_REPAIRS) {
            repair = repairInstruction(issuesOf(error));
            continue;
          }
          return { status: "failed", reason: "invalid_output", detail: "answer_rejected", costEur: cost(), toolCalls };
        }
        if (isToolLimit(error)) {
          logger.warn("productops.agent_tool_limit", { agent: request.agent, toolCalls });
          return { status: "failed", reason: "tool_limit", detail: errorName(error), costEur: cost(), toolCalls };
        }
        // A model with no endpoint, or a moment the provider could not
        // serve: both are what the next rung of the same tier is for. The
        // loop starts over on the fallback, because the transcript so far
        // belongs to a model that did not finish it.
        const transient = isTransientModelError(error);
        if ((isModelUnavailableError(error) || transient) && attempt < ladder.length - 1) {
          logger.warn("productops.agent_model_fallback", {
            agent: request.agent,
            attempt: attempt + 1,
            errorCode: errorName(error),
          });
          break;
        }
        // Never the message: it can quote the prompt, and the prompt carries
        // whatever a tool fetched.
        logger.warn("productops.agent_failed", {
          agent: request.agent,
          errorCode: errorName(error),
        });
        return {
          status: "failed",
          reason: transient ? "timeout" : "model_unavailable",
          detail: errorName(error),
          costEur: cost(),
          toolCalls,
        };
      }

      // No answer at all is two different failures with two different
      // repairs. An answer the ceiling cut off wants a shorter one; an answer
      // that never came — the model ended in prose — wants the tool named.
      // "(root)" helps with neither.
      if (result.structuredResponse === undefined) {
        const truncated = wasTruncated(result.messages);
        const issue = truncated ? "truncated" : "no_answer";
        logger.warn("productops.agent_output_invalid", {
          agent: request.agent,
          attempt: answerAttempt + 1,
          issues: issue,
          requestId: request.context.requestId,
        });
        if (answerAttempt < MAX_ANSWER_REPAIRS) {
          repair = truncated
            ? truncationRepairInstruction()
            : missingAnswerRepairInstruction(ANSWER_TOOL);
          continue;
        }
        return { status: "failed", reason: "invalid_output", detail: issue, costEur: cost(), toolCalls };
      }

      const parsed = request.schema.safeParse(result.structuredResponse);
      if (parsed.success) {
        return { status: "ok", value: parsed.data, costEur: cost(), toolCalls };
      }

      const issues = parsed.error.issues
        .slice(0, 8)
        .map((issue) => issue.path.join(".") || "(root)");
      logger.warn("productops.agent_output_invalid", {
        agent: request.agent,
        attempt: answerAttempt + 1,
        issues: issues.join(", "),
        requestId: request.context.requestId,
      });
      if (answerAttempt < MAX_ANSWER_REPAIRS) {
        repair = repairInstruction(issues);
        continue;
      }
      return {
        status: "failed",
        reason: "invalid_output",
        detail: issues.join(", "),
        costEur: cost(),
        toolCalls,
      };
    }
  }

  return { status: "failed", reason: "model_unavailable", detail: "exhausted", costEur: cost(), toolCalls };
}

/** The framework's own issue text for a rejected answer, bounded. Never the payload. */
function issuesOf(error: unknown): readonly string[] {
  if (error instanceof StructuredOutputParsingError && error.errors.length > 0) {
    return error.errors.map((issue) => issue.slice(0, 120));
  }
  return ["the answer did not match the required structure"];
}
