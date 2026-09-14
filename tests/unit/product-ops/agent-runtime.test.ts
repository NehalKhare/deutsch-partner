import { describe, expect, it } from "vitest";

import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { createTurnBudget } from "@/lib/ai/gateway/budgeter";
import type { TrainerModel } from "@/lib/ai/gateway/langchain-model";
import {
  ANSWER_TOOL,
  GRAPH_STEPS_PER_ROUND,
  recursionLimitFor,
  runAgent,
  type AgentDeps,
  type AgentRequest,
} from "@/lib/product-ops/agents/runtime";
import type { AgentProgress } from "@/lib/product-ops/agents/middleware";
import {
  FakeToolCallingModel,
  TimeoutModel,
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

/** The same ladder, for candidates whose provider reads cache marks. */
function markedLadder(...models: TrainerModel["model"][]): readonly TrainerModel[] {
  return ladder(...models).map((candidate) => ({ ...candidate, cacheMarks: true }));
}

const markOf = (message: BaseMessage) =>
  typeof message.content === "string"
    ? undefined
    : (message.content[0] as { cache_control?: unknown }).cache_control;

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
    const progress: AgentProgress[] = [];
    const model = new FakeToolCallingModel([
      toolCallMessage("echo", { text: "SECRET-ARG" }),
      answer(),
    ]);

    await runAgent(
      deps(ladder(model), { onProgress: (event) => void progress.push(event) }),
      request({ tools: [echo] }),
    );

    // The model call that asked for the tool, the tool, and the model call
    // that answered. Never the tool's arguments.
    expect(progress).toEqual([{ model: "call" }, { tool: "echo", ok: true }, { model: "call" }]);
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

  it("lets a long but bounded loop finish, with every middleware node counted", async () => {
    // Twenty tool rounds, then an answer, under caps that allow them. The
    // first real planning run died at the graph's recursion limit after a
    // handful of reads because the limit counted rounds and the stack's
    // hooks each count as a step.
    const { tool: echo } = echoTool();
    const model = new FakeToolCallingModel([
      ...Array.from({ length: 20 }, (_, index) =>
        toolCallMessage("echo", { text: `read ${index}` }, `call-${index}`),
      ),
      answer(),
    ]);

    const outcome = await runAgent(
      deps(ladder(model)),
      request({ tools: [echo], limits: { toolCalls: 24, modelCalls: 26 } }),
    );

    expect(outcome).toMatchObject({ status: "ok", value: ANSWER, toolCalls: 20 });
    expect(model.invocations).toBe(21);
  });

  it("sizes the graph's recursion limit from the caps, with room for every hook", () => {
    expect(recursionLimitFor({ toolCalls: 16, modelCalls: 18 })).toBe(
      34 * GRAPH_STEPS_PER_ROUND + 2,
    );
    expect(GRAPH_STEPS_PER_ROUND).toBeGreaterThanOrEqual(8);
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

  it("trims a batch that asks for more calls than remain, and lets the loop answer", async () => {
    // Two allowed; the model asks for three at once, then answers. The first
    // real plan asked for a dozen reads in one turn and, with the cap set to
    // throw, the stage ended before a single file was read.
    const { tool: echo, seen } = echoTool();
    const model = new FakeToolCallingModel([
      new AIMessage({
        content: "",
        tool_calls: ["a", "b", "c"].map((id) => ({
          name: "echo",
          args: { text: id },
          id: `call-${id}`,
          type: "tool_call" as const,
        })),
      }),
      answer(),
    ]);

    const outcome = await runAgent(
      deps(ladder(model)),
      request({ tools: [echo], limits: { toolCalls: 2, modelCalls: 6 } }),
    );

    expect(outcome).toMatchObject({ status: "ok", value: ANSWER });
    expect(seen).toEqual(["a", "b"]);
    // The blocked call was answered with a message saying so, not dropped.
    const second = model.seen[1].map(textOf).join("\n");
    expect(second).toContain("limit exceeded");
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

    expect(outcome).toMatchObject({ status: "failed", reason: "invalid_output", detail: "no_answer" });
    expect(model.invocations).toBe(2);
  });

  it("asks for a shorter answer when the ceiling cut the last one off", async () => {
    // The provider says so in the finish reason. Asking for "the corrected
    // object" would get the same object cut off in the same place.
    const cutOff = new AIMessage({
      content: "",
      response_metadata: { finish_reason: "length" },
    });
    const model = new FakeToolCallingModel([cutOff, answer()]);

    const outcome = await runAgent(deps(ladder(model)), request({ tools: [echoTool().tool] }));

    expect(outcome).toMatchObject({ status: "ok", value: ANSWER });
    const shown = model.seen[1].map(textOf).join("\n");
    expect(shown).toContain("cut off");
    expect(shown).toContain("shorter");
  });

  it("treats a tool call whose arguments never finished as cut off too", async () => {
    const halfAnswer = new AIMessage({
      content: "",
      invalid_tool_calls: [
        { name: ANSWER_TOOL, args: '{"summary": "the', id: "half", error: "unterminated", type: "invalid_tool_call" },
      ],
    });
    const model = new FakeToolCallingModel([halfAnswer, halfAnswer]);

    const outcome = await runAgent(deps(ladder(model)), request({ tools: [echoTool().tool] }));

    expect(outcome).toMatchObject({ status: "failed", reason: "invalid_output", detail: "truncated" });
    expect(model.invocations).toBe(2);
  });

  it("names the answer tool when asking a run that ended in prose to try again", async () => {
    // "(root)" tells a model that wrote prose nothing. The tool it did not
    // call does.
    const model = new FakeToolCallingModel([new AIMessage("Here is my proposal: ..."), answer()]);

    const outcome = await runAgent(deps(ladder(model)), request({ tools: [echoTool().tool] }));

    expect(outcome).toMatchObject({ status: "ok", value: ANSWER });
    const shown = model.seen[1].map(textOf).join("\n");
    expect(shown).toContain(ANSWER_TOOL);
    expect(shown).toContain("did not call the answer tool");
    expect(shown).not.toContain("(root)");
  });

  it("fails closed when the ladder is empty", async () => {
    const outcome = await runAgent(deps([]), request());

    expect(outcome).toMatchObject({ status: "failed", reason: "model_unavailable" });
  });
});

describe("prompt-cache marks on a candidate whose provider reads them", () => {
  it("marks the system prompt and the request, and still answers", async () => {
    const model = new FakeToolCallingModel([answer()]);

    const outcome = await runAgent(deps(markedLadder(model)), request());

    expect(outcome).toMatchObject({ status: "ok", value: ANSWER });
    const [system, brief] = model.seen[0];
    expect(markOf(system)).toEqual({ type: "ephemeral" });
    expect(textOf(system)).toContain("chief product officer");
    expect(markOf(brief)).toEqual({ type: "ephemeral" });
    // Marked, and still the same words: the mark wraps the text, it does not
    // change it.
    expect(textOf(brief)).toContain('"text":"Brief: healthcare German"');
  });

  it("sends no marks to a candidate whose provider does not read them", async () => {
    const model = new FakeToolCallingModel([answer()]);

    await runAgent(deps(ladder(model)), request());

    const [system, brief] = model.seen[0];
    expect(markOf(system)).toBeUndefined();
    expect(markOf(brief)).toBeUndefined();
  });

  it("still tells a missing endpoint from a moment, through the framework's wrapper", async () => {
    // A wrapModelCall middleware makes the framework re-throw every model
    // error wrapped. The ladder has to see the 404 underneath.
    const unavailable = new UnavailableModel();
    const fallback = new FakeToolCallingModel([answer()]);

    const outcome = await runAgent(deps(markedLadder(unavailable, fallback)), request());

    expect(outcome).toMatchObject({ status: "ok", value: ANSWER });
    expect(fallback.invocations).toBe(1);
  });

  it("still repairs a rejected answer through the framework's wrapper", async () => {
    const model = new FakeToolCallingModel([answer({ summary: "", count: "two" }), answer()]);

    const outcome = await runAgent(deps(markedLadder(model)), request({ tools: [echoTool().tool] }));

    expect(outcome).toMatchObject({ status: "ok", value: ANSWER });
    expect(model.invocations).toBe(2);
  });

  it("still names a timeout as one through the framework's wrapper", async () => {
    const outcome = await runAgent(deps(markedLadder(new TimeoutModel())), request());

    expect(outcome).toMatchObject({ status: "failed", reason: "timeout", detail: "TimeoutError" });
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

  it("walks to the next candidate when a model runs out of time", async () => {
    // The SDK has retried once by the time a TimeoutError surfaces. A third
    // wait on the same model is what the same-tier fallback exists to avoid.
    const slow = new TimeoutModel();
    const fallback = new FakeToolCallingModel([answer()]);

    const outcome = await runAgent(deps(ladder(slow, fallback)), request());

    expect(outcome).toMatchObject({ status: "ok", value: ANSWER });
    expect(slow.invocations).toBe(1);
    expect(fallback.invocations).toBe(1);
  });

  it("reports a ladder that timed out all the way down as a timeout, by name", async () => {
    const only = new TimeoutModel();

    const outcome = await runAgent(deps(ladder(only)), request());

    expect(outcome).toMatchObject({ status: "failed", reason: "timeout", detail: "TimeoutError" });
    if (outcome.status !== "failed") return;
    expect(outcome.detail).not.toContain("timed out");
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
