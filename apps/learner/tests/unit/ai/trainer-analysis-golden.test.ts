import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  answerAnalysisSchema,
  type AnswerAnalysis,
} from "@dp/domain/trainer-analysis";
import { createTurnBudget } from "@dp/gateway/budgeter";
import { gatewayOk } from "@dp/gateway/errors";
import type { ModelGateway } from "@dp/gateway/gateway";
import { createAnswerAnalyzer } from "@/lib/trainer/analysis";
import { shouldAnalyze } from "@/lib/trainer/analysis-gate";

/**
 * The analyzer's golden set — the first evalSet declaration in the catalogue
 * that a corpus actually stands behind.
 *
 * Deterministic on purpose: no live model is called. What this holds down is
 * everything around the model — the gate's decisions case by case, the schema
 * over realistic verdicts, and the pipeline from a raw completion to a typed
 * outcome. A live-eval runner can consume the same file unchanged and compare
 * a real model's output to each case's expectations.
 */

interface GoldenCase {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly gate: string;
  readonly analysis?: AnswerAnalysis;
  readonly expected?: {
    readonly verdict: string;
    readonly errorTypes: readonly string[];
    readonly register: string;
  };
}

const GOLDEN = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests", "golden", "trainer-answer-analysis.json"),
    "utf8",
  ),
) as { cases: readonly GoldenCase[] };

const analyzed = GOLDEN.cases.filter((entry) => entry.gate === "analyze");
const skipped = GOLDEN.cases.filter((entry) => entry.gate !== "analyze");

const CONTEXT = {
  requestId: "33333333-3333-4333-8333-333333333333",
  userIdHash: "hash-golden",
  turn: createTurnBudget(0.05),
};

function gatewayReturning(text: string): ModelGateway {
  return {
    complete: async () => gatewayOk({ text, costEur: 0.0009 }),
    stream: async () => {
      throw new Error("the analyzer never streams");
    },
  } as unknown as ModelGateway;
}

describe("the corpus itself", () => {
  it("holds enough cases to mean something", () => {
    expect(GOLDEN.cases.length).toBeGreaterThanOrEqual(12);
    expect(analyzed.length).toBeGreaterThanOrEqual(8);
    expect(skipped.length).toBeGreaterThanOrEqual(3);
  });

  it("gives every case a unique id", () => {
    const ids = GOLDEN.cases.map((entry) => entry.id);

    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it.each(analyzed.map((entry) => [entry.id, entry] as const))(
    "%s carries a reference verdict the schema accepts",
    (_id, entry) => {
      const parsed = answerAnalysisSchema.safeParse(entry.analysis);

      expect(parsed.success).toBe(true);
      expect(entry.expected).toBeDefined();
    },
  );
});

describe("the gate over the corpus", () => {
  it.each(GOLDEN.cases.map((entry) => [entry.id, entry] as const))(
    "%s is gated as annotated",
    (_id, entry) => {
      const gate = shouldAnalyze(entry.answer);

      if (entry.gate === "analyze") {
        expect(gate).toEqual({ analyze: true });
      } else {
        expect(gate).toEqual({ analyze: false, reason: entry.gate });
      }
    },
  );
});

describe("the pipeline over the corpus", () => {
  it.each(analyzed.map((entry) => [entry.id, entry] as const))(
    "%s flows from completion to typed verdict",
    async (_id, entry) => {
      const analyzer = createAnswerAnalyzer({
        gateway: gatewayReturning(JSON.stringify(entry.analysis)),
      });

      const outcome = await analyzer.analyze(
        {
          message: entry.answer,
          cefr: "A2",
          precedingTurns: [{ role: "assistant", content: entry.question }],
        },
        CONTEXT,
      );

      expect(outcome.status).toBe("analyzed");
      if (outcome.status !== "analyzed") return;

      const expected = entry.expected!;
      expect(outcome.analysis.verdict).toBe(expected.verdict);
      expect(outcome.analysis.register.verdict).toBe(expected.register);

      const found = new Set(
        outcome.analysis.findings.map((finding) => finding.errorType),
      );
      for (const errorType of expected.errorTypes) {
        expect(found.has(errorType as never), `${_id} misses ${errorType}`).toBe(true);
      }
    },
  );
});
