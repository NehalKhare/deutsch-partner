import { describe, expect, it, vi } from "vitest";

import { learningEvaluationSchema } from "@dp/domain/evaluation";
import { MAX_REPAIR_ATTEMPTS, createEvaluator } from "@/lib/ai/evaluation/evaluate";
import { gatewayFail, gatewayOk } from "@dp/gateway/errors";
import type { GatewayPrompt, ModelGateway } from "@dp/gateway/gateway";
import { promptEntry, repairInstruction } from "@dp/prompts";
import { createLogger } from "@dp/observability/logger";

const CONTEXT = { requestId: "11111111-1111-4111-8111-111111111111", userIdHash: "hash-a" };

const MESSAGE = "Ich fahre morgen mit den Zug nach Berlin, weil ich meine Schwester besuche.";

const EVALUATION = {
  estimatedLevel: "A2",
  levelConfidence: 0.6,
  vocabularyUsed: ["fahren", "der Zug"],
  vocabularyWeaknesses: [],
  grammarPatternsUsed: ["dative_prepositions"],
  errors: [
    {
      errorType: "case_dative",
      excerpt: "mit den Zug",
      corrected: "mit dem Zug",
      explanation: "mit takes the dative.",
    },
  ],
  skillEstimates: { fluency: 0.5, comprehension: 0.6, accuracy: 0.4, range: 0.3 },
  masterySignals: [{ lemma: "fahren", direction: "up" }],
  reviewCandidates: ["der Zug"],
  recommendationSignals: ["dative_practice"],
};

/** A gateway that returns the given texts in order, one per call. */
function gatewayReturning(...texts: string[]) {
  const prompts: GatewayPrompt[] = [];
  let call = 0;
  const gateway: ModelGateway = {
    async complete(_spec, prompt) {
      prompts.push(prompt);
      const text = texts[Math.min(call, texts.length - 1)];
      call += 1;
      return gatewayOk({
        text,
        truncated: false,
        degraded: false,
        tier: "mid",
        modelIdResolved: "vendor/model",
        inputTokens: 500,
        outputTokens: 300,
        costUsd: 0.0005,
        costEur: 0.00046,
        attempts: 1,
        ledgerId: call,
        citations: [],
      });
    },
    async stream() {
      throw new Error("evaluation does not stream");
    },
  };
  return { gateway, prompts, calls: () => call };
}

const evaluatorFor = (gateway: ModelGateway, sink?: (line: string) => void) =>
  createEvaluator({ gateway, logger: createLogger({ sink: sink ?? (() => {}) }) });

const request = (over: Record<string, unknown> = {}) => ({
  learnerMessage: MESSAGE,
  cefr: "A2" as const,
  ...over,
});

describe("a clean evaluation", () => {
  it("returns the validated structure", async () => {
    const { gateway } = gatewayReturning(JSON.stringify(EVALUATION));

    const outcome = await evaluatorFor(gateway).evaluateLearnerMessage(
      request(),
      CONTEXT,
    );

    expect(outcome.status).toBe("evaluated");
    if (outcome.status !== "evaluated") return;
    expect(outcome.evaluation.estimatedLevel).toBe("A2");
    expect(outcome.evaluation.errors[0].errorType).toBe("case_dative");
    expect(outcome.recovered).toBe(false);
    expect(outcome.attempts).toBe(1);
  });

  it("returns exactly what the domain schema accepts", async () => {
    const { gateway } = gatewayReturning(JSON.stringify(EVALUATION));

    const outcome = await evaluatorFor(gateway).evaluateLearnerMessage(
      request(),
      CONTEXT,
    );

    expect(outcome.status).toBe("evaluated");
    if (outcome.status !== "evaluated") return;
    expect(learningEvaluationSchema.safeParse(outcome.evaluation).success).toBe(true);
  });

  it("reports what the call cost", async () => {
    const { gateway } = gatewayReturning(JSON.stringify(EVALUATION));

    const outcome = await evaluatorFor(gateway).evaluateLearnerMessage(
      request(),
      CONTEXT,
    );

    expect(outcome.status === "evaluated" && outcome.costEur).toBeCloseTo(0.00046, 10);
  });

  it("digs the object out of a fenced response", async () => {
    const { gateway } = gatewayReturning(
      "Here is the evaluation:\n```json\n" + JSON.stringify(EVALUATION) + "\n```\nHope that helps.",
    );

    expect(
      (await evaluatorFor(gateway).evaluateLearnerMessage(request(), CONTEXT)).status,
    ).toBe("evaluated");
  });
});

