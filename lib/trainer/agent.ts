import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createAgent } from "langchain";

import {
  TrainerBudgetExhausted,
  isModelUnavailableError,
} from "@/lib/ai/gateway/langchain-model";
import { trainerSystemPrompt } from "@/lib/ai/prompts/trainer";
import { nullLogger, type Logger } from "@/lib/observability/logger";
import type { TranscriptMessage } from "@/domain/conversation";

/**
 * One Trainer turn: a bounded tool-calling loop.
 *
 * LangChain's createAgent owns the loop; this file owns the bounds. The step
 * cap is a hard recursion limit — a model that keeps calling tools terminates
 * as a typed failure, never a hang — and the euro ceiling lives in the model's
 * own ledger callback, which throws between iterations once the request's
 * budget is spent. Both failures leave the learner a plain sentence, and the
 * ledger rows for what was spent getting there.
 *
 * The models arrive as a ladder — the tier's primary, then its same-tier
 * fallbacks — because OpenRouter serves a model only where the account's
 * data policy allows an endpoint, and "this model has no endpoint for you"
 * should cost the learner nothing when the next candidate has one.
 */

/** Tool-calling iterations per request. A coach, not a research department. */
export const TRAINER_MAX_STEPS = 6;

export interface TrainerStep {
  readonly tool: string;
  readonly summary: string;
}

export interface TrainerReply {
  readonly reply: string;
  readonly steps: readonly TrainerStep[];
}

export type TrainerRunFailure = "budget_exhausted" | "generation_failed";

export type TrainerRunOutcome =
  | { readonly ok: true; readonly data: TrainerReply }
  | { readonly ok: false; readonly failure: TrainerRunFailure };

/**
 * What the UI shows about a tool result: which tool, and one human phrase.
 *
 * These receipts sit under the trainer's replies, and for a while they were
 * raw JSON — `{"dueCount":0,"weakCount":0,...` truncated mid-key — which
 * reads as a stack trace in a teaching product. A receipt is for the learner,
 * so it is written from the parsed result in words; anything unparseable or
 * fenced (retrieved chunks, fetched news) gets no glimpse at all, because the
 * raw text belongs to the model's context alone.
 */
function summarize(tool: string | undefined, content: unknown): string {
  const text =
    typeof content === "string" ? content : JSON.stringify(content ?? "");

  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return "";
    parsed = value as Record<string, unknown>;
  } catch {
    return "";
  }

  if (parsed.error !== undefined) return "unavailable just now";

  switch (tool) {
    case "get_review_session": {
      if (parsed.sessionComplete === true) return "session complete";
      const remaining = Number(parsed.remaining ?? 0);
      const completed = Number(parsed.completed ?? 0);
      const left = `${remaining} item${remaining === 1 ? "" : "s"} to go`;
      return completed > 0 ? `${left}, ${completed} done` : left;
    }
    case "record_review_outcome": {
      if (parsed.recorded === true && typeof parsed.subject === "string") {
        return `“${parsed.subject}” — ${parsed.outcome === "correct" ? "correct" : "not yet"}`;
      }
      if (parsed.reason === "mistake_not_yet_fixed") return "kept for a later session";
      if (parsed.reason === "grammar_practised") return "grammar practised";
      if (parsed.reason === "not_in_curriculum") return "noted — not a course word";
      return "noted";
    }
    case "get_progress":
      return typeof parsed.cefr === "string" && parsed.miniLevel !== undefined
        ? `level ${parsed.cefr}, mini-level ${String(parsed.miniLevel)}`
        : "";
    case "get_grammar_pattern":
      return typeof parsed.name === "string" ? parsed.name : "";
    default:
      return "";
  }
}

function toLangChainHistory(history: readonly TranscriptMessage[]): BaseMessage[] {
  return history.map((line) =>
    line.role === "user" ? new HumanMessage(line.content) : new AIMessage(line.content),
  );
}

export async function runTrainerTurn(
  deps: {
    /** The tier's ladder: the primary first, same-tier fallbacks after. */
    readonly models: readonly BaseChatModel[];
    readonly tools: StructuredToolInterface[];
    readonly logger?: Logger;
  },
  turn: {
    readonly message: string;
    readonly history: readonly TranscriptMessage[];
  },
): Promise<TrainerRunOutcome> {
  const logger = deps.logger ?? nullLogger;

  const errorCodeFor = (error: unknown) =>
    error instanceof Error && error.name ? error.name.slice(0, 64) : "unknown";

  // The ladder exists for one failure: OpenRouter serving no endpoint for a
  // model under the account's data policy. That refusal arrives on the very
  // first call, before any tool has run, so retrying the whole turn on the
  // next candidate repeats nothing.
  let result: { messages: BaseMessage[] } | null = null;
  for (const [attempt, model] of deps.models.entries()) {
    const agent = createAgent({
      model,
      tools: deps.tools,
      systemPrompt: trainerSystemPrompt(),
    });

    try {
      result = await agent.invoke(
        {
          messages: [
            ...toLangChainHistory(turn.history),
            new HumanMessage(turn.message),
          ],
        },
        // Each step is a model call plus a tool round; the +1 is the final
        // answer. Hitting this is the runaway case, and it must terminate.
        { recursionLimit: TRAINER_MAX_STEPS * 2 + 1 },
      );
      break;
    } catch (error) {
      if (error instanceof TrainerBudgetExhausted) {
        logger.warn("trainer.budget_exhausted", {});
        return { ok: false, failure: "budget_exhausted" };
      }
      if (isModelUnavailableError(error) && attempt < deps.models.length - 1) {
        logger.warn("trainer.model_fallback", {
          attempt: attempt + 1,
          errorCode: errorCodeFor(error),
        });
        continue;
      }
      logger.warn("trainer.run_failed", { errorCode: errorCodeFor(error) });
      return { ok: false, failure: "generation_failed" };
    }
  }
  if (result === null) return { ok: false, failure: "generation_failed" };

  // The messages after the one the learner just sent are this turn's work:
  // tool calls become visible steps, and the last assistant text is the reply.
  const newMessages = result.messages.slice(turn.history.length + 1);

  const steps: TrainerStep[] = [];
  for (const message of newMessages) {
    if (message instanceof ToolMessage) {
      steps.push({
        tool: message.name ?? "tool",
        summary: summarize(message.name, message.content),
      });
    }
  }

  const finals = newMessages.filter(
    (message): message is AIMessage =>
      message instanceof AIMessage && typeof message.content === "string" &&
      message.content.trim().length > 0,
  );
  const reply = finals.at(-1)?.content;

  if (typeof reply !== "string" || reply.trim().length === 0) {
    return { ok: false, failure: "generation_failed" };
  }

  return { ok: true, data: { reply, steps } };
}
