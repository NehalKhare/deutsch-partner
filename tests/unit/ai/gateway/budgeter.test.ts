import { describe, expect, it } from "vitest";

import {
  OPTIONAL_TASKS,
  createTurnBudget,
  planTurn,
  preflight,
} from "@/lib/ai/gateway/budgeter";
import type { TaskId } from "@/lib/ai/tasks";

const call = (task: TaskId, estimatedTokens: number) => ({ task, estimatedTokens });

describe("pre-flight input budget", () => {
  it("passes a prompt inside the ceiling", () => {
    expect(preflight({ maxInputTokens: 4000 }, 3999)).toMatchObject({ ok: true });
  });

  it("passes a prompt exactly at the ceiling", () => {
    expect(preflight({ maxInputTokens: 4000 }, 4000)).toMatchObject({ ok: true });
  });

  it("denies a prompt over the ceiling rather than letting the provider trim it", () => {
    const outcome = preflight({ maxInputTokens: 4000 }, 4001);

    expect(outcome).toMatchObject({ ok: false, failure: "ceiling_denied" });
    if (outcome.ok) return;
    expect(outcome.detail).toContain("4001");
    expect(outcome.detail).toContain("4000");
  });
});

describe("per-turn aggregate budget", () => {
  it("admits everything when the turn fits", () => {
    const plan = planTurn(
      [call("conversation.turn", 1000), call("extraction.memory", 500)],
      5000,
    );

    expect(plan.dropped).toEqual([]);
    expect(plan.admitted).toHaveLength(2);
  });

  it("drops the optional calls first when the turn does not fit", () => {
    const plan = planTurn(
      [
        call("conversation.turn", 4000),
        call("evaluation.learner_message", 2000),
        call("extraction.memory", 1500),
        call("retrieval.query_rewrite", 500),
      ],
      6200,
    );

    expect(plan.dropped.map((c) => c.task)).toEqual([
      "extraction.memory",
      "retrieval.query_rewrite",
    ]);
    expect(plan.admitted.map((c) => c.task)).toEqual([
      "conversation.turn",
      "evaluation.learner_message",
    ]);
    expect(plan.overBudget).toEqual([]);
  });

  it("drops the most expensive optional call first", () => {
    const plan = planTurn(
      [
        call("conversation.turn", 4000),
        call("extraction.memory", 2000),
        call("retrieval.query_rewrite", 100),
      ],
      4200,
    );

    expect(plan.dropped.map((c) => c.task)).toEqual(["extraction.memory"]);
    expect(plan.admitted.map((c) => c.task)).toEqual([
      "conversation.turn",
      "retrieval.query_rewrite",
    ]);
  });

  it("never drops a required call silently", () => {
    const plan = planTurn(
      [call("conversation.turn", 4000), call("evaluation.learner_message", 3000)],
      5000,
    );

    // Both stay admitted, and the overrun is named rather than absorbed. A
    // required call that vanishes is a feature that stopped working with no
    // trace.
    expect(plan.dropped).toEqual([]);
    expect(plan.overBudget.map((c) => c.task)).toEqual([
      "conversation.turn",
      "evaluation.learner_message",
    ]);
  });

  it("keeps the conversation turn out of the optional set", () => {
    expect(OPTIONAL_TASKS.has("conversation.turn")).toBe(false);
    expect(OPTIONAL_TASKS.has("evaluation.learner_message")).toBe(false);
    expect(OPTIONAL_TASKS.has("extraction.memory")).toBe(true);
    expect(OPTIONAL_TASKS.has("recommendation.tiebreak")).toBe(true);
    expect(OPTIONAL_TASKS.has("retrieval.query_rewrite")).toBe(true);
  });

  it("preserves the caller's order among admitted calls", () => {
    const plan = planTurn(
      [call("extraction.errors", 100), call("conversation.turn", 100)],
      5000,
    );

    expect(plan.admitted.map((c) => c.task)).toEqual([
      "extraction.errors",
      "conversation.turn",
    ]);
  });
});

describe("per-request euro accumulator", () => {
  it("tracks what the turn has spent so far", () => {
    const budget = createTurnBudget(0.05);

    budget.record(0.01);
    budget.record(0.02);

    expect(budget.spentEur()).toBeCloseTo(0.03, 10);
    expect(budget.remainingEur()).toBeCloseTo(0.02, 10);
  });

  it("says when one more call would break the request ceiling", () => {
    const budget = createTurnBudget(0.05);
    budget.record(0.04);

    expect(budget.wouldExceed(0.005)).toBe(false);
    expect(budget.wouldExceed(0.02)).toBe(true);
  });

  it("never reports negative headroom", () => {
    const budget = createTurnBudget(0.01);
    budget.record(0.05);

    expect(budget.remainingEur()).toBe(0);
  });
});
