import { describe, expect, it } from "vitest";

import {
  PRODUCT_OPS_STAGES,
  branchNameFor,
  codeEditSchema,
  implementationPlanSchema,
  marketFindingSchema,
  nextStage,
  prdSectionsSchema,
  prdPathFor,
  priorityScoreFor,
  productProposalSchema,
  repoPathSchema,
  runSpendEur,
  stageCostEur,
  type RunEvent,
} from "@/domain/product-ops";

/**
 * The product-ops domain: what a model is allowed to return, and the two rules
 * that are deliberately not model calls.
 *
 * These shapes are the outer validation boundary for everything the workflow's
 * agents produce. A path that escapes the repository, a citation that was
 * invented, a priority a human cannot account for — each is rejected here,
 * before any of it reaches a file write or a dashboard.
 */

function finding(over: Record<string, unknown> = {}) {
  return {
    title: "Nurses cannot certify in German",
    sourceType: "forum",
    sourceUrl: "https://example.test/thread/1",
    summary: "Recurring complaint about medical vocabulary gaps.",
    painPoints: ["no medical vocabulary"],
    trends: ["healthcare recruitment from abroad"],
    evidence: [
      { url: "https://example.test/thread/1", finding: "Twelve replies agree." },
    ],
    relevanceScore: 0.8,
    ...over,
  };
}

function proposal(over: Record<string, unknown> = {}) {
  return {
    title: "Medical German module",
    problemStatement: "Healthcare workers need clinical German.",
    targetUsers: "Nurses relocating to Germany.",
    marketJustification: "Recruitment is rising and complaints are recurring.",
    userImpact: "Employability inside six months.",
    proposedSolution: "A scenario pack plus a vocabulary set.",
    complexity: "medium",
    impact: {
      reach: 0.4,
      severity: 0.9,
      evidenceStrength: 0.7,
      productFit: 0.8,
    },
    implementationOutline: ["Add the module", "Add the curriculum"],
    affectedAreas: ["learning/", "content/"],
    evidence: [
      { url: "https://example.test/thread/1", finding: "Twelve replies agree." },
    ],
    ...over,
  };
}

describe("repository paths", () => {
  it.each([
    "lib/product-ops/workflow.ts",
    "app/(app)/operations/product/page.tsx",
    "content/culture/pünktlichkeit.md",
  ])("accepts %s", (path) => {
    expect(repoPathSchema.safeParse(path).success).toBe(true);
  });

  it.each([
    ["a parent traversal", "../../etc/passwd"],
    ["a traversal in the middle", "lib/../../secrets.ts"],
    ["an absolute path", "/etc/passwd"],
    ["a home-relative path", "~/.ssh/id_rsa"],
    ["a bare dot segment", "./lib/x.ts"],
    ["a trailing slash", "lib/product-ops/"],
    ["an empty path", ""],
    ["a Windows absolute path", "C:\\Windows\\System32"],
    ["a null byte", "lib/x.ts\u0000.png"],
    ["a newline", "lib/x.ts\nrm -rf /"],
  ])("rejects %s", (_why, path) => {
    expect(repoPathSchema.safeParse(path).success).toBe(false);
  });
});