describe("the prompt it sends", () => {
  it("states the contract the reply is validated against", async () => {
    const { gateway, prompts } = gatewayReturning(JSON.stringify(EVALUATION));

    await evaluatorFor(gateway).evaluateLearnerMessage(request(), CONTEXT);

    expect(prompts[0].system).toContain("estimatedLevel: one of: A1 | A2 | B1");
    expect(prompts[0].system).toContain("skillEstimates:");
  });

  it("fences the learner's message rather than pasting it in", async () => {
    const { gateway, prompts } = gatewayReturning(JSON.stringify(EVALUATION));

    await evaluatorFor(gateway).evaluateLearnerMessage(request(), CONTEXT);

    expect(prompts[0].user).toContain("<user_message>");
    expect(prompts[0].user).toContain(MESSAGE);
  });

  it("includes the tutor's preceding turn, without which comprehension is a guess", async () => {
    const { gateway, prompts } = gatewayReturning(JSON.stringify(EVALUATION));

    await evaluatorFor(gateway).evaluateLearnerMessage(
      request({
        precedingTurns: [{ role: "assistant", content: "Wohin fährst du am Wochenende?" }],
      }),
      CONTEXT,
    );

    expect(prompts[0].system).toContain("Wohin fährst du am Wochenende?");
  });

  it("never tells the model what level we already think the learner is", async () => {
    // An estimate that only ever agrees with the stored value is an estimate
    // that can never move anybody.
    const { gateway, prompts } = gatewayReturning(JSON.stringify(EVALUATION));

    await evaluatorFor(gateway).evaluateLearnerMessage(request(), CONTEXT);

    expect(prompts[0].system).not.toContain("The learner is at");
    expect(prompts[0].system).not.toContain("mini-level");
  });

  it("records the prompt's version, not the turn's content", async () => {
    // A fingerprint that changes with the conversation records nothing about
    // the prompt.
    const complete = vi.fn().mockResolvedValue(
      gatewayOk({
        text: JSON.stringify(EVALUATION),
        truncated: false,
        degraded: false,
        tier: "mid",
        modelIdResolved: "m",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
        costEur: 0,
        attempts: 1,
        ledgerId: 1,
        citations: [],
      }),
    );
    const evaluator = createEvaluator({
      gateway: { complete, stream: vi.fn() } as unknown as ModelGateway,
    });

    await evaluator.evaluateLearnerMessage(request(), CONTEXT);
    await evaluator.evaluateLearnerMessage(
      request({ learnerMessage: "Ein ganz anderer Satz über Kaffee und Kuchen." }),
      CONTEXT,
    );

    const first = complete.mock.calls[0][2].prompt;
    const second = complete.mock.calls[1][2].prompt;

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first).toMatchObject({
      name: "evaluation.learner_message",
      version: promptEntry("evaluation.learner_message").version,
    });
  });

  it("declares the schema on the call spec, as a structured task must", async () => {
    const complete = vi.fn().mockResolvedValue(
      gatewayOk({
        text: JSON.stringify(EVALUATION),
        truncated: false,
        degraded: false,
        tier: "mid",
        modelIdResolved: "m",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
        costEur: 0,
        attempts: 1,
        ledgerId: 1,
        citations: [],
      }),
    );

    await createEvaluator({
      gateway: { complete, stream: vi.fn() } as unknown as ModelGateway,
    }).evaluateLearnerMessage(request(), CONTEXT);

    expect(complete.mock.calls[0][0]).toMatchObject({
      task: "evaluation.learner_message",
      tier: "mid",
      maxOutputTokens: 800,
    });
    expect(complete.mock.calls[0][0].outputSchema).toBe(learningEvaluationSchema);
  });
});

