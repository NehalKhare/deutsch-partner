import { describe, expect, it } from "vitest";

import { gatewayOk } from "@dp/gateway/errors";
import type { ModelGateway } from "@dp/gateway/gateway";
import { createTurnBudget } from "@dp/gateway/budgeter";
import {
  createAnswerAnalyzer,
  renderAnalysisBlock,
} from "@/lib/trainer/analysis";
import type { AnswerAnalysis } from "@dp/domain/trainer-analysis";

/**
 * The analyzer against a scripted gateway. What matters: the call runs under
 * the analyzer's own task with the request's shared budget forwarded, output
 * is validated before anything reads it, and every failure — bad JSON, a
 * refusal, a dead provider — is a skipped value, never a throw. There is
 * deliberately no repair pass to assert: one call, then the trainer judges
 * unaided.
 */

const CONTEXT = {
  requestId: "33333333-3333-4333-8333-333333333333",
  userIdHash: "hash-alice",
  turn: createTurnBudget(0.05),
};

const ANALYSIS: AnswerAnalysis = {
  verdict: "partially_correct",
  findings: [
    {
      errorType: "case_dative",
      excerpt: "mit der Zug",
      corrected: "mit dem Zug",
      note: 'After "mit" the noun takes the dative: "mit dem Zug".',
    },
  ],
  anglicisms: [{ excerpt: "Ich bin kalt", idiomatic: "Mir ist kalt" }],
  vocabularyElevation: [],
  register: { verdict: "appropriate" },
};

function scriptedGateway(replies: ReadonlyArray<string | Error>) {
  const calls: Array<{ spec: unknown; prompt: unknown; context: unknown }> = [];
  const queue = [...replies];

  const gateway = {
    complete: async (spec: unknown, prompt: unknown, context: unknown) => {
      calls.push({ spec, prompt, context });
      const next = queue.shift();
      if (next instanceof Error) {
        return { ok: false as const, failure: "provider_error", detail: next.message };
      }
      return gatewayOk({ text: next ?? "", costEur: 0.0009 });
    },
    stream: async () => {
      throw new Error("the analyzer never streams");
    },
  } as unknown as ModelGateway;

  return { gateway, calls };
}

const REQUEST = {
  message: "Ich fahre mit der Zug.",
  cefr: "A2" as const,
  precedingTurns: [
    { role: "assistant" as const, content: "Wie fährst du zur Arbeit?" },
  ],
};

describe("a valid verdict", () => {
  it("comes back typed, with the shared budget and task forwarded", async () => {
    const { gateway, calls } = scriptedGateway([JSON.stringify(ANALYSIS)]);
    const analyzer = createAnswerAnalyzer({ gateway });

    const outcome = await analyzer.analyze(REQUEST, CONTEXT);

    expect(outcome.status).toBe("analyzed");
    if (outcome.status !== "analyzed") return;
    expect(outcome.analysis.verdict).toBe("partially_correct");
    expect(outcome.analysis.findings[0]?.errorType).toBe("case_dative");
    expect(outcome.costEur).toBeCloseTo(0.0009);

    expect(calls).toHaveLength(1);
    const call = calls[0] as {
      spec: { task: string; tier: string };
      context: { turn: unknown; prompt: { name: string; version: number } };
    };
    expect(call.spec.task).toBe("trainer.answer_analysis");
    expect(call.spec.tier).toBe("cheap");
    // The same accumulator the loop spends from, so one ceiling bounds both.
    expect(call.context.turn).toBe(CONTEXT.turn);
    expect(call.context.prompt.name).toBe("trainer.answer_analysis");
  });

  it("shows the trainer's preceding question to the model", async () => {
    const { gateway, calls } = scriptedGateway([JSON.stringify(ANALYSIS)]);

    await createAnswerAnalyzer({ gateway }).analyze(REQUEST, CONTEXT);

    const prompt = (calls[0] as { prompt: { system: string; user: string } }).prompt;
    expect(`${prompt.system}\n${prompt.user}`).toContain("Wie fährst du zur Arbeit?");
    expect(prompt.user).toContain("Ich fahre mit der Zug.");
  });
});

describe("failures are values", () => {
  it("skips unparseable output after exactly one call", async () => {
    const { gateway, calls } = scriptedGateway(["no json here"]);

    const outcome = await createAnswerAnalyzer({ gateway }).analyze(REQUEST, CONTEXT);

    expect(outcome).toEqual({ status: "skipped", reason: "invalid_output" });
    expect(calls).toHaveLength(1);
  });

  it("skips output that parses but breaks the schema", async () => {
    const { gateway } = scriptedGateway([
      JSON.stringify({ ...ANALYSIS, verdict: "sublime" }),
    ]);

    const outcome = await createAnswerAnalyzer({ gateway }).analyze(REQUEST, CONTEXT);

    expect(outcome).toEqual({ status: "skipped", reason: "invalid_output" });
  });

  it("reads a budget refusal as over_budget", async () => {
    const gateway = {
      complete: async () => ({
        ok: false as const,
        failure: "budget_denied",
        detail: "per_request",
      }),
    } as unknown as ModelGateway;

    const outcome = await createAnswerAnalyzer({ gateway }).analyze(REQUEST, CONTEXT);

    expect(outcome).toEqual({ status: "skipped", reason: "over_budget" });
  });

  it("reads a provider failure as model_unavailable", async () => {
    const { gateway } = scriptedGateway([new Error("boom")]);

    const outcome = await createAnswerAnalyzer({ gateway }).analyze(REQUEST, CONTEXT);

    expect(outcome).toEqual({ status: "skipped", reason: "model_unavailable" });
  });
});

describe("the rendered block", () => {
  it("frames outside the fence and quotes the learner inside it", () => {
    const block = renderAnalysisBlock(ANALYSIS);

    expect(block).toContain("<answer_analysis>");
    expect(block).toContain("</answer_analysis>");
    // The framing instruction sits before the fence opens.
    expect(block.indexOf("machine check")).toBeLessThan(
      block.indexOf("<answer_analysis>"),
    );
    // The learner's German is inside the fence, angle brackets neutralised.
    const fenced = block.slice(block.indexOf("<answer_analysis>"));
    expect(fenced).toContain("mit der Zug");
    expect(fenced).not.toContain("<script");
  });
});
