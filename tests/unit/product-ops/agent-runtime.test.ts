import { describe, expect, it } from "vitest";

import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { createTurnBudget } from "@/lib/ai/gateway/budgeter";
import type { TrainerModel } from "@/lib/ai/gateway/langchain-model";
import {
  ANSWER_TOOL,
  runAgent,
  type AgentDeps,
  type AgentRequest,
} from "@/lib/product-ops/agents/runtime";
import type { ToolProgress } from "@/lib/product-ops/agents/middleware";
import {
  FakeToolCallingModel,
  UnavailableModel,
  toolCallMessage,
} from "../../support/fake-tool-calling-model";

/**
 * The shared agent loop.
 *
 * A scripted model stands in for the tier's ladder, so what is asserted is
 * everything the runtime adds around a model: the fence on every tool result,
 * the progress it reports, the euro cost it accounts, the caps that end a
 * runaway loop, the ladder walked on an unavailable model, and the validation
 * of the answer against the schema the prompt was generated from.
 */

const answerSchema = z.strictObject({
  summary: z.string().min(1),
  count: z.number().int(),
});

type Answer = z.infer<typeof answerSchema>;

const ANSWER: Answer = { summary: "done", count: 2 };

/** One assistant turn that ends the loop with the structured answer. */
let answers = 0;
const answer = (value: unknown = ANSWER) =>
  toolCallMessage(ANSWER_TOOL, value as Record<string, unknown>, `answer-${++answers}`);

function ladder(...models: TrainerModel["model"][]): readonly TrainerModel[] {
  return models.map((model, index) => ({
    model,
    modelId: `fake/model-${index}`,
    tier: "cheap",
    cacheMarks: false,
  }));
}

function echoTool(seen: string[] = []) {
  return {
    seen,
    tool: tool(
      async ({ text }) => {
        seen.push(text);
        return JSON.stringify({ echoed: text });
      },
      {
        name: "echo",
        description: "Echoes.",
        schema: z.strictObject({ text: z.string() }),
      },
    ),
  };
}

function request(over: Partial<AgentRequest<Answer>> = {}): AgentRequest<Answer> {
  return {
    agent: "cpo",
    task: "productops.proposal_synthesis",
    tools: [],
    fences: { echo: "market_research" },
    schema: answerSchema,
    message: "Brief: healthcare German",
    limits: { toolCalls: 4, modelCalls: 6 },
    context: {
      requestId: "11111111-1111-4111-8111-111111111111",
      userIdHash: "hash-operator",
      turn: createTurnBudget(0.5),
    },
    ...over,
  };
}

function deps(models: readonly TrainerModel[], over: Partial<AgentDeps> = {}): AgentDeps {
  return { models: () => models, ...over };
}

const textOf = (message: BaseMessage): string =>
  typeof message.content === "string" ? message.content : JSON.stringify(message.content);

describe("a clean run", () => {
  it("returns the validated answer", async () => {
    const model = new FakeToolCallingModel([answer()]);

    const outcome = await runAgent(deps(ladder(model)), request());

    expect(outcome).toMatchObject({ status: "ok", value: ANSWER, toolCalls: 0 });
  });

  it("hands the model the agent's system prompt and the trusted message", async () => {
    const model = new FakeToolCallingModel([answer()]);

    await runAgent(deps(ladder(model)), request());

    const [first] = model.seen;
    expect(textOf(first[0])).toContain("chief product officer");
    expect(textOf(first[0])).toContain("Standing rules for product operations");
    expect(textOf(first.at(-1) as BaseMessage)).toBe("Brief: healthcare German");
  });

  it("runs a tool, fences its result, and counts the call", async () => {
    const { tool: echo, seen } = echoTool();
    const model = new FakeToolCallingModel([
      toolCallMessage("echo", { text: "hello" }),
      answer(),
    ]);

    const outcome = await runAgent(deps(ladder(model)), request({ tools: [echo] }));

    expect(outcome).toMatchObject({ status: "ok", toolCalls: 1 });
    expect(seen).toEqual(["hello"]);

    // The second invocation shows the model what the tool said — fenced.
    const shown = model.seen[1].map(textOf).join("\n");
    expect(shown).toContain("<market_research>");
    expect(shown).toContain("</market_research>");
    expect(shown).toContain("hello");
  });

  it("reports each tool call as progress, without its arguments", async () => {
    const { tool: echo } = echoTool();
    const progress: ToolProgress[] = [];
    const model = new FakeToolCallingModel([
      toolCallMessage("echo", { text: "SECRET-ARG" }),
      answer(),
    ]);

    await runAgent(
      deps(ladder(model), { onProgress: (event) => void progress.push(event) }),
      request({ tools: [echo] }),
    );

    expect(progress).toEqual([{ tool: "echo", ok: true }]);
    expect(JSON.stringify(progress)).not.toContain("SECRET-ARG");
  });

  it("accounts what the run cost, from the turn budget alone", async () => {
    const turn = createTurnBudget(0.5);
    turn.record(0.1); // spent by an earlier stage, not by this agent
    const model = new FakeToolCallingModel([answer()]);

    const outcome = await runAgent(
      deps(ladder(model)),
      request({ context: { requestId: null, userIdHash: null, turn } }),
    );

    // The fake model writes no ledger row, so this agent cost nothing; what
    // an earlier stage spent is not attributed to it.
    expect(outcome.costEur).toBe(0);
  });
});