describe("triage", () => {
  it("evaluates nothing for a one-word reply and calls no model", async () => {
    const { gateway, calls } = gatewayReturning(JSON.stringify(EVALUATION));

    const outcome = await evaluatorFor(gateway).evaluateLearnerMessage(
      request({ learnerMessage: "Danke!" }),
      CONTEXT,
    );

    expect(outcome).toEqual({ status: "skipped", reason: "formulaic" });
    expect(calls()).toBe(0);
  });

  it("evaluates nothing for an emoji", async () => {
    const { gateway, calls } = gatewayReturning(JSON.stringify(EVALUATION));

    await evaluatorFor(gateway).evaluateLearnerMessage(
      request({ learnerMessage: "👍" }),
      CONTEXT,
    );

    expect(calls()).toBe(0);
  });
});

describe("malformed output", () => {
  it("repairs once and accepts the corrected reply", async () => {
    const { gateway, calls, prompts } = gatewayReturning(
      "I could not do that.",
      JSON.stringify(EVALUATION),
    );

    const outcome = await evaluatorFor(gateway).evaluateLearnerMessage(
      request(),
      CONTEXT,
    );

    expect(outcome.status).toBe("evaluated");
    expect(calls()).toBe(2);
    expect(prompts[1].user).toContain("could not be parsed");
  });

  it("never retries more than once", async () => {
    const { gateway, calls } = gatewayReturning("not json", "still not json", "nor this");

    const outcome = await evaluatorFor(gateway).evaluateLearnerMessage(
      request(),
      CONTEXT,
    );

    expect(outcome).toMatchObject({ status: "failed", reason: "unusable_output" });
    expect(calls()).toBe(MAX_REPAIR_ATTEMPTS + 1);
  });

  it("gives no evaluation rather than a guessed one", async () => {
    // The safe path for evaluation is silence: nothing is written and the
    // learner's stored state stands.
    const { gateway } = gatewayReturning("not json");

    const outcome = await evaluatorFor(gateway).evaluateLearnerMessage(
      request(),
      CONTEXT,
    );

    expect(outcome).not.toHaveProperty("evaluation");
  });

  it("accounts for every attempt it made", async () => {
    const { gateway } = gatewayReturning("not json", "still not json");

    const outcome = await evaluatorFor(gateway).evaluateLearnerMessage(
      request(),
      CONTEXT,
    );

    expect(outcome.status === "failed" && outcome.costEur).toBeCloseTo(0.00092, 10);
  });

  it("rejects a response too large to be an evaluation", async () => {
    const { gateway } = gatewayReturning(`{"x":"${"y".repeat(200_000)}"}`);

    expect(
      (await evaluatorFor(gateway).evaluateLearnerMessage(request(), CONTEXT)).status,
    ).toBe("failed");
  });

  it("logs the issue paths and never the payload", async () => {
    const lines: string[] = [];
    const { gateway } = gatewayReturning(
      JSON.stringify({ ...EVALUATION, estimatedLevel: "C2" }),
      "still wrong",
    );

    await evaluatorFor(gateway, (line) => lines.push(line)).evaluateLearnerMessage(
      request(),
      CONTEXT,
    );

    const logged = lines.join("\n");
    expect(logged).toContain("evaluation.output_invalid");
    expect(logged).toContain("estimatedLevel");
    expect(logged).not.toContain("mit dem Zug");
  });
});

