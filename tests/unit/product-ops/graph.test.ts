import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";

import { PRODUCT_OPS_STAGES, prdPathFor, stageOwner } from "@/domain/product-ops";
import { gatewayOk } from "@/lib/ai/gateway/errors";
import type { ModelCallSpec } from "@/lib/ai/gateway/call-spec";
import type { CompletionOutcome, ModelGateway } from "@/lib/ai/gateway/gateway";
import type { TaskId } from "@/lib/ai/tasks";
import {
  MAX_GRAPH_STEPS,
  compileProductOpsGraph,
  driveRunGraph,
} from "@/lib/product-ops/graph/graph";
import { ProductOpsCheckpointSaver } from "@/lib/product-ops/graph/checkpointer";
import { retryRun } from "@/lib/product-ops/workflow";
import {
  createProductOpsStore,
  seedRunAt,
  type ProductOpsStore,
} from "../../support/product-ops-store";

/**
 * The graph.
 *
 * What is asserted is the shape the spec asks for and the loop it replaces
 * had: one recorded stage per node, the two gates as places the graph parks
 * and a decision resumes, worker stages deferred on a process without a
 * working tree, and a checkpoint that survives between invocations so that a
 * resume is a resume and not a restart. The stages themselves are the
 * orchestrator's and are tested in workflow.test.ts; here the gateway answers
 * every task with a valid reply and the interesting behaviour is routing.
 */

const FINDING = {
  title: "Nurses cannot certify in German",
  sourceType: "forum",
  sourceUrl: "https://example.test/thread/1",
  summary: "Recurring complaint about medical vocabulary gaps.",
  painPoints: ["no medical vocabulary"],
  trends: ["healthcare recruitment"],
  evidence: [{ url: "https://example.test/thread/1", finding: "Twelve replies agree." }],
  relevanceScore: 0.8,
};

const PROPOSAL = {
  title: "Medical German module",
  problemStatement: "Healthcare workers need clinical German.",
  targetUsers: "Nurses relocating to Germany.",
  marketJustification: "Recruitment is rising and complaints recur.",
  userImpact: "Employability inside six months.",
  proposedSolution: "A scenario pack plus a vocabulary set.",
  complexity: "medium",
  impact: { reach: 0.4, severity: 0.9, evidenceStrength: 0.7, productFit: 0.8 },
  implementationOutline: ["Add the module"],
  affectedAreas: ["learning/"],
  evidence: [{ url: "https://example.test/thread/1", finding: "Twelve replies agree." }],
};

const SECTIONS = {
  userStories: ["As a nurse, I want clinical vocabulary, so that I can work."],
  functionalRequirements: ["The module teaches twenty clinical terms."],
  acceptanceCriteria: ["A learner can complete the module."],
  nonGoals: ["No spoken examination."],
};

const PLAN = {
  filesToModify: ["learning/curriculum.ts"],
  filesToCreate: [],
  databaseChanges: [],
  apiChanges: [],
  uiChanges: [],
  tests: ["tests/unit/learning/medical.test.ts"],
  dependencies: [],
  risks: ["The vocabulary may be too specialised."],
};

const BREAKDOWN = {
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
};

const REPLIES: Readonly<Record<string, unknown>> = {
  "productops.market_research": { findings: [FINDING] },
  "productops.proposal_synthesis": PROPOSAL,
  "productops.prd_sections": SECTIONS,
  "productops.code_plan": PLAN,
  "productops.plan_breakdown": BREAKDOWN,
};

/** The checkout the server runs beside, as the planner reads it. */
const BROWSER = {
  async list() {
    return ["AGENTS.md", "learning/curriculum.ts"];
  },
  async read(path: string) {
    return path === "AGENTS.md" ? "# Rules" : "export const x = 1;";
  },
  async search() {
    return [];
  },
};

function fakeGateway() {
  const tasks: TaskId[] = [];

  const gateway: ModelGateway = {
    async complete(spec: ModelCallSpec) {
      tasks.push(spec.task);
      return gatewayOk<CompletionOutcome>({
        text: JSON.stringify(REPLIES[spec.task] ?? {}),
        truncated: false,
        degraded: false,
        tier: "cheap",
        modelIdResolved: "vendor/model",
        inputTokens: 400,
        outputTokens: 200,
        costUsd: 0.001,
        costEur: 0.001,
        attempts: 1,
        ledgerId: 1,
        citations: [{ url: "https://example.test/thread/1", title: null }],
      });
    },
    async stream() {
      throw new Error("product ops does not stream");
    },
  };

  return { gateway, tasks };
}

