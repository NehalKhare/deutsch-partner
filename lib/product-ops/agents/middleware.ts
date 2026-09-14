import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
  type MessageContent,
} from "@langchain/core/messages";
import { createMiddleware } from "langchain";

import { ModelBudgetExhausted } from "@/lib/ai/gateway/langchain-model";
import type { TurnBudget } from "@/lib/ai/gateway/budgeter";
import { wrapUntrusted, type UntrustedTag } from "@/lib/ai/prompts/delimiters";

/**
 * The bounds every product-ops agent runs inside.
 *
 * LangChain's createAgent owns the tool-calling loop; these middlewares own
 * what the loop may not do. They are the mechanism the spec's controls hang
 * off — a euro budget reconstructed from the run's own timeline, a fence
 * around every tool result, and a progress signal the dashboard reads — and
 * each is one function so a test can drive it without a model.
 */

/**
 * Stops the loop before its next model call once the run's budget is spent.
 *
 * The turn budget arrives already reduced by what earlier stages recorded on
 * the timeline, so this caps the whole run and not just this invocation. The
 * ledger callback inside the gateway makes the same check; stating it here as
 * well keeps the agent loop's bound visible where the loop is assembled, and
 * testable without a ledger.
 */
export function runBudgetMiddleware(turn: TurnBudget) {
  return createMiddleware({
    name: "productops-run-budget",
    beforeModel: () => {
      if (turn.remainingEur() <= 0) throw new ModelBudgetExhausted(turn.maxEur);
      return undefined;
    },
  });
}

/**
 * Fences every tool result as untrusted content.
 *
 * One place, so no tool can forget. Each tool names the delimiter its output
 * belongs in; a tool without one is fenced as a generic tool result. Closing
 * tags inside the content are neutralised by the wrapper, so a web page or a
 * source file cannot close its own fence and continue as instruction.
 */
export function fencedToolResultsMiddleware(
  fences: Readonly<Record<string, UntrustedTag>>,
) {
  return createMiddleware({
    name: "productops-fenced-tool-results",
    wrapToolCall: async (request, handler) => {
      const result = await handler(request);
      if (!(result instanceof ToolMessage)) return result;

      const tag = fences[request.toolCall.name] ?? "tool_result";
      const content =
        typeof result.content === "string"
          ? result.content
          : JSON.stringify(result.content);

      return new ToolMessage({
        ...result,
        content: wrapUntrusted(tag, content),
        tool_call_id: result.tool_call_id,
        name: result.name,
      });
    },
  });
}

export interface ToolProgress {
  readonly tool: string;
  readonly ok: boolean;
}

/**
 * One finished model call. The fact of it — never what it returned. A
 * reasoning-tier call can run for a minute with nothing else on the timeline,
 * and this row is what tells a person watching that the minute was spent on
 * the model rather than on nothing.
 */
export interface ModelProgress {
  readonly model: "call";
}

export type AgentProgress = ToolProgress | ModelProgress;

export const isToolProgress = (progress: AgentProgress): progress is ToolProgress =>
  "tool" in progress;

/**
 * Reports each tool call and each model call as it completes. The tool's
 * name and whether it succeeded — never its arguments or its result, both of
 * which are model output or untrusted content and neither of which belongs on
 * a timeline. A model call is reported as a model call and nothing more.
 *
 * Model calls are reported from afterModel, a graph node, and deliberately
 * not from wrapModelCall: the framework wraps anything thrown through that
 * hook in its own error class, which would hide a 404 or a schema rejection
 * from the loop that has to tell them apart. A model call that throws
 * therefore reports nothing, and the loop reports the failure itself.
 */
export function progressMiddleware(
  report: (progress: AgentProgress) => Promise<void> | void,
) {
  return createMiddleware({
    name: "productops-progress",
    wrapToolCall: async (request, handler) => {
      try {
        const result = await handler(request);
        await report({ tool: request.toolCall.name, ok: true });
        return result;
      } catch (error) {
        await report({ tool: request.toolCall.name, ok: false });
        throw error;
      }
    },
    afterModel: async () => {
      await report({ model: "call" });
      return undefined;
    },
  });
}

/**
 * One text part carrying an Anthropic prompt-cache breakpoint. OpenRouter
 * forwards the marker to Anthropic models, whose cache then serves everything
 * up to the marked block at a tenth of the input price on every call inside
 * the cache's lifetime. The same shape the Trainer's loop sends.
 */
const cacheMarked = (text: string): MessageContent => [
  { type: "text", text, cache_control: { type: "ephemeral" } },
];

const textOf = (content: MessageContent): string =>
  typeof content === "string"
    ? content
    : content
        .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
        .join("");

/**
 * Marks the stable prefix of every model call for the provider's prompt
 * cache: the system prompt, and the trusted message the loop was asked with.
 *
 * A planning loop re-sends its whole transcript on every tool turn, and on
 * the reasoning tier that transcript is the expensive part of the run. The
 * prefix the two marks cover — tool definitions, the standing rules, the
 * output contract, the request — is identical on every turn and is served
 * from cache after the first. The tool transcript after it is not marked:
 * whether the router forwards a mark on a tool result is not documented, and
 * a rejected request would fail the stage outright. Bounded saving, no risk.
 *
 * Only for a candidate whose provider reads the marks; the runtime decides
 * that from the registry, not from the model's name here.
 */
export function cacheMarksMiddleware() {
  return createMiddleware({
    name: "productops-cache-marks",
    wrapModelCall: async (request, handler) => {
      const system = request.systemMessage;
      const systemText = system === undefined ? "" : textOf(system.content);

      let markedRequest = false;
      const messages = request.messages.map((message: BaseMessage) => {
        // The first human message is the trusted request, and the only one:
        // the transcript after it is tool rounds. Marking it closes the
        // cacheable prefix just before the part that changes every turn.
        if (markedRequest || !(message instanceof HumanMessage)) return message;
        markedRequest = true;
        return new HumanMessage({ ...message, content: cacheMarked(textOf(message.content)) });
      });

      return handler({
        ...request,
        messages,
        ...(systemText.length > 0
          ? { systemMessage: new SystemMessage({ content: cacheMarked(systemText) }) }
          : {}),
      });
    },
  });
}