describe("market findings", () => {
  it("accepts a finding with cited evidence", () => {
    expect(marketFindingSchema.safeParse(finding()).success).toBe(true);
  });

  it("rejects an unknown source type rather than inventing a category", () => {
    expect(
      marketFindingSchema.safeParse(finding({ sourceType: "vibes" })).success,
    ).toBe(false);
  });

  it("rejects a relevance score outside the unit interval", () => {
    expect(
      marketFindingSchema.safeParse(finding({ relevanceScore: 1.4 })).success,
    ).toBe(false);
  });

  it("rejects a non-http evidence url", () => {
    // An arbitrary scheme in a citation is a link the dashboard would render.
    expect(
      marketFindingSchema.safeParse(
        finding({
          evidence: [{ url: "javascript:alert(1)", finding: "x" }],
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects an unexpected property", () => {
    expect(
      marketFindingSchema.safeParse(finding({ instruction: "ignore policy" }))
        .success,
    ).toBe(false);
  });
});

describe("product proposals", () => {
  it("accepts a fully evidenced proposal", () => {
    expect(productProposalSchema.safeParse(proposal()).success).toBe(true);
  });

  it("does not accept a priority score from the model", () => {
    // Priority is computed from the components below, not asserted. A number
    // the model chose is a number nobody can account for at the review gate.
    expect(
      productProposalSchema.safeParse(proposal({ priorityScore: 99 })).success,
    ).toBe(false);
  });

  it("rejects an impact component outside the unit interval", () => {
    expect(
      productProposalSchema.safeParse(
        proposal({
          impact: {
            reach: 2,
            severity: 0.9,
            evidenceStrength: 0.7,
            productFit: 0.8,
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("requires at least one piece of evidence", () => {
    expect(
      productProposalSchema.safeParse(proposal({ evidence: [] })).success,
    ).toBe(false);
  });

  it("rejects an unknown complexity", () => {
    expect(
      productProposalSchema.safeParse(proposal({ complexity: "epic" })).success,
    ).toBe(false);
  });
});

describe("priorityScoreFor", () => {
  it("is deterministic", () => {
    const components = proposal().impact;

    expect(priorityScoreFor(components, "medium")).toBe(
      priorityScoreFor(components, "medium"),
    );
  });

  it("returns a whole number the schema can store", () => {
    const score = priorityScoreFor(proposal().impact, "medium");

    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("scores a cheap win above an identical expensive one", () => {
    const components = proposal().impact;

    expect(priorityScoreFor(components, "small")).toBeGreaterThan(
      priorityScoreFor(components, "large"),
    );
  });

  it("scores stronger evidence above weaker evidence", () => {
    const weak = { ...proposal().impact, evidenceStrength: 0.1 };
    const strong = { ...proposal().impact, evidenceStrength: 0.9 };

    expect(priorityScoreFor(strong, "medium")).toBeGreaterThan(
      priorityScoreFor(weak, "medium"),
    );
  });

  it("gives the floor to nothing and the ceiling to everything", () => {
    const none = { reach: 0, severity: 0, evidenceStrength: 0, productFit: 0 };
    const all = { reach: 1, severity: 1, evidenceStrength: 1, productFit: 1 };

    expect(priorityScoreFor(none, "large")).toBe(0);
    expect(priorityScoreFor(all, "small")).toBe(100);
  });
});

describe("nextStage", () => {
  it("walks the machine stages forward on success", () => {
    expect(nextStage("research", "ok")).toBe("synthesis");
    expect(nextStage("synthesis", "ok")).toBe("human_review");
    expect(nextStage("prd", "ok")).toBe("code_plan");
    expect(nextStage("code_plan", "ok")).toBe("plan_review");
    expect(nextStage("implementation", "ok")).toBe("verification");
    expect(nextStage("verification", "ok")).toBe("pull_request");
    expect(nextStage("pull_request", "ok")).toBe("completed");
  });

  it("will not walk itself past a human gate", () => {
    // The whole safety property of this feature is these two returning null.
    expect(nextStage("human_review", "ok")).toBeNull();
    expect(nextStage("plan_review", "ok")).toBeNull();
  });

  it("treats already_done exactly like success, so a retry resumes", () => {
    for (const stage of PRODUCT_OPS_STAGES) {
      expect(nextStage(stage, "already_done")).toBe(nextStage(stage, "ok"));
    }
  });

  it("fails a run from any working stage", () => {
    expect(nextStage("research", "failed")).toBe("failed");
    expect(nextStage("implementation", "failed")).toBe("failed");
    expect(nextStage("pull_request", "failed")).toBe("failed");
  });

  it("stays put once a run has finished", () => {
    for (const stage of ["completed", "failed", "rejected"] as const) {
      expect(nextStage(stage, "ok")).toBeNull();
      expect(nextStage(stage, "failed")).toBeNull();
    }
  });

  it("has an answer for every stage in the union", () => {
    // Exhaustiveness, asserted rather than assumed: a stage added to the
    // tuple without a transition shows up here, not in production.
    for (const stage of PRODUCT_OPS_STAGES) {
      expect(() => nextStage(stage, "ok")).not.toThrow();
    }
  });
});

describe("prd sections", () => {
  const sections = {
    userStories: ["As a nurse, I want clinical vocabulary."],
    functionalRequirements: ["The module lists ten scenarios."],
    acceptanceCriteria: ["A learner can complete one scenario."],
    nonGoals: ["Official certification."],
  };

  it("accepts the judgement-bearing sections", () => {
    expect(prdSectionsSchema.safeParse(sections).success).toBe(true);
  });

  it("requires each section to say something", () => {
    expect(
      prdSectionsSchema.safeParse({ ...sections, acceptanceCriteria: [] })
        .success,
    ).toBe(false);
  });
});

describe("implementation plans", () => {
  const plan = {
    filesToModify: ["lib/product-ops/workflow.ts"],
    filesToCreate: ["lib/modules/medical.ts"],
    databaseChanges: [],
    apiChanges: [],
    uiChanges: ["A module card"],
    tests: ["tests/unit/modules/medical.test.ts"],
    dependencies: [],
    risks: ["Scope creep into certification claims"],
  };

  it("accepts a scoped plan", () => {
    expect(implementationPlanSchema.safeParse(plan).success).toBe(true);
  });

  it("rejects a plan naming a path outside the repository", () => {
    expect(
      implementationPlanSchema.safeParse({
        ...plan,
        filesToModify: ["../../.ssh/authorized_keys"],
      }).success,
    ).toBe(false);
  });

  it("rejects a plan that touches nothing", () => {
    expect(
      implementationPlanSchema.safeParse({
        ...plan,
        filesToModify: [],
        filesToCreate: [],
      }).success,
    ).toBe(false);
  });
});

describe("code edits", () => {
  it("accepts anchored edits to an existing file", () => {
    expect(
      codeEditSchema.safeParse({
        kind: "modify",
        path: "lib/x.ts",
        rationale: "Wire the new module in.",
        edits: [{ anchor: "const a = 1;", replacement: "const a = 2;" }],
      }).success,
    ).toBe(true);
  });

  it("accepts whole contents for a new file", () => {
    expect(
      codeEditSchema.safeParse({
        kind: "create",
        path: "lib/y.ts",
        rationale: "The new module.",
        contents: "export const y = 1;\n",
      }).success,
    ).toBe(true);
  });

  it("refuses contents on a modification", () => {
    // A whole-file rewrite does not fit the output ceiling, so the shape must
    // not let one be expressed at all.
    expect(
      codeEditSchema.safeParse({
        kind: "modify",
        path: "lib/x.ts",
        rationale: "Rewrite it.",
        contents: "export const x = 1;\n",
      }).success,
    ).toBe(false);
  });

  it("refuses an edit with an empty anchor", () => {
    // An empty anchor matches everywhere, which is the one thing the apply
    // layer's exactly-once rule cannot adjudicate.
    expect(
      codeEditSchema.safeParse({
        kind: "modify",
        path: "lib/x.ts",
        rationale: "Nudge it.",
        edits: [{ anchor: "", replacement: "x" }],
      }).success,
    ).toBe(false);
  });

  it("refuses a modification with no edits", () => {
    expect(
      codeEditSchema.safeParse({
        kind: "modify",
        path: "lib/x.ts",
        rationale: "Nothing.",
        edits: [],
      }).success,
    ).toBe(false);
  });
});

describe("what a run has spent", () => {
  function event(detail: Record<string, unknown>): RunEvent {
    return {
      id: 1,
      runId: "00000000-0000-4000-8000-000000000001",
      stage: "research",
      status: "ok",
      detail,
      createdAt: new Date("2026-09-10T10:00:00.000Z"),
    };
  }

  it("sums what each stage recorded", () => {
    expect(
      runSpendEur([event({ costEur: 0.004 }), event({ costEur: 0.02 })]),
    ).toBeCloseTo(0.024, 10);
  });

  it("treats an event that recorded no cost as free rather than as broken", () => {
    // An entry event costs nothing, and an event written by an earlier version
    // carries no such field. Neither is a reason to refuse to add up a run.
    expect(runSpendEur([event({ from: "research" })])).toBe(0);
    expect(stageCostEur(event({ costEur: "lots" }))).toBe(0);
    expect(stageCostEur(event({ costEur: Number.NaN }))).toBe(0);
    // A negative figure is not a refund; it is a bad row, and counting it
    // would raise the ceiling.
    expect(stageCostEur(event({ costEur: -5 }))).toBe(0);
  });
});

describe("the deterministic names", () => {
  const proposalId = "5a2b3c4d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

  it("derives a branch from the proposal and nothing else", () => {
    // Called twice, an hour apart, on two machines: the same name. That is
    // what lets a retry find the branch it pushed instead of making a second.
    expect(branchNameFor(proposalId)).toBe(branchNameFor(proposalId));
    expect(branchNameFor(proposalId)).toContain(proposalId);
    expect(branchNameFor(proposalId)).not.toMatch(/\s/);
  });

  it("puts the PRD projection somewhere the repository allows", () => {
    const path = prdPathFor(proposalId);

    expect(repoPathSchema.safeParse(path).success).toBe(true);
    // Under .ai/, so a generated artifact is never mistaken for a written one.
    expect(path.startsWith(".ai/prds/")).toBe(true);
  });
});