function depsFor(
  store: ProductOpsStore,
  checkpointer = new MemorySaver(),
  over: { readonly browser?: typeof BROWSER } = { browser: BROWSER },
) {
  const { gateway, tasks } = fakeGateway();
  return {
    deps: { runs: store.repository, gateway, checkpointer, browser: over.browser },
    tasks,
  };
}

async function approve(store: ProductOpsStore, runId: string) {
  const proposal = await store.repository.findProposalForRun(runId);
  if (!proposal.ok || proposal.data === null) throw new Error("no proposal");
  const reviewed = await store.repository.review({
    proposalId: proposal.data.id,
    action: "approve",
    newPriority: null,
    comment: null,
    operatorIdHash: "hash-operator",
  });
  if (!reviewed.ok) throw new Error("review refused");
  return proposal.data;
}

describe("the graph's nodes", () => {
  it("has one node per stage something runs or decides, and nothing else", () => {
    const store = createProductOpsStore();
    const { deps } = depsFor(store);
    const graph = compileProductOpsGraph(deps);

    const nodes = Object.keys(graph.nodes).filter(
      (node) => node !== "__start__" && node !== "__end__",
    );
    const expected = PRODUCT_OPS_STAGES.filter((stage) => stageOwner(stage) !== "nobody");

    expect(nodes.sort()).toEqual(["load", ...expected].sort());
  });
});

describe("driving a scan on the server", () => {
  it("runs research and synthesis, then parks at the proposal gate", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const { deps, tasks } = depsFor(store);

    const result = await driveRunGraph(deps, runId);

    expect(result.status).toBe("waiting");
    expect(result.stage).toBe("human_review");
    expect(store.runs.get(runId)?.currentStage).toBe("human_review");
    expect(tasks).toContain("productops.market_research");
    expect(tasks).toContain("productops.proposal_synthesis");
    // Two stages ran, two work events and two entry events were written.
    expect(store.events.filter((event) => event.runId === runId)).toHaveLength(4);
  });

  it("is parked at the gate: driving again runs nothing and stays there", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const { deps, tasks } = depsFor(store);

    await driveRunGraph(deps, runId);
    const before = tasks.length;
    const again = await driveRunGraph(deps, runId);

    expect(again.status).toBe("waiting");
    expect(again.stage).toBe("human_review");
    expect(tasks).toHaveLength(before);
  });

  it("resumes on an approval, writes the PRD and the plan, and parks at the plan gate", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const { deps, tasks } = depsFor(store);

    await driveRunGraph(deps, runId);
    const proposal = await approve(store, runId);

    // The action records the review; the graph applies the decision and
    // continues through the PRD and the plan — planning only reads, and the
    // server reads the checkout it runs beside — to the second gate.
    const result = await driveRunGraph(deps, runId, "approve");

    expect(result.status).toBe("waiting");
    expect(store.runs.get(runId)?.currentStage).toBe("plan_review");
    expect(tasks).toContain("productops.prd_sections");
    expect(tasks).toContain("productops.code_plan");
    expect(store.prds.map((prd) => prd.proposalId)).toEqual([proposal.id]);
    expect(store.prds[0].filePath).toBe(prdPathFor(proposal.id));
    expect(store.plans.map((plan) => plan.proposalId)).toEqual([proposal.id]);
  });

  it("stops planning with a code when the server has no repository to read", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const { deps, tasks } = depsFor(store, new MemorySaver(), {});

    await driveRunGraph(deps, runId);
    await approve(store, runId);
    const result = await driveRunGraph(deps, runId, "approve");

    expect(result.status).toBe("failed");
    expect(store.runs.get(runId)?.currentStage).toBe("failed");
    expect(store.runs.get(runId)?.errorCode).toBe("no_repository");
    expect(tasks).not.toContain("productops.code_plan");
  });

  it("adopts a transition the action already made rather than making it twice", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const { deps } = depsFor(store);

    await driveRunGraph(deps, runId);
    await approve(store, runId);
    // The server action moves the run itself, then resumes the graph.
    await store.repository.advanceStage({
      runId,
      from: "human_review",
      to: "prd",
      event: { status: "started", from: "human_review", review: "approve" },
    });

    const result = await driveRunGraph(deps, runId, "approve");

    expect(result.status).toBe("waiting");
    expect(store.runs.get(runId)?.currentStage).toBe("plan_review");
    // Exactly one entry into prd, not two.
    expect(
      store.events.filter(
        (event) => event.runId === runId && event.stage === "prd" && event.status === "started",
      ),
    ).toHaveLength(1);
  });

  it("ends the run on a rejection", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const { deps } = depsFor(store);

    await driveRunGraph(deps, runId);
    const result = await driveRunGraph(deps, runId, "reject");

    expect(result.stage).toBe("rejected");
    expect(store.runs.get(runId)?.currentStage).toBe("rejected");
    expect(store.runs.get(runId)?.status).toBe("rejected");
  });

  it("leaves a run parked when resumed with a decision that moves nothing", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const { deps } = depsFor(store);

    await driveRunGraph(deps, runId);
    const result = await driveRunGraph(deps, runId, "comment");

    expect(result.status).toBe("waiting");
    expect(store.runs.get(runId)?.currentStage).toBe("human_review");
  });
});

