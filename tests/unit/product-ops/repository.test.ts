import { describe, expect, it } from "vitest";

import { createProductOpsRepository } from "@/repositories/product-ops-repository";
import { createFakeSupabase } from "../../support/fake-supabase";

/**
 * The product-ops repository.
 *
 * What is asserted here is the shape of what reaches the database, because
 * that is where this layer's decisions live: which table, which filters, which
 * conflict target, and whether an absent row is an error or an answer. The
 * database's own behaviour is tested against a real engine in tests/db.
 */

const RUN_ID = "3f0f1d3a-0b1e-4c2a-8a1a-9a1b2c3d4e5f";
const PROPOSAL_ID = "5a2b3c4d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
const PLAN_ID = "7c8d9e0f-2a3b-4c5d-8e6f-1a2b3c4d5e6f";
const OPERATOR = "hash-operator";

function runRow(over: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    run_type: "manual_market_scan",
    status: "running",
    current_stage: "research",
    operator_id_hash: OPERATOR,
    request_id: null,
    error_code: null,
    metadata: {},
    started_at: "2026-09-10T10:00:00.000Z",
    completed_at: null,
    created_at: "2026-09-10T10:00:00.000Z",
    updated_at: "2026-09-10T10:00:00.000Z",
    ...over,
  };
}

function proposalRow(over: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL_ID,
    run_id: RUN_ID,
    title: "Medical German module",
    title_slug: "medical-german-module",
    problem_statement: "Healthcare workers need clinical German.",
    market_justification: "Recruitment is rising.",
    target_users: "Nurses relocating to Germany.",
    user_impact: "Employability inside six months.",
    proposed_solution: "A scenario pack.",
    complexity: "medium",
    priority_score: 78,
    implementation_outline: ["Add the module"],
    affected_areas: ["learning/"],
    supporting_research: [{ finding: "Twelve replies agree." }],
    internal_context: [],
    status: "pending_review",
    created_at: "2026-09-10T10:00:00.000Z",
    updated_at: "2026-09-10T10:00:00.000Z",
    ...over,
  };
}

const FINDING = {
  title: "Nurses cannot certify in German",
  sourceType: "forum" as const,
  sourceUrl: "https://example.test/thread/1",
  summary: "Recurring complaint about medical vocabulary gaps.",
  painPoints: ["no medical vocabulary"],
  trends: ["healthcare recruitment"],
  evidence: [
    { url: "https://example.test/thread/1", finding: "Twelve replies agree." },
  ],
  relevanceScore: 0.8,
};

describe("starting a run", () => {
  it("records the operator who started it and the stage it begins at", async () => {
    const fake = createFakeSupabase({ ai_runs: { data: runRow() } });

    const result = await createProductOpsRepository(fake.client).startRun({
      runType: "manual_market_scan",
      operatorIdHash: OPERATOR,
      requestId: null,
      brief: "healthcare German",
    });

    expect(result.ok).toBe(true);
    const [[values]] = fake.methodArgs("ai_runs", "insert");
    expect(values).toMatchObject({
      run_type: "manual_market_scan",
      operator_id_hash: OPERATOR,
      current_stage: "research",
    });
  });

  it("refuses a run type outside the known set before querying", async () => {
    const fake = createFakeSupabase({});

    const result = await createProductOpsRepository(fake.client).startRun({
      runType: "take_over_the_world" as never,
      operatorIdHash: OPERATOR,
      requestId: null,
      brief: "healthcare German",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_input");
    expect(fake.calls).toEqual([]);
  });

  it("refuses a run with no operator recorded", async () => {
    // An unattributed privileged action is the one thing the audit trail
    // cannot afford.
    const fake = createFakeSupabase({});

    const result = await createProductOpsRepository(fake.client).startRun({
      runType: "manual_market_scan",
      operatorIdHash: "",
      requestId: null,
      brief: null,
    });

    expect(result.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});

describe("advancing a stage", () => {
  it("goes through the compare-and-set function, never a bare update", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: { advanced: true, stage: "synthesis" } });

    const result = await createProductOpsRepository(fake.client).advanceStage({
      runId: RUN_ID,
      from: "research",
      to: "synthesis",
      event: { status: "ok" },
    });

    expect(result).toMatchObject({ ok: true, data: { advanced: true } });
    expect(fake.rpcCalls).toEqual([
      {
        fn: "advance_product_ops_run",
        args: {
          p_run_id: RUN_ID,
          p_from: "research",
          p_to: "synthesis",
          p_event: { status: "ok" },
        },
      },
    ]);
    expect(fake.calls).toEqual([]);
  });

  it("reports a refused transition as data, not as an error", async () => {
    // Losing a race is an ordinary outcome for a worker. The caller decides
    // what to do about it, so it must not arrive as a failure.
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: { advanced: false, stage: "synthesis" } });

    const result = await createProductOpsRepository(fake.client).advanceStage({
      runId: RUN_ID,
      from: "research",
      to: "human_review",
      event: { status: "ok" },
    });

    expect(result).toMatchObject({
      ok: true,
      data: { advanced: false, stage: "synthesis" },
    });
  });
});

