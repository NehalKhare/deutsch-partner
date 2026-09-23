import { describe, expect, it } from "vitest";

import { isDeterministicOnly, resolveTask } from "../src/router";
import { DETERMINISTIC_ONLY, TASK_IDS, type TaskId, type Tier } from "@dp/domain/tasks";

/**
 * The routing table, transcribed a second time.
 *
 * Deliberately not imported from the module under test: a test that reads the
 * same constant it is checking asserts nothing. This copy comes from
 * model-routing-and-cost-control.md S4 and S6 — and, for the product-ops tasks,
 * from product-ops-spec.md S6 — so a drift between the document
 * and the code shows up here rather than on a bill.
 */
const EXPECTED: Readonly<Record<TaskId, { tier: Tier; input: number; output: number }>> = {
  "conversation.turn": { tier: "strong", input: 6000, output: 700 },
  "conversation.repair": { tier: "strong", input: 6000, output: 700 },
  "evaluation.learner_message": { tier: "mid", input: 3000, output: 800 },
  "assessment.milestone": { tier: "reasoning", input: 8000, output: 1500 },
  "assessment.mini_level_check": { tier: "mid", input: 3000, output: 600 },
  "assessment.onboarding": { tier: "mid", input: 3000, output: 800 },
  "extraction.errors": { tier: "cheap", input: 2000, output: 400 },
  "extraction.memory": { tier: "cheap", input: 3000, output: 300 },
  "extraction.vocabulary_usage": { tier: "cheap", input: 1500, output: 300 },
  "summarization.thread": { tier: "cheap", input: 6000, output: 400 },
  "classification.intent": { tier: "nano", input: 800, output: 20 },
  "classification.topic": { tier: "nano", input: 800, output: 20 },
  "classification.language": { tier: "nano", input: 400, output: 10 },
  "classification.safety_screen": { tier: "nano", input: 1000, output: 10 },
  "recommendation.tiebreak": { tier: "cheap", input: 1500, output: 150 },
  "retrieval.query_rewrite": { tier: "cheap", input: 600, output: 120 },
  "ingestion.metadata_tagging": { tier: "cheap", input: 4000, output: 400 },
  // Section 4 routes these to the embedding tier; section 6 sets no ceiling
  // for them, so the input ceiling is the model's context window and the
  // output ceiling is zero. An embedding emits a vector, not tokens.
  "ingestion.embedding": { tier: "embedding", input: 8191, output: 0 },
  "retrieval.embedding": { tier: "embedding", input: 8191, output: 0 },
  // Strong, like the tutor: the best tier a seven-invocation loop can afford
  // under a €0.05 per-request ceiling. The tier's full output allowance, too —
  // a reasoning model spends that budget before it writes, and a correction
  // that names the rule and shows two sentences came back cut off at 700.
  "trainer.session": { tier: "strong", input: 6000, output: 1000 },
  // The Trainer's specialists: one structured pass each, cheap like the other
  // extractors against the same closed taxonomy. The analyzer shares the
  // session's €0.05 request ceiling; the miner runs post-response on its own.
  "trainer.answer_analysis": { tier: "cheap", input: 2000, output: 500 },
  "trainer.session_mining": { tier: "cheap", input: 4000, output: 600 },
  // product-ops-spec.md S6. Research is extraction on the cheap tier, which
  // also has the largest input allowance of any tier — what a page of search
  // results needs. The judgement that follows it, and the two coding tasks,
  // are reasoning. The 2000 on code_edit is the reasoning tier's own maximum,
  // which is why an edit is an anchor and a replacement rather than a file.
  "productops.market_research": { tier: "cheap", input: 8000, output: 600 },
  "productops.proposal_synthesis": { tier: "reasoning", input: 12000, output: 2000 },
  "productops.prd_sections": { tier: "mid", input: 6000, output: 1000 },
  "productops.code_plan": { tier: "reasoning", input: 12000, output: 2000 },
  "productops.plan_breakdown": { tier: "reasoning", input: 12000, output: 2000 },
  "productops.code_edit": { tier: "reasoning", input: 12000, output: 2000 },
  // The agents' summarisation middleware: compression of fenced tool output,
  // cheap like every other summariser in the table.
  "productops.context_summary": { tier: "cheap", input: 8000, output: 400 },
};

describe("task router", () => {
  it.each(TASK_IDS)("routes %s to the tier and ceilings the table declares", (task) => {
    const resolved = resolveTask(task);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(resolved.data.tier).toBe(EXPECTED[task].tier);
    expect(resolved.data.maxInputTokens).toBe(EXPECTED[task].input);
    expect(resolved.data.maxOutputTokens).toBe(EXPECTED[task].output);
  });

  it("covers every task in the table and invents none", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...TASK_IDS].sort());
  });

  it("rejects a task id that is not in the table", () => {
    const resolved = resolveTask("conversation.smalltalk");

    expect(resolved).toMatchObject({ ok: false, failure: "unknown_task" });
  });

  it.each([null, undefined, 42, { task: "conversation.turn" }])(
    "rejects %s rather than coercing it into a route",
    (value) => {
      expect(resolveTask(value)).toMatchObject({ ok: false, failure: "unknown_task" });
    },
  );

  it("narrows conversation.turn to the level the learner is at", () => {
    const a1 = resolveTask("conversation.turn", "A1");
    const b1 = resolveTask("conversation.turn", "B1");

    expect(a1.ok && a1.data.maxOutputTokens).toBe(300);
    expect(a1.ok && a1.data.maxInputTokens).toBe(4000);
    expect(b1.ok && b1.data.maxOutputTokens).toBe(700);
  });

  it("ignores a level for a task whose ceilings do not vary by level", () => {
    const withLevel = resolveTask("extraction.errors", "B1");
    const without = resolveTask("extraction.errors");

    expect(withLevel).toEqual(without);
  });

  it("keeps the deterministic work out of the table entirely", () => {
    for (const name of DETERMINISTIC_ONLY) {
      expect(isDeterministicOnly(name)).toBe(true);
      expect(resolveTask(name)).toMatchObject({ ok: false, failure: "unknown_task" });
    }
  });

  it("does not treat a real task as deterministic-only", () => {
    expect(isDeterministicOnly("conversation.turn")).toBe(false);
  });
});
