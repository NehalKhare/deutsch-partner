import { ToolMessage } from "@langchain/core/messages";
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

export type AgentProgress = ToolProgress;

/**
 * Reports each tool call as it completes. The tool's name and whether it
 * succeeded — never its arguments or its result, both of which are model
 * output or untrusted content and neither of which belongs on a timeline.
 */
export function progressMiddleware(
  report: (progress: ToolProgress) => Promise<void> | void,
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
  });
}