describe("stages this process may not run", () => {
  it.each(["implementation", "verification", "pull_request"] as const)(
    "ends at %s as deferred without a working tree",
    async (stage) => {
      const store = createProductOpsStore();
      const runId = await seedRunAt(store, stage);
      const { deps, tasks } = depsFor(store);

      const result = await driveRunGraph(deps, runId);

      expect(result.status).toBe("finished");
      expect(result.stage).toBe(stage);
      expect(store.runs.get(runId)?.currentStage).toBe(stage);
      expect(tasks).toEqual([]);
    },
  );

  it.each(["completed", "failed", "rejected"] as const)(
    "does nothing for a run already at %s",
    async (stage) => {
      const store = createProductOpsStore();
      const runId = await seedRunAt(store, stage);
      const { deps, tasks } = depsFor(store);

      const result = await driveRunGraph(deps, runId);

      expect(result.status).toBe("finished");
      expect(tasks).toEqual([]);
    },
  );

  it("reports an unreadable run rather than inventing a stage", async () => {
    const store = createProductOpsStore();
    const { deps } = depsFor(store);

    const result = await driveRunGraph(deps, "00000000-0000-4000-8000-999999999999");

    expect(result.status).toBe("unavailable");
    expect(result.stage).toBeNull();
  });
});

describe("the durable checkpoint", () => {
  it("parks in the repository-backed saver and resumes from it", async () => {
    // The real saver, over the in-memory store: what the server writes on one
    // instance is what another instance resumes from.
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const saver = new ProductOpsCheckpointSaver(store.repository);
    const { deps } = depsFor(store, saver as never);

    await driveRunGraph(deps, runId);
    expect(store.checkpoints.length).toBeGreaterThan(0);
    expect(store.checkpoints.every((row) => row.threadId === runId)).toBe(true);

    await approve(store, runId);
    const fresh = depsFor(store, new ProductOpsCheckpointSaver(store.repository) as never);
    const result = await driveRunGraph(fresh.deps, runId, "approve");

    expect(result.status).toBe("waiting");
    expect(store.runs.get(runId)?.currentStage).toBe("plan_review");
  });

  it("carries identifiers and control flow, never a proposal", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const { deps } = depsFor(store, new ProductOpsCheckpointSaver(store.repository) as never);

    await driveRunGraph(deps, runId);

    const blobs = store.checkpoints
      .map((row) => Buffer.from(row.checkpoint, "base64").toString("utf8"))
      .join("\n");
    expect(blobs).toContain(runId);
    expect(blobs).not.toContain(PROPOSAL.problemStatement);
    expect(blobs).not.toContain(FINDING.summary);
  });

  it("bounds one invocation by a step cap that no honest drive reaches", () => {
    expect(MAX_GRAPH_STEPS).toBeGreaterThanOrEqual(PRODUCT_OPS_STAGES.length);
    expect(MAX_GRAPH_STEPS).toBeLessThan(PRODUCT_OPS_STAGES.length * 2);
  });
});

describe("driving a run again after a retry", () => {
  it("picks the graph up at the stage that failed and carries on", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const saver = new MemorySaver();

    // Fails at planning: the server has no repository to read.
    const blind = depsFor(store, saver, {});
    await driveRunGraph(blind.deps, runId);
    await approve(store, runId);
    const failed = await driveRunGraph(blind.deps, runId, "approve");
    expect(failed.status).toBe("failed");
    expect(store.runs.get(runId)?.currentStage).toBe("failed");

    // Now with a repository. The retry returns the run to planning and the
    // same thread, driven again, runs planning alone and parks at the gate.
    const sighted = depsFor(store, saver);
    const retried = await retryRun(sighted.deps, { runId, operatorIdHash: "hash-operator" });
    expect(retried).toEqual({ status: "retried", stage: "code_plan" });

    const result = await driveRunGraph(sighted.deps, runId);

    expect(result.status).toBe("waiting");
    expect(store.runs.get(runId)?.currentStage).toBe("plan_review");
    expect(store.runs.get(runId)?.errorCode).toBeNull();
    // The PRD was already written before the failure and is not written twice.
    expect(store.prds).toHaveLength(1);
    expect(sighted.tasks).toEqual(["productops.code_plan", "productops.plan_breakdown"]);
  });
});