describe("recording findings", () => {
  it("upserts on the finding hash so a re-run adds nothing", async () => {
    const fake = createFakeSupabase({ market_research: { data: [] } });

    await createProductOpsRepository(fake.client).recordFindings(RUN_ID, [
      FINDING,
    ]);

    const [[values, options]] = fake.methodArgs("market_research", "upsert");
    expect(Array.isArray(values)).toBe(true);
    expect((values as Record<string, unknown>[])[0]).toMatchObject({
      run_id: RUN_ID,
      source_type: "forum",
    });
    expect(options).toMatchObject({
      onConflict: "run_id,finding_hash",
      ignoreDuplicates: true,
    });
  });

  it("derives a stable hash from the finding's content", async () => {
    const fake = createFakeSupabase({ market_research: { data: [] } });
    const repository = createProductOpsRepository(fake.client);

    await repository.recordFindings(RUN_ID, [FINDING]);
    await repository.recordFindings(RUN_ID, [FINDING]);

    const [first, second] = fake.calls
      .filter((call) => call.table === "market_research")
      .map(
        (call) =>
          (
            call.chain.find((step) => step.method === "upsert")
              ?.args[0] as Record<string, unknown>[]
          )[0].finding_hash,
      );

    expect(first).toBe(second);
  });

  it("gives two different findings two different hashes", async () => {
    const fake = createFakeSupabase({ market_research: { data: [] } });

    await createProductOpsRepository(fake.client).recordFindings(RUN_ID, [
      FINDING,
      { ...FINDING, title: "Something else entirely" },
    ]);

    const [[values]] = fake.methodArgs("market_research", "upsert");
    const hashes = (values as Record<string, unknown>[]).map(
      (row) => row.finding_hash,
    );

    expect(new Set(hashes).size).toBe(2);
  });

  it("rejects a finding the domain schema will not accept", async () => {
    const fake = createFakeSupabase({});

    const result = await createProductOpsRepository(
      fake.client,
    ).recordFindings(RUN_ID, [
      { ...FINDING, evidence: [{ url: "javascript:alert(1)", finding: "x" }] },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_input");
    expect(fake.calls).toEqual([]);
  });

  it("writes nothing when there is nothing to write", async () => {
    const fake = createFakeSupabase({});

    const result = await createProductOpsRepository(
      fake.client,
    ).recordFindings(RUN_ID, []);

    expect(result).toMatchObject({ ok: true });
    expect(fake.calls).toEqual([]);
  });
});

describe("proposals", () => {
  it("computes the priority rather than storing one it was handed", async () => {
    const fake = createFakeSupabase({ product_proposals: { data: proposalRow() } });

    await createProductOpsRepository(fake.client).saveProposal(RUN_ID, {
      title: "Medical German module",
      problemStatement: "Healthcare workers need clinical German.",
      targetUsers: "Nurses relocating to Germany.",
      marketJustification: "Recruitment is rising.",
      userImpact: "Employability inside six months.",
      proposedSolution: "A scenario pack.",
      complexity: "medium",
      impact: {
        reach: 0.4,
        severity: 0.9,
        evidenceStrength: 0.7,
        productFit: 0.8,
      },
      implementationOutline: ["Add the module"],
      affectedAreas: ["learning/"],
      evidence: [{ finding: "Twelve replies agree." }],
    });

    const [[values]] = fake.methodArgs("product_proposals", "insert");
    // 0.9*0.3 + 0.4*0.25 + 0.7*0.25 + 0.8*0.2 = 0.705, times 0.85 for medium.
    expect(values).toMatchObject({ priority_score: 60 });
  });

  it("slugs the title so a re-run collides instead of duplicating", async () => {
    const fake = createFakeSupabase({ product_proposals: { data: proposalRow() } });

    await createProductOpsRepository(fake.client).saveProposal(RUN_ID, {
      title: "Medical German: Module (v2)!",
      problemStatement: "x",
      targetUsers: "x",
      marketJustification: "x",
      userImpact: "x",
      proposedSolution: "x",
      complexity: "small",
      impact: { reach: 1, severity: 1, evidenceStrength: 1, productFit: 1 },
      implementationOutline: ["x"],
      affectedAreas: ["x"],
      evidence: [{ finding: "x" }],
    });

    const [[values]] = fake.methodArgs("product_proposals", "insert");
    expect(values).toMatchObject({ title_slug: "medical-german-module-v2" });
  });

  it("treats a unique violation as a conflict, which a retry can read", async () => {
    const fake = createFakeSupabase({
      product_proposals: {
        error: { code: "23505", message: "duplicate key value" },
      },
    });

    const result = await createProductOpsRepository(fake.client).saveProposal(
      RUN_ID,
      {
        title: "Medical German module",
        problemStatement: "x",
        targetUsers: "x",
        marketJustification: "x",
        userImpact: "x",
        proposedSolution: "x",
        complexity: "small",
        impact: { reach: 1, severity: 1, evidenceStrength: 1, productFit: 1 },
        implementationOutline: ["x"],
        affectedAreas: ["x"],
        evidence: [{ finding: "x" }],
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("conflict");
  });

  it("reports no proposal for a run as null, not as an error", async () => {
    const fake = createFakeSupabase({ product_proposals: { data: [] } });

    const result = await createProductOpsRepository(
      fake.client,
    ).findProposalForRun(RUN_ID);

    expect(result).toMatchObject({ ok: true, data: null });
  });

  it("filters a run's proposal by that run", async () => {
    const fake = createFakeSupabase({ product_proposals: { data: [proposalRow()] } });

    await createProductOpsRepository(fake.client).findProposalForRun(RUN_ID);

    expect(fake.methodArgs("product_proposals", "eq")).toEqual([
      ["run_id", RUN_ID],
    ]);
  });

  it("turns a row it cannot decode into invalid_data", async () => {
    const fake = createFakeSupabase({
      product_proposals: { data: [proposalRow({ complexity: "epic" })] },
    });

    const result = await createProductOpsRepository(
      fake.client,
    ).findProposalForRun(RUN_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_data");
  });
});

describe("reviews", () => {
  it("goes through the atomic function with the operator attached", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: { status: "approved", priorityScore: 78 } });

    await createProductOpsRepository(fake.client).review({
      proposalId: PROPOSAL_ID,
      action: "approve",
      newPriority: null,
      comment: "Ship it",
      operatorIdHash: OPERATOR,
    });

    expect(fake.rpcCalls).toEqual([
      {
        fn: "record_proposal_review",
        args: {
          p_proposal_id: PROPOSAL_ID,
          p_action: "approve",
          p_new_priority: null,
          p_comment: "Ship it",
          p_operator_id_hash: OPERATOR,
        },
      },
    ]);
  });

  it("refuses an action outside the known set before querying", async () => {
    const fake = createFakeSupabase({});

    const result = await createProductOpsRepository(fake.client).review({
      proposalId: PROPOSAL_ID,
      action: "merge_it" as never,
      newPriority: null,
      comment: null,
      operatorIdHash: OPERATOR,
    });

    expect(result.ok).toBe(false);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("refuses an unattributed review before querying", async () => {
    const fake = createFakeSupabase({});

    const result = await createProductOpsRepository(fake.client).review({
      proposalId: PROPOSAL_ID,
      action: "approve",
      newPriority: null,
      comment: null,
      operatorIdHash: "",
    });

    expect(result.ok).toBe(false);
    expect(fake.rpcCalls).toEqual([]);
  });
});

describe("pull requests", () => {
  it("looks one up by repository and branch, which is its identity", async () => {
    const fake = createFakeSupabase({ pull_requests: { data: [] } });

    const result = await createProductOpsRepository(
      fake.client,
    ).findPullRequestForBranch("owner/repo", "product-ops/abc");

    expect(result).toMatchObject({ ok: true, data: null });
    expect(fake.methodArgs("pull_requests", "eq")).toEqual([
      ["repository", "owner/repo"],
      ["branch", "product-ops/abc"],
    ]);
  });

  it("upserts on the branch so a retry adopts the existing row", async () => {
    const fake = createFakeSupabase({
      pull_requests: {
        data: {
          id: "9f8e7d6c-5b4a-4938-8271-6a5b4c3d2e1f",
          proposal_id: PROPOSAL_ID,
          provider: "github",
          repository: "owner/repo",
          branch: "product-ops/abc",
          pr_number: 42,
          url: "https://github.test/owner/repo/pull/42",
          status: "open",
          created_at: "2026-09-10T10:00:00.000Z",
          updated_at: "2026-09-10T10:00:00.000Z",
        },
      },
    });

    await createProductOpsRepository(fake.client).savePullRequest({
      proposalId: PROPOSAL_ID,
      repository: "owner/repo",
      branch: "product-ops/abc",
      prNumber: 42,
      url: "https://github.test/owner/repo/pull/42",
    });

    const [[, options]] = fake.methodArgs("pull_requests", "upsert");
    expect(options).toMatchObject({ onConflict: "repository,branch" });
  });
});

describe("code changes", () => {
  it("records a refusal with the reason it was refused", async () => {
    const fake = createFakeSupabase({ code_changes: { data: [] } });

    await createProductOpsRepository(fake.client).recordCodeChange({
      planId: PLAN_ID,
      path: ".env.local",
      editCount: 0,
      bytesBefore: null,
      bytesAfter: null,
      applied: false,
      rejectedReason: "deny_listed",
    });

    const [[values]] = fake.methodArgs("code_changes", "insert");
    expect(values).toMatchObject({
      path: ".env.local",
      applied: false,
      rejected_reason: "deny_listed",
    });
  });

  it("will not record an unexplained refusal", async () => {
    // The database has the same constraint. Catching it here means the caller
    // gets a typed error rather than a check violation.
    const fake = createFakeSupabase({});

    const result = await createProductOpsRepository(
      fake.client,
    ).recordCodeChange({
      planId: PLAN_ID,
      path: "lib/x.ts",
      editCount: 0,
      bytesBefore: null,
      bytesAfter: null,
      applied: false,
      rejectedReason: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_input");
    expect(fake.calls).toEqual([]);
  });
});

describe("removing a run", () => {
  it("deletes only a run that has already stopped, by filter in the query", async () => {
    const fake = createFakeSupabase({ ai_runs: { data: null, error: null } });
    const repository = createProductOpsRepository(fake.client);

    const outcome = await repository.deleteRun("3f0f1d3a-0b1e-4c2a-8a1a-9a1b2c3d4e5f");

    expect(outcome.ok).toBe(true);
    const [call] = fake.calls;
    expect(call.table).toBe("ai_runs");
    expect(call.chain.map((step) => step.method)).toEqual(["delete", "eq", "in"]);
    expect(call.chain[2].args).toEqual(["status", ["failed", "rejected"]]);
  });

  it("refuses an id that is not an id before querying", async () => {
    const fake = createFakeSupabase({});
    const repository = createProductOpsRepository(fake.client);

    const outcome = await repository.deleteRun("nope");

    expect(outcome.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("the board", () => {
  it("reads one aggregate rather than assembling it here", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({
      data: { generatedAt: "2026-09-10T10:00:00.000Z", proposals: [], runs: [] },
    });

    const result = await createProductOpsRepository(fake.client).board(20);

    expect(result).toMatchObject({ ok: true });
    expect(fake.rpcCalls).toEqual([
      { fn: "product_ops_dashboard", args: { p_limit: 20 } },
    ]);
    expect(fake.calls).toEqual([]);
  });

  it("surfaces a privilege denial as forbidden", async () => {
    // What a non-operator reaching the secret-key path would actually get.
    const fake = createFakeSupabase({});
    fake.setRpcResult({
      error: { code: "42501", message: "permission denied" },
    });

    const result = await createProductOpsRepository(fake.client).board(20);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("forbidden");
  });
});

describe("the run's brief", () => {
  it("is stored as metadata rather than as a column", async () => {
    // The brief is the run's input, not part of its state: nothing queries it
    // and nothing constrains it, so it belongs in the jsonb.
    const fake = createFakeSupabase({ ai_runs: { data: runRow() } });

    await createProductOpsRepository(fake.client).startRun({
      runType: "manual_market_scan",
      operatorIdHash: OPERATOR,
      requestId: null,
      brief: "healthcare German",
    });

    const [[values]] = fake.methodArgs("ai_runs", "insert");
    expect(values).toMatchObject({ metadata: { brief: "healthcare German" } });
  });

  it("reads back off the run it was stored on", async () => {
    const fake = createFakeSupabase({
      ai_runs: { data: runRow({ metadata: { brief: "spoken fluency" } }) },
    });

    const result = await createProductOpsRepository(fake.client).getRun(RUN_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.brief).toBe("spoken fluency");
  });

  it("survives metadata that carries something else entirely", async () => {
    // jsonb has no constraint, so a run whose metadata grew a field must still
    // be readable. A missing brief is null, not a decode failure.
    const fake = createFakeSupabase({
      ai_runs: { data: runRow({ metadata: { note: "written by hand" } }) },
    });

    const result = await createProductOpsRepository(fake.client).getRun(RUN_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.brief).toBeNull();
  });
});

describe("the timeline", () => {
  it("appends an event without touching the run", async () => {
    const fake = createFakeSupabase({});

    const result = await createProductOpsRepository(fake.client).recordEvent({
      runId: RUN_ID,
      stage: "research",
      status: "ok",
      detail: { costEur: 0.004 },
    });

    expect(result.ok).toBe(true);
    const [[values]] = fake.methodArgs("ai_run_events", "insert");
    expect(values).toMatchObject({
      run_id: RUN_ID,
      stage: "research",
      status: "ok",
      detail: { costEur: 0.004 },
    });
    // Nothing else: an event is a record, not a transition.
    expect(fake.calls.map((call) => call.table)).toEqual(["ai_run_events"]);
  });

  it("refuses a status outside the closed set before querying", async () => {
    const fake = createFakeSupabase({});

    const result = await createProductOpsRepository(fake.client).recordEvent({
      runId: RUN_ID,
      stage: "research",
      status: "probably_fine" as never,
      detail: {},
    });

    expect(result.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it("reads the timeline in the order it was written", async () => {
    // By id rather than by timestamp: two events written inside one
    // transaction share a clock reading, and the order they happened in is the
    // order they were inserted in.
    const fake = createFakeSupabase({ ai_run_events: { data: [] } });

    await createProductOpsRepository(fake.client).listEvents(RUN_ID);

    const [[column, options]] = fake.methodArgs("ai_run_events", "order");
    expect(column).toBe("id");
    expect(options).toMatchObject({ ascending: true });
  });

  it("reads the timeline after a row by a range on the id, for the live feed", async () => {
    // The feed asks on every tick, so each ask is an indexed range and not
    // the whole timeline again. Same order as the full read, for the same
    // reason.
    const fake = createFakeSupabase({ ai_run_events: { data: [] } });

    await createProductOpsRepository(fake.client).listEventsAfter(RUN_ID, 41);

    expect(fake.methodArgs("ai_run_events", "gt")).toEqual([["id", 41]]);
    expect(fake.methodArgs("ai_run_events", "eq")).toEqual([["run_id", RUN_ID]]);
    const [[column, options]] = fake.methodArgs("ai_run_events", "order");
    expect(column).toBe("id");
    expect(options).toMatchObject({ ascending: true });
  });

  it("refuses a negative or fractional cursor before querying", async () => {
    const fake = createFakeSupabase({ ai_run_events: { data: [] } });

    const outcome = await createProductOpsRepository(fake.client).listEventsAfter(RUN_ID, -1);

    expect(outcome.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("the artifacts", () => {
  const SECTIONS = {
    userStories: ["As a nurse, I want vocabulary, so that I can work."],
    functionalRequirements: ["Teach twenty terms."],
    acceptanceCriteria: ["A learner finishes the module."],
    nonGoals: ["No examination."],
  };

  function prdRow(over: Record<string, unknown> = {}) {
    return {
      id: PLAN_ID,
      proposal_id: PROPOSAL_ID,
      document: "# Medical German",
      document_hash: "a".repeat(64),
      sections: SECTIONS,
      file_path: `.ai/prds/${PROPOSAL_ID}.md`,
      created_at: "2026-09-10T10:00:00.000Z",
      updated_at: "2026-09-10T10:00:00.000Z",
      ...over,
    };
  }

  it("upserts a PRD on the proposal, which is its idempotency key", async () => {
    const fake = createFakeSupabase({ product_prds: { data: prdRow() } });

    const result = await createProductOpsRepository(fake.client).savePrd({
      proposalId: PROPOSAL_ID,
      document: "# Medical German",
      sections: SECTIONS,
      filePath: `.ai/prds/${PROPOSAL_ID}.md`,
    });

    expect(result.ok).toBe(true);
    const [[values, options]] = fake.methodArgs("product_prds", "upsert");
    expect(options).toMatchObject({ onConflict: "proposal_id" });
    // Hashed here rather than accepted from a caller: two callers hashing the
    // same document differently is a check that proves nothing.
    expect(values).toMatchObject({ document_hash: expect.any(String) });
  });

  it("refuses a PRD whose file path is not inside the repository", async () => {
    const fake = createFakeSupabase({});

    const result = await createProductOpsRepository(fake.client).savePrd({
      proposalId: PROPOSAL_ID,
      document: "# Medical German",
      sections: SECTIONS,
      filePath: "../../etc/passwd",
    });

    expect(result.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it("answers null for a proposal with no PRD yet", async () => {
    const fake = createFakeSupabase({ product_prds: { data: [] } });

    const result = await createProductOpsRepository(
      fake.client,
    ).findPrdForProposal(PROPOSAL_ID);

    expect(result).toEqual({ ok: true, data: null });
  });

  it("spreads a plan across the columns the file lists are queried from", async () => {
    const fake = createFakeSupabase({
      implementation_plans: {
        data: {
          id: PLAN_ID,
          proposal_id: PROPOSAL_ID,
          files_to_modify: ["learning/curriculum.ts"],
          files_to_create: [],
          database_changes: [],
          api_changes: [],
          ui_changes: [],
          tests: [],
          dependencies: [],
          risks: [],
          status: "pending_review",
          created_at: "2026-09-10T10:00:00.000Z",
          updated_at: "2026-09-10T10:00:00.000Z",
        },
      },
    });

    const result = await createProductOpsRepository(fake.client).savePlan(
      PROPOSAL_ID,
      {
        filesToModify: ["learning/curriculum.ts"],
        filesToCreate: [],
        databaseChanges: [],
        apiChanges: [],
        uiChanges: [],
        tests: [],
        dependencies: [],
        risks: [],
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("pending_review");
    const [[values, options]] = fake.methodArgs("implementation_plans", "upsert");
    expect(options).toMatchObject({ onConflict: "proposal_id" });
    expect(values).toMatchObject({ files_to_modify: ["learning/curriculum.ts"] });
  });

  it("writes the breakdown onto the plan it belongs to, by id", async () => {
    const fake = createFakeSupabase({
      implementation_plans: {
        data: {
          id: PLAN_ID,
          proposal_id: PROPOSAL_ID,
          files_to_modify: ["learning/curriculum.ts"],
          files_to_create: [],
          database_changes: [],
          api_changes: [],
          ui_changes: [],
          tests: [],
          dependencies: [],
          risks: [],
          breakdown: {
  summary: "Ship the vocabulary set first, then the scenario pack on top of it.",
  overallSize: "l",
  phases: [
    {
      name: "Vocabulary",
      goal: "A learner can drill the clinical terms.",
      requirements: [
        { id: "R1", title: "Clinical vocabulary set", description: "Twenty terms with articles and plurals in the vocabulary table.", size: "s", dependsOn: [] },
        { id: "R2", title: "Module card", description: "The module appears on the curriculum page.", size: "xs", dependsOn: ["R1"] },
      ],
    },
    {
      name: "Scenarios",
      goal: "A learner can rehearse a handover.",
      requirements: [
        { id: "R3", title: "Handover scenario", description: "One scenario using the set.", size: "m", dependsOn: ["R1"] },
      ],
    },
  ],
  technicalGuidance: [
    {
      topic: "Scenario storage",
      current: "Scenarios live in Postgres with pgvector embeddings, ingested offline.",
      recommendation: "Keep it; one more scenario is one more row.",
      pros: ["No new moving part"],
      cons: ["Offline ingestion is a manual step"],
    },
  ],
},
          status: "pending_review",
          created_at: "2026-09-10T10:00:00.000Z",
          updated_at: "2026-09-10T10:00:00.000Z",
        },
      },
    });

    const result = await createProductOpsRepository(fake.client).saveBreakdown(
      PLAN_ID,
      {
  summary: "Ship the vocabulary set first, then the scenario pack on top of it.",
  overallSize: "l",
  phases: [
    {
      name: "Vocabulary",
      goal: "A learner can drill the clinical terms.",
      requirements: [
        { id: "R1", title: "Clinical vocabulary set", description: "Twenty terms with articles and plurals in the vocabulary table.", size: "s", dependsOn: [] },
        { id: "R2", title: "Module card", description: "The module appears on the curriculum page.", size: "xs", dependsOn: ["R1"] },
      ],
    },
    {
      name: "Scenarios",
      goal: "A learner can rehearse a handover.",
      requirements: [
        { id: "R3", title: "Handover scenario", description: "One scenario using the set.", size: "m", dependsOn: ["R1"] },
      ],
    },
  ],
  technicalGuidance: [
    {
      topic: "Scenario storage",
      current: "Scenarios live in Postgres with pgvector embeddings, ingested offline.",
      recommendation: "Keep it; one more scenario is one more row.",
      pros: ["No new moving part"],
      cons: ["Offline ingestion is a manual step"],
    },
  ],
} as never,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.breakdown?.overallSize).toBe("l");
    expect(fake.methodArgs("implementation_plans", "eq")).toEqual([["id", PLAN_ID]]);
    const [[values]] = fake.methodArgs("implementation_plans", "update");
    expect(values).toMatchObject({ breakdown: expect.objectContaining({ overallSize: "l" }) });
  });

  it("reads a plan written before the breakdown existed as one without a breakdown", async () => {
    const fake = createFakeSupabase({
      implementation_plans: {
        data: [
          {
            id: PLAN_ID,
            proposal_id: PROPOSAL_ID,
            files_to_modify: ["learning/curriculum.ts"],
            files_to_create: [],
            database_changes: [],
            api_changes: [],
            ui_changes: [],
            tests: [],
            dependencies: [],
            risks: [],
            status: "pending_review",
            created_at: "2026-09-10T10:00:00.000Z",
            updated_at: "2026-09-10T10:00:00.000Z",
          },
        ],
      },
    });

    const result = await createProductOpsRepository(fake.client).findPlanForProposal(PROPOSAL_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.breakdown).toBeNull();
  });

  it("refuses a plan that touches no file at all", async () => {
    const fake = createFakeSupabase({});

    const result = await createProductOpsRepository(fake.client).savePlan(
      PROPOSAL_ID,
      {
        filesToModify: [],
        filesToCreate: [],
        databaseChanges: ["add a table"],
        apiChanges: [],
        uiChanges: [],
        tests: [],
        dependencies: [],
        risks: [],
      },
    );

    expect(result.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it("reads a plan's recorded changes in the order they were written", async () => {
    const fake = createFakeSupabase({ code_changes: { data: [] } });

    await createProductOpsRepository(fake.client).listCodeChanges(PLAN_ID);

    const [[column]] = fake.methodArgs("code_changes", "order");
    expect(column).toBe("id");
    expect(fake.methodArgs("code_changes", "eq")).toEqual([["plan_id", PLAN_ID]]);
  });
});

describe("moving a proposal's status", () => {
  it("updates only the row it names", async () => {
    const fake = createFakeSupabase({});

    const result = await createProductOpsRepository(
      fake.client,
    ).setProposalStatus(PROPOSAL_ID, "prd_ready");

    expect(result.ok).toBe(true);
    expect(fake.methodArgs("product_proposals", "update")).toEqual([
      [{ status: "prd_ready" }],
    ]);
    expect(fake.methodArgs("product_proposals", "eq")).toEqual([
      ["id", PROPOSAL_ID],
    ]);
  });

  it("refuses a status outside the closed set", async () => {
    const fake = createFakeSupabase({});

    const result = await createProductOpsRepository(
      fake.client,
    ).setProposalStatus(PROPOSAL_ID, "shipped" as never);

    expect(result.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});

describe("recent proposals", () => {
  it("reads the newest first, bounded", async () => {
    const fake = createFakeSupabase({ product_proposals: { data: [] } });

    await createProductOpsRepository(fake.client).listProposals(10);

    const [[column, options]] = fake.methodArgs("product_proposals", "order");
    expect(column).toBe("created_at");
    expect(options).toMatchObject({ ascending: false });
    expect(fake.methodArgs("product_proposals", "limit")).toEqual([[10]]);
  });

  it("refuses an unbounded read", async () => {
    const fake = createFakeSupabase({});

    const result = await createProductOpsRepository(fake.client).listProposals(
      5000,
    );

    expect(result.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});