describe("partial output recovery", () => {
  it("keeps the good part of a nearly-valid reply without a second call", async () => {
    const { gateway, calls } = gatewayReturning(
      JSON.stringify({
        ...EVALUATION,
        errors: [
          EVALUATION.errors[0],
          { errorType: "invented", excerpt: "x", corrected: "y", explanation: "z" },
        ],
      }),
    );

    const outcome = await evaluatorFor(gateway).evaluateLearnerMessage(
      request(),
      CONTEXT,
    );

    expect(outcome.status).toBe("evaluated");
    if (outcome.status !== "evaluated") return;
    expect(outcome.recovered).toBe(true);
    expect(outcome.evaluation.errors).toHaveLength(1);
    expect(outcome.repairs).toContain("errors[1]: dropped");
    // Recovery is free; a repair call is not.
    expect(calls()).toBe(1);
  });

  it("clamps an overshot score rather than repairing", async () => {
    const { gateway, calls } = gatewayReturning(
      JSON.stringify({
        ...EVALUATION,
        skillEstimates: { ...EVALUATION.skillEstimates, fluency: 1.4 },
      }),
    );

    const outcome = await evaluatorFor(gateway).evaluateLearnerMessage(
      request(),
      CONTEXT,
    );

    expect(outcome.status === "evaluated" && outcome.evaluation.skillEstimates.fluency).toBe(1);
    expect(calls()).toBe(1);
  });

  it("repairs rather than recovering when the level itself is wrong", async () => {
    // A level is not salvageable, and guessing one moves a learner.
    const { gateway, calls } = gatewayReturning(
      JSON.stringify({ ...EVALUATION, estimatedLevel: "C1" }),
      JSON.stringify(EVALUATION),
    );

    const outcome = await evaluatorFor(gateway).evaluateLearnerMessage(
      request(),
      CONTEXT,
    );

    expect(outcome.status).toBe("evaluated");
    expect(outcome.status === "evaluated" && outcome.recovered).toBe(false);
    expect(calls()).toBe(2);
  });

  it("recovers on the repaired reply when the repair is still imperfect", async () => {
    const { gateway } = gatewayReturning(
      "not json at all",
      JSON.stringify({ ...EVALUATION, vocabularyUsed: ["fahren", 42] }),
    );

    const outcome = await evaluatorFor(gateway).evaluateLearnerMessage(
      request(),
      CONTEXT,
    );

    expect(outcome.status === "evaluated" && outcome.recovered).toBe(true);
    expect(outcome.status === "evaluated" && outcome.evaluation.vocabularyUsed).toEqual([
      "fahren",
    ]);
  });
});

describe("when the model cannot be reached", () => {
  it("reports a budget denial as over budget, without retrying", async () => {
    const complete = vi.fn().mockResolvedValue(gatewayFail("budget_denied", "over"));

    const outcome = await createEvaluator({
      gateway: { complete, stream: vi.fn() } as unknown as ModelGateway,
    }).evaluateLearnerMessage(request(), CONTEXT);

    expect(outcome).toMatchObject({ status: "failed", reason: "over_budget" });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("reports a provider failure without retrying", async () => {
    const complete = vi.fn().mockResolvedValue(gatewayFail("provider_error", "502"));

    const outcome = await createEvaluator({
      gateway: { complete, stream: vi.fn() } as unknown as ModelGateway,
    }).evaluateLearnerMessage(request(), CONTEXT);

    expect(outcome).toMatchObject({ status: "failed", reason: "model_unavailable" });
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe("the repair instruction", () => {
  it("names the failing paths", () => {
    expect(repairInstruction(["errors.0.errorType: invalid_value"])).toContain(
      "errors.0.errorType",
    );
  });

  it("asks for the object and nothing else", () => {
    expect(repairInstruction(["x"])).toMatch(/corrected JSON object only/i);
  });

  it("does not grow without bound when everything failed", () => {
    const many = Array.from({ length: 200 }, (_v, i) => `field${i}: invalid`);

    expect(repairInstruction(many)).not.toContain("field9:");
  });
});