describe("what ends a run early", () => {
  it("refuses to start without a budget to run inside", async () => {
    const model = new FakeToolCallingModel([answer()]);

    const outcome = await runAgent(
      deps(ladder(model)),
      request({ context: { requestId: null, userIdHash: null } }),
    );

    expect(outcome).toMatchObject({ status: "failed", reason: "over_budget", detail: "no_budget" });
    expect(model.invocations).toBe(0);
  });

  it("stops before the first model call when the run's budget is already spent", async () => {
    const turn = createTurnBudget(0.01);
    turn.record(0.01);
    const model = new FakeToolCallingModel([answer()]);

    const outcome = await runAgent(
      deps(ladder(model)),
      request({ context: { requestId: null, userIdHash: null, turn } }),
    );

    expect(outcome).toMatchObject({ status: "failed", reason: "over_budget" });
    expect(model.invocations).toBe(0);
  });

  it("ends a runaway loop as a typed failure at the tool cap", async () => {
    const { tool: echo, seen } = echoTool();
    // An empty script: the fake keeps calling a tool forever.
    const model = new FakeToolCallingModel(
      Array.from({ length: 20 }, () => toolCallMessage("echo", { text: "again" })),
    );

    const outcome = await runAgent(
      deps(ladder(model)),
      request({ tools: [echo], limits: { toolCalls: 3, modelCalls: 5 } }),
    );

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.reason).toBe("tool_limit");
    expect(seen.length).toBeLessThanOrEqual(3);
  });

  // Every real agent has tools. The call-cap middlewares route a repaired
  // answer through the tools node, so these two scenarios give the loop one.
  it("asks once for a repaired answer, then accepts it", async () => {
    const model = new FakeToolCallingModel([
      answer({ summary: "", count: "two" }),
      answer(),
    ]);

    const outcome = await runAgent(deps(ladder(model)), request({ tools: [echoTool().tool] }));

    expect(outcome).toMatchObject({ status: "ok", value: ANSWER });
    expect(model.invocations).toBe(2);
    // The repair instruction names the problem, not the payload.
    const shown = model.seen[1].map(textOf).join("\n");
    expect(shown).toContain("could not be parsed");
  });

  it("rejects an answer the schema will not accept twice, as invalid_output", async () => {
    const model = new FakeToolCallingModel([
      answer({ summary: "", count: "two" }),
      answer({ summary: "", count: "three" }),
    ]);

    const outcome = await runAgent(deps(ladder(model)), request({ tools: [echoTool().tool] }));

    expect(outcome).toMatchObject({ status: "failed", reason: "invalid_output" });
    expect(model.invocations).toBe(2);
  });

  it("rejects a run that ended in prose twice rather than an answer", async () => {
    // Prose, asked to repair, prose again: the one repair is spent.
    const model = new FakeToolCallingModel([
      new AIMessage("Here is my proposal: ..."),
      new AIMessage("As I said, the proposal is ..."),
    ]);

    const outcome = await runAgent(deps(ladder(model)), request({ tools: [echoTool().tool] }));

    expect(outcome).toMatchObject({ status: "failed", reason: "invalid_output" });
    expect(model.invocations).toBe(2);
  });

  it("fails closed when the ladder is empty", async () => {
    const outcome = await runAgent(deps([]), request());

    expect(outcome).toMatchObject({ status: "failed", reason: "model_unavailable" });
  });
});

describe("the ladder", () => {
  it("falls through to the next candidate when a model has no endpoint", async () => {
    const unavailable = new UnavailableModel();
    const fallback = new FakeToolCallingModel([answer()]);

    const outcome = await runAgent(deps(ladder(unavailable, fallback)), request());

    expect(outcome).toMatchObject({ status: "ok", value: ANSWER });
    expect(unavailable.invocations).toBe(1);
    expect(fallback.invocations).toBe(1);
  });

  it("reports the last candidate's unavailability as a code, never a message", async () => {
    const only = new UnavailableModel();

    const outcome = await runAgent(deps(ladder(only)), request());

    expect(outcome).toMatchObject({ status: "failed", reason: "model_unavailable" });
    if (outcome.status !== "failed") return;
    expect(outcome.detail).toBe("NotFoundError");
    expect(outcome.detail).not.toContain("endpoints");
  });
});
