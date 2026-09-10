import { describe, expect, it } from "vitest";

import {
  PRODUCT_OPS_STAGES,
  REVIEW_ACTIONS,
  branchNameFor,
  nextStage,
  prdPathFor,
  stageAfterReview,
  type ImplementationPlan,
  type ProductOpsStage,
} from "@/domain/product-ops";
import { gatewayOk } from "@/lib/ai/gateway/errors";
import type {
  CallContext,
  CompletionOutcome,
  ModelGateway,
} from "@/lib/ai/gateway/gateway";
import type { ModelCallSpec } from "@/lib/ai/gateway/call-spec";
import type { TaskId } from "@/lib/ai/tasks";
import {
  RUN_BUDGET_EUR,
  advanceRun,
  applyReview,
  type Workspace,
} from "@/lib/product-ops/workflow";
import { researchQueries } from "@/lib/product-ops/research";
import {
  createProductOpsStore,
  seedRunAt,
  type ProductOpsStore,
} from "../../support/product-ops-store";

/**
 * The orchestrator.
 *
 * Three properties carry the weight. One stage runs per invocation, so nothing
 * is long-running and every call is a resume point. Every stage checks for its
 * own output first, so a retry after a crash adopts what is there rather than
 * doing it twice. And a transition is a compare-and-set, so a double-clicked
 * button and two workers racing both end with one winner.
 *
 * The database's version of the last one is tested against a real engine in
 * tests/db; here the store mirrors it, which is what lets these tests be about
 * the orchestrator's decisions rather than about Postgres.
 */

const FINDING = {
  title: "Nurses cannot certify in German",
  sourceType: "forum",
  sourceUrl: "https://example.test/thread/1",
  summary: "Recurring complaint about medical vocabulary gaps.",
  painPoints: ["no medical vocabulary"],
  trends: ["healthcare recruitment"],
  evidence: [
    { url: "https://example.test/thread/1", finding: "Twelve replies agree." },
  ],
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
  evidence: [
    { url: "https://example.test/thread/1", finding: "Twelve replies agree." },
  ],
};

const SECTIONS = {
  userStories: ["As a nurse, I want clinical vocabulary, so that I can work."],
  functionalRequirements: ["The module teaches twenty clinical terms."],
  acceptanceCriteria: ["A learner can complete the module."],
  nonGoals: ["No spoken examination."],
};

const PLAN: ImplementationPlan = {
  filesToModify: ["learning/curriculum.ts"],
  filesToCreate: ["content/medical.md"],
  databaseChanges: [],
  apiChanges: [],
  uiChanges: [],
  tests: ["tests/unit/learning/medical.test.ts"],
  dependencies: [],
  risks: ["The vocabulary may be too specialised."],
};

/** What each task's reply looks like on the wire: one JSON object. */
const REPLIES: Readonly<Record<string, unknown>> = {
  "productops.market_research": { findings: [FINDING] },
  "productops.proposal_synthesis": PROPOSAL,
  "productops.prd_sections": SECTIONS,
  "productops.code_plan": PLAN,
};

interface Dispatch {
  readonly task: TaskId;
  readonly context: CallContext;
  /** The assembled system prompt, so a test can assert what was sent. */
  readonly system: string;
}

/**
 * A gateway that answers by task, and records what it was asked.
 *
 * Hand-written rather than mocked so the tests can assert what was sent — the
 * operator's pseudonym on the call, the number of research queries — as well
 * as what came back.
 */
function fakeGateway(
  options: {
    readonly replies?: Readonly<Record<string, unknown>>;
    readonly fail?: ReadonlySet<string>;
    readonly costEur?: number;
    readonly onCall?: (task: TaskId) => void | Promise<void>;
  } = {},
) {
  const dispatches: Dispatch[] = [];
  const replies = options.replies ?? REPLIES;

  const gateway: ModelGateway = {
    async complete(spec: ModelCallSpec, prompt, context) {
      dispatches.push({ task: spec.task, context, system: prompt.system });
      await options.onCall?.(spec.task);

      if (options.fail?.has(spec.task)) {
        return { ok: false, failure: "provider_error", detail: "no" } as never;
      }

      return gatewayOk<CompletionOutcome>({
        text: JSON.stringify(replies[spec.task] ?? {}),
        truncated: false,
        degraded: false,
        tier: "cheap",
        modelIdResolved: "vendor/model",
        inputTokens: 400,
        outputTokens: 200,
        costUsd: 0.001,
        costEur: options.costEur ?? 0.001,
        attempts: 1,
        ledgerId: 1,
        citations: [{ url: "https://example.test/thread/1", title: null }],
      });
    },
    async stream() {
      throw new Error("product ops does not stream");
    },
  };

  return { gateway, dispatches };
}

/** A workspace that reports success and records what it was asked to do. */
function fakeWorkspace(
  over: Partial<Workspace> & { readonly repository?: string } = {},
): Workspace & { readonly log: string[] } {
  const log: string[] = [];

  return {
    log,
    repository: over.repository ?? "acme/german-partner",
    async plannerContext() {
      log.push("plannerContext");
      return [{ path: "learning/curriculum.ts", content: "export const x = 1;" }];
    },
    async implement() {
      log.push("implement");
      return {
        status: "ok",
        costEur: 0.02,
        detail: null,
        changes: [
          {
            path: "learning/curriculum.ts",
            editCount: 1,
            bytesBefore: 20,
            bytesAfter: 40,
            applied: true,
            rejectedReason: null,
          },
        ],
      };
    },
    async verify() {
      log.push("verify");
      return { status: "ok", detail: null, costEur: 0, changes: [] };
    },
    async publish() {
      log.push("publish");
      return { status: "ok", prNumber: 7, url: "https://git.test/7" };
    },
    ...over,
  } as Workspace & { readonly log: string[] };
}

async function seedProposal(store: ProductOpsStore, runId: string) {
  const saved = await store.repository.saveProposal(runId, PROPOSAL as never);
  if (!saved.ok) throw new Error("the store refused to save a proposal");
  return saved.data;
}

async function seedPrd(store: ProductOpsStore, proposalId: string) {
  const saved = await store.repository.savePrd({
    proposalId,
    document: "# Medical German module\n",
    sections: SECTIONS,
    filePath: prdPathFor(proposalId),
  });
  if (!saved.ok) throw new Error("the store refused to save a PRD");
  return saved.data;
}

describe("the review transitions", () => {
  it("is total over every stage and action pair", () => {
    for (const stage of PRODUCT_OPS_STAGES) {
      for (const action of REVIEW_ACTIONS) {
        const to = stageAfterReview(stage, action);

        expect(to === null || PRODUCT_OPS_STAGES.includes(to), `${stage}/${action}`)
          .toBe(true);
      }
    }
  });

  it("leaves a gate only on the decision that gate is for", () => {
    expect(stageAfterReview("human_review", "approve")).toBe("prd");
    // Accepting the plan ends the run: the plan is the deliverable.
    expect(stageAfterReview("plan_review", "approve_plan")).toBe("completed");
    // An approval aimed at the wrong gate moves nothing: approving a proposal
    // is not approving the plan that has not been written yet.
    expect(stageAfterReview("plan_review", "approve")).toBeNull();
    expect(stageAfterReview("human_review", "approve_plan")).toBeNull();
  });

  it("records a comment and a reprioritisation without moving the run", () => {
    expect(stageAfterReview("human_review", "comment")).toBeNull();
    expect(stageAfterReview("human_review", "reprioritise")).toBeNull();
  });

  it("rejects from either gate and from nowhere else", () => {
    expect(stageAfterReview("human_review", "reject")).toBe("rejected");
    expect(stageAfterReview("plan_review", "reject")).toBe("rejected");

    for (const stage of PRODUCT_OPS_STAGES) {
      if (stage === "human_review" || stage === "plan_review") continue;
      expect(stageAfterReview(stage, "reject"), stage).toBeNull();
    }
  });
});

describe("stages nothing automatic may leave", () => {
  it.each(["human_review", "plan_review"] as const)(
    "waits at %s without dispatching anything",
    async (stage) => {
      const store = createProductOpsStore();
      const runId = await seedRunAt(store, stage);
      const { gateway, dispatches } = fakeGateway();

      const result = await advanceRun({ runs: store.repository, gateway }, runId);

      expect(result.status).toBe("waiting");
      expect(result.stage).toBe(stage);
      expect(dispatches).toEqual([]);
      expect(store.runs.get(runId)?.currentStage).toBe(stage);
    },
  );

  it.each(["completed", "failed", "rejected"] as const)(
    "reports %s as finished and does no work",
    async (stage) => {
      const store = createProductOpsStore();
      const runId = await seedRunAt(store, stage);
      const { gateway, dispatches } = fakeGateway();

      const result = await advanceRun({ runs: store.repository, gateway }, runId);

      expect(result.status).toBe("finished");
      expect(dispatches).toEqual([]);
    },
  );

  it("fails planning with a code when it has no repository to read at all", async () => {
    // Planning only reads, so it runs on the server — but a server beside no
    // checkout, and no worker either, cannot produce a plan and must say so
    // rather than defer to a worker this workflow no longer has a stage for.
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "code_plan");
    const proposal = await seedProposal(store, runId);
    await store.repository.savePrd({
      proposalId: proposal.id,
      document: "# PRD",
      sections: SECTIONS,
      filePath: prdPathFor(proposal.id),
    });
    const { gateway, dispatches } = fakeGateway();

    const result = await advanceRun({ runs: store.repository, gateway }, runId);

    expect(result.status).toBe("failed");
    expect(result.detail).toBe("no_repository");
    expect(dispatches).toEqual([]);
  });

  it.each(["implementation", "verification", "pull_request"] as const)(
    "defers %s when there is no working tree",
    async (stage) => {
      // The server has no checkout to plan against or write into. Deferring is
      // the honest answer: the stage is somebody else's to run.
      const store = createProductOpsStore();
      const runId = await seedRunAt(store, stage);
      const { gateway, dispatches } = fakeGateway();

      const result = await advanceRun({ runs: store.repository, gateway }, runId);

      expect(result.status).toBe("deferred");
      expect(result.stage).toBe(stage);
      expect(dispatches).toEqual([]);
    },
  );

  it("reports an unreadable run rather than guessing at a stage", async () => {
    const store = createProductOpsStore();
    const { gateway } = fakeGateway();

    const result = await advanceRun(
      { runs: store.repository, gateway },
      "00000000-0000-4000-8000-999999999999",
    );

    expect(result.status).toBe("unavailable");
  });
});

describe("the research stage", () => {
  it("runs one call per query and advances to synthesis", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const { gateway, dispatches } = fakeGateway();

    const result = await advanceRun({ runs: store.repository, gateway }, runId);

    expect(result.status).toBe("advanced");
    expect(result.stage).toBe("synthesis");
    expect(dispatches).toHaveLength(researchQueries("healthcare German").length);
    expect(store.findings).not.toEqual([]);
  });

  it("attributes the calls to the operator who started the run", async () => {
    // Operator spend has to land on the cost dashboard under the operator's
    // own pseudonym, which is the only identity these tables ever hold.
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const { gateway, dispatches } = fakeGateway();

    await advanceRun({ runs: store.repository, gateway }, runId);

    for (const dispatch of dispatches) {
      expect(dispatch.context.userIdHash).toBe("hash-operator");
    }
  });

  it("derives its queries from the brief the operator gave", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research", { brief: "spoken fluency" });
    const { gateway } = fakeGateway();

    await advanceRun({ runs: store.repository, gateway }, runId);

    expect(researchQueries("spoken fluency").every((query) =>
      query.includes("spoken fluency"),
    )).toBe(true);
  });

  it("adopts the findings it already has instead of researching twice", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const first = fakeGateway();

    await advanceRun({ runs: store.repository, gateway: first.gateway }, runId);
    const found = store.findings.length;

    // Put the run back where it was, as a crash between the work and the
    // transition would leave it.
    const run = store.runs.get(runId);
    if (run) store.runs.set(runId, { ...run, currentStage: "research" });

    const second = fakeGateway();
    const result = await advanceRun(
      { runs: store.repository, gateway: second.gateway },
      runId,
    );

    expect(result.outcome).toBe("already_done");
    expect(result.status).toBe("advanced");
    expect(second.dispatches).toEqual([]);
    expect(store.findings).toHaveLength(found);
  });

  it("fails the run with a code when every query fails", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const { gateway } = fakeGateway({
      fail: new Set(["productops.market_research"]),
    });

    const result = await advanceRun({ runs: store.repository, gateway }, runId);

    expect(result.status).toBe("failed");
    expect(store.runs.get(runId)?.currentStage).toBe("failed");
    // A code, never a provider message: an error string can quote the prompt
    // back and the prompt carries retrieved web content.
    expect(store.runs.get(runId)?.errorCode).toMatch(/^[a-z_]+$/);
  });
});

describe("the synthesis stage", () => {
  it("saves one proposal and stops at the human gate", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const { gateway } = fakeGateway();

    await advanceRun({ runs: store.repository, gateway }, runId);
    const result = await advanceRun({ runs: store.repository, gateway }, runId);

    expect(result.status).toBe("advanced");
    expect(result.stage).toBe("human_review");
    expect(store.proposals).toHaveLength(1);
    expect(store.runs.get(runId)?.status).toBe("awaiting_review");
  });

  it("shows the CPO what has already been proposed", async () => {
    const store = createProductOpsStore();
    const earlier = await seedRunAt(store, "human_review");
    await seedProposal(store, earlier);

    const runId = await seedRunAt(store, "synthesis");
    await store.repository.recordFindings(runId, [FINDING as never]);
    const { gateway, dispatches } = fakeGateway();

    await advanceRun({ runs: store.repository, gateway }, runId);

    const call = dispatches.find(
      (dispatch) => dispatch.task === "productops.proposal_synthesis",
    );
    expect(call).toBeDefined();
    // Fenced as retrieved knowledge, like anything else that came out of a
    // store: a title a model wrote once is not an instruction the second time.
    expect(call?.system).toContain(PROPOSAL.title);
    expect(call?.system).toContain("Already proposed");
  });

  it("adopts the proposal it already wrote", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "synthesis");
    await seedProposal(store, runId);
    const { gateway, dispatches } = fakeGateway();

    const result = await advanceRun({ runs: store.repository, gateway }, runId);

    expect(result.outcome).toBe("already_done");
    expect(dispatches).toEqual([]);
    expect(store.proposals).toHaveLength(1);
  });

  it("fails rather than synthesise a proposal out of nothing", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "synthesis");
    const { gateway, dispatches } = fakeGateway();

    const result = await advanceRun({ runs: store.repository, gateway }, runId);

    expect(result.status).toBe("failed");
    expect(dispatches).toEqual([]);
  });
});

describe("the PRD stage", () => {
  it("renders the document from the proposal and stores both", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "prd");
    const proposal = await seedProposal(store, runId);
    const { gateway } = fakeGateway();

    const result = await advanceRun({ runs: store.repository, gateway }, runId);

    expect(result.status).toBe("advanced");
    expect(result.stage).toBe("code_plan");
    expect(store.prds).toHaveLength(1);
    // The parts that are rendered rather than generated come from the row.
    expect(store.prds[0].document).toContain(proposal.title);
    expect(store.prds[0].document).toContain(SECTIONS.userStories[0]);
    expect(store.prds[0].filePath).toBe(prdPathFor(proposal.id));
    expect(store.proposals[0].status).toBe("prd_ready");
  });

  it("adopts the PRD it already wrote", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "prd");
    const proposal = await seedProposal(store, runId);
    await seedPrd(store, proposal.id);
    const { gateway, dispatches } = fakeGateway();

    const result = await advanceRun({ runs: store.repository, gateway }, runId);

    expect(result.outcome).toBe("already_done");
    expect(dispatches).toEqual([]);
    expect(store.prds).toHaveLength(1);
  });
});

describe("the planning stage", () => {
  it("plans against the working tree and stops at the second gate", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "code_plan");
    const proposal = await seedProposal(store, runId);
    await seedPrd(store, proposal.id);
    const { gateway } = fakeGateway();
    const workspace = fakeWorkspace();

    const result = await advanceRun(
      { runs: store.repository, gateway, workspace },
      runId,
    );

    expect(result.status).toBe("advanced");
    expect(result.stage).toBe("plan_review");
    expect(workspace.log).toContain("plannerContext");
    expect(store.plans).toHaveLength(1);
    // Pending, not approved. Nothing but a person may approve a file list.
    expect(store.plans[0].status).toBe("pending_review");
    expect(store.proposals[0].status).toBe("plan_ready");
  });

  it("fails a plan whose every path the apply layer would refuse", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "code_plan");
    const proposal = await seedProposal(store, runId);
    await seedPrd(store, proposal.id);
    const { gateway } = fakeGateway({
      replies: {
        ...REPLIES,
        "productops.code_plan": {
          ...PLAN,
          filesToModify: ["lib/ai/gateway/gateway.ts"],
          filesToCreate: [],
          tests: [],
        },
      },
    });

    const result = await advanceRun(
      { runs: store.repository, gateway, workspace: fakeWorkspace() },
      runId,
    );

    expect(result.status).toBe("failed");
    expect(store.plans).toEqual([]);
  });

  it("keeps a plan that names one refused path, and says which", async () => {
    // Reported rather than removed: editing the plan quietly would hide from
    // the reviewer that the model asked for something it may not have.
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "code_plan");
    const proposal = await seedProposal(store, runId);
    await seedPrd(store, proposal.id);
    const { gateway } = fakeGateway({
      replies: {
        ...REPLIES,
        "productops.code_plan": {
          ...PLAN,
          filesToModify: ["learning/curriculum.ts", "package.json"],
        },
      },
    });

    const result = await advanceRun(
      { runs: store.repository, gateway, workspace: fakeWorkspace() },
      runId,
    );

    expect(result.status).toBe("advanced");
    expect(store.plans[0].plan.filesToModify).toContain("package.json");
    expect(
      store.events.some((event) =>
        JSON.stringify(event.detail).includes("package.json"),
      ),
    ).toBe(true);
  });
});

describe("the implementation stage", () => {
  async function readyToImplement(store: ProductOpsStore) {
    const runId = await seedRunAt(store, "implementation");
    const proposal = await seedProposal(store, runId);
    await seedPrd(store, proposal.id);
    await store.repository.savePlan(proposal.id, PLAN);

    return { runId, proposal };
  }

  it("refuses to write anything without an approved plan", async () => {
    const store = createProductOpsStore();
    const { runId } = await readyToImplement(store);
    const { gateway } = fakeGateway();
    const workspace = fakeWorkspace();

    const result = await advanceRun(
      { runs: store.repository, gateway, workspace },
      runId,
    );

    expect(result.status).toBe("failed");
    expect(workspace.log).not.toContain("implement");
  });

  it("records what was written and advances to verification", async () => {
    const store = createProductOpsStore();
    const { runId, proposal } = await readyToImplement(store);
    await store.repository.review({
      proposalId: proposal.id,
      action: "approve_plan",
      newPriority: null,
      comment: null,
      operatorIdHash: "hash-operator",
    });
    const { gateway } = fakeGateway();
    const workspace = fakeWorkspace();

    const result = await advanceRun(
      { runs: store.repository, gateway, workspace },
      runId,
    );

    expect(result.status).toBe("advanced");
    expect(result.stage).toBe("verification");
    expect(workspace.log).toContain("implement");
    expect(store.changes).toHaveLength(1);
    expect(store.changes[0].applied).toBe(true);
  });

  it("adopts the changes it already made", async () => {
    const store = createProductOpsStore();
    const { runId, proposal } = await readyToImplement(store);
    await store.repository.review({
      proposalId: proposal.id,
      action: "approve_plan",
      newPriority: null,
      comment: null,
      operatorIdHash: "hash-operator",
    });
    const workspace = fakeWorkspace();
    const { gateway } = fakeGateway();

    await advanceRun({ runs: store.repository, gateway, workspace }, runId);
    const run = store.runs.get(runId);
    if (run) store.runs.set(runId, { ...run, currentStage: "implementation" });

    const again = fakeWorkspace();
    const result = await advanceRun(
      { runs: store.repository, gateway, workspace: again },
      runId,
    );

    expect(result.outcome).toBe("already_done");
    expect(again.log).not.toContain("implement");
    expect(store.changes).toHaveLength(1);
  });
});

describe("the verification stage", () => {
  /** A run at verification has been through both gates and an implementation. */
  async function verified(store: ProductOpsStore) {
    const runId = await seedRunAt(store, "verification");
    const proposal = await seedProposal(store, runId);
    await seedPrd(store, proposal.id);
    await store.repository.savePlan(proposal.id, PLAN);
    await store.repository.review({
      proposalId: proposal.id,
      action: "approve_plan",
      newPriority: null,
      comment: null,
      operatorIdHash: "hash-operator",
    });

    return { runId, proposal };
  }

  it("refuses to run a repair pass without an approved plan", async () => {
    // The gate itself writes nothing, but its repair pass does, and a write
    // is held to the approval whatever stage it happens in.
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "verification");
    const proposal = await seedProposal(store, runId);
    await seedPrd(store, proposal.id);
    await store.repository.savePlan(proposal.id, PLAN);
    const { gateway } = fakeGateway();
    const workspace = fakeWorkspace();

    const result = await advanceRun(
      { runs: store.repository, gateway, workspace },
      runId,
    );

    expect(result.status).toBe("failed");
    expect(workspace.log).not.toContain("verify");
  });

  it("advances to the pull request when the project's own gate passes", async () => {
    const store = createProductOpsStore();
    const { runId } = await verified(store);
    const { gateway } = fakeGateway();
    const workspace = fakeWorkspace();

    const result = await advanceRun(
      { runs: store.repository, gateway, workspace },
      runId,
    );

    expect(result.status).toBe("advanced");
    expect(result.stage).toBe("pull_request");
    expect(workspace.log).toContain("verify");
  });

  it("opens no pull request when verification fails", async () => {
    const store = createProductOpsStore();
    const { runId } = await verified(store);
    const { gateway } = fakeGateway();
    const workspace = fakeWorkspace({
      async verify() {
        return {
          status: "failed",
          detail: "typecheck",
          costEur: 0.01,
          changes: [],
        };
      },
    });

    const result = await advanceRun(
      { runs: store.repository, gateway, workspace },
      runId,
    );

    expect(result.status).toBe("failed");
    expect(store.runs.get(runId)?.currentStage).toBe("failed");
    expect(store.pullRequests).toEqual([]);
  });

  it("still verifies after an implementation that just passed", async () => {
    // The transition into this stage is recorded on the same table as the
    // verification's own result. Were the two written with the same status,
    // arriving here would read as having already verified, and the project's
    // gate would be skipped on every run that reached it normally.
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "implementation");
    const proposal = await seedProposal(store, runId);
    await seedPrd(store, proposal.id);
    await store.repository.savePlan(proposal.id, PLAN);
    await store.repository.review({
      proposalId: proposal.id,
      action: "approve_plan",
      newPriority: null,
      comment: null,
      operatorIdHash: "hash-operator",
    });
    const { gateway } = fakeGateway();
    const workspace = fakeWorkspace();

    const first = await advanceRun(
      { runs: store.repository, gateway, workspace },
      runId,
    );
    expect(first.stage).toBe("verification");

    const second = await advanceRun(
      { runs: store.repository, gateway, workspace },
      runId,
    );

    expect(second.outcome).toBe("ok");
    expect(workspace.log).toContain("verify");
    expect(second.stage).toBe("pull_request");
  });

  it("records what a repair pass wrote, passed or failed", async () => {
    // A repair that fixed the build by breaking something else has to be
    // visible; git history does not show a rejection at all.
    const store = createProductOpsStore();
    const { runId } = await verified(store);
    const { gateway } = fakeGateway();

    await advanceRun(
      {
        runs: store.repository,
        gateway,
        workspace: fakeWorkspace({
          async verify() {
            return {
              status: "failed",
              detail: "test",
              costEur: 0.03,
              changes: [
                {
                  path: "learning/curriculum.ts",
                  editCount: 1,
                  bytesBefore: 40,
                  bytesAfter: 44,
                  applied: true,
                  rejectedReason: null,
                },
              ],
            };
          },
        }),
      },
      runId,
    );

    expect(store.changes.map((change) => change.path)).toContain(
      "learning/curriculum.ts",
    );
  });

  it("does not verify twice when it already recorded a pass", async () => {
    const store = createProductOpsStore();
    const { runId } = await verified(store);
    const { gateway } = fakeGateway();

    await advanceRun(
      { runs: store.repository, gateway, workspace: fakeWorkspace() },
      runId,
    );
    const run = store.runs.get(runId);
    if (run) store.runs.set(runId, { ...run, currentStage: "verification" });

    const again = fakeWorkspace();
    const result = await advanceRun(
      { runs: store.repository, gateway, workspace: again },
      runId,
    );

    expect(result.outcome).toBe("already_done");
    expect(again.log).not.toContain("verify");
  });
});

describe("the pull request stage", () => {
  async function readyToPublish(store: ProductOpsStore) {
    const runId = await seedRunAt(store, "pull_request");
    const proposal = await seedProposal(store, runId);
    await seedPrd(store, proposal.id);

    return { runId, proposal };
  }

  it("records the pull request and completes the run", async () => {
    const store = createProductOpsStore();
    const { runId, proposal } = await readyToPublish(store);
    const { gateway } = fakeGateway();

    const result = await advanceRun(
      { runs: store.repository, gateway, workspace: fakeWorkspace() },
      runId,
    );

    expect(result.status).toBe("advanced");
    expect(result.stage).toBe("completed");
    expect(store.pullRequests).toHaveLength(1);
    expect(store.pullRequests[0].branch).toBe(branchNameFor(proposal.id));
    expect(store.proposals[0].status).toBe("pr_open");
  });

  it("adopts the pull request it already opened rather than opening a second", async () => {
    // The property most worth proving: a run that died between pushing and
    // recording must not produce a second branch or a second pull request.
    const store = createProductOpsStore();
    const { runId } = await readyToPublish(store);
    const { gateway } = fakeGateway();

    await advanceRun(
      { runs: store.repository, gateway, workspace: fakeWorkspace() },
      runId,
    );
    const run = store.runs.get(runId);
    if (run) store.runs.set(runId, { ...run, currentStage: "pull_request" });

    const again = fakeWorkspace();
    const result = await advanceRun(
      { runs: store.repository, gateway, workspace: again },
      runId,
    );

    expect(result.outcome).toBe("already_done");
    expect(again.log).not.toContain("publish");
    expect(store.pullRequests).toHaveLength(1);
  });
});

describe("the per-run euro ceiling", () => {
  it("stops a run that has already spent its budget, before any call", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    await store.repository.recordEvent({
      runId,
      stage: "research",
      status: "failed",
      detail: { costEur: RUN_BUDGET_EUR.manual_market_scan + 0.01 },
    });
    const { gateway, dispatches } = fakeGateway();

    const result = await advanceRun({ runs: store.repository, gateway }, runId);

    expect(result.status).toBe("failed");
    expect(dispatches).toEqual([]);
    expect(store.runs.get(runId)?.errorCode).toBe("run_budget");
  });

  it("records what each stage cost on the stage's own event", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const { gateway } = fakeGateway({ costEur: 0.004 });

    const result = await advanceRun({ runs: store.repository, gateway }, runId);

    expect(result.costEur).toBeGreaterThan(0);
    const recorded = store.events.find(
      (event) => event.stage === "research" && event.status === "ok",
    );
    expect(recorded?.detail.costEur).toBeCloseTo(result.costEur, 10);
  });
});

describe("two workers on one run", () => {
  it("lets exactly one of them move it", async () => {
    // Arranged by moving the run while the model call is in flight, which is
    // what a second worker actually does. The transition is a compare-and-set,
    // so the loser is told where the run went rather than overwriting it.
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "research");
    const { gateway } = fakeGateway({
      onCall: () => {
        const run = store.runs.get(runId);
        if (run?.currentStage === "research") {
          store.runs.set(runId, { ...run, currentStage: "synthesis" });
        }
      },
    });

    const result = await advanceRun({ runs: store.repository, gateway }, runId);

    expect(result.status).toBe("raced");
    expect(result.stage).toBe("synthesis");
  });
});

describe("a human decision", () => {
  async function awaitingReview(store: ProductOpsStore) {
    const runId = await seedRunAt(store, "human_review");
    const proposal = await seedProposal(store, runId);

    return { runId, proposal };
  }

  it("moves an approved proposal to the PRD stage", async () => {
    const store = createProductOpsStore();
    const { runId, proposal } = await awaitingReview(store);
    const { gateway } = fakeGateway();

    const result = await applyReview(
      { runs: store.repository, gateway },
      {
        proposalId: proposal.id,
        action: "approve",
        newPriority: null,
        comment: null,
        operatorIdHash: "hash-operator",
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.advance.stage).toBe("prd");
    expect(store.runs.get(runId)?.currentStage).toBe("prd");
    expect(store.proposals[0].status).toBe("approved");
  });

  it("ends the run when the proposal is rejected", async () => {
    const store = createProductOpsStore();
    const { runId, proposal } = await awaitingReview(store);
    const { gateway } = fakeGateway();

    await applyReview(
      { runs: store.repository, gateway },
      {
        proposalId: proposal.id,
        action: "reject",
        newPriority: null,
        comment: "Not now.",
        operatorIdHash: "hash-operator",
      },
    );

    expect(store.runs.get(runId)?.currentStage).toBe("rejected");
    expect(store.runs.get(runId)?.status).toBe("rejected");
  });

  it("leaves the run where it is on a comment", async () => {
    const store = createProductOpsStore();
    const { runId, proposal } = await awaitingReview(store);
    const { gateway } = fakeGateway();

    const result = await applyReview(
      { runs: store.repository, gateway },
      {
        proposalId: proposal.id,
        action: "comment",
        newPriority: null,
        comment: "What about pronunciation?",
        operatorIdHash: "hash-operator",
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.advance.status).toBe("waiting");
    expect(store.runs.get(runId)?.currentStage).toBe("human_review");
  });

  it("completes the run, and the proposal, once a plan is accepted", async () => {
    const store = createProductOpsStore();
    const runId = await seedRunAt(store, "plan_review");
    const proposal = await seedProposal(store, runId);
    await store.repository.savePlan(proposal.id, PLAN);
    const { gateway } = fakeGateway();

    const result = await applyReview(
      { runs: store.repository, gateway },
      {
        proposalId: proposal.id,
        action: "approve_plan",
        newPriority: null,
        comment: null,
        operatorIdHash: "hash-operator",
      },
    );

    expect(result.ok).toBe(true);
    expect(store.runs.get(runId)?.currentStage).toBe("completed");
    expect(store.plans[0].status).toBe("approved");
    expect(store.proposals[0].status).toBe("completed");
  });
});

describe("the stage graph", () => {
  it("agrees with the review transitions about where a gate leads", () => {
    // nextStage is deliberately silent at a gate, and stageAfterReview is the
    // only thing that speaks there. If both ever answered, there would be two
    // ways out of the one place a person is supposed to decide.
    for (const stage of ["human_review", "plan_review"] as const) {
      expect(nextStage(stage, "ok")).toBeNull();
      expect(stageAfterReview(stage, "approve") ?? stageAfterReview(stage, "approve_plan"))
        .not.toBeNull();
    }
  });

  it("names every stage in exactly one of the four kinds", async () => {
    // Add a stage without deciding who runs it and this fails, rather than a
    // run stopping somewhere nobody chose.
    const store = createProductOpsStore();
    const { gateway } = fakeGateway();
    const seen = new Map<ProductOpsStage, string>();

    for (const stage of PRODUCT_OPS_STAGES) {
      const runId = await seedRunAt(store, stage);
      const result = await advanceRun({ runs: store.repository, gateway }, runId);
      seen.set(stage, result.status);
    }

    for (const stage of PRODUCT_OPS_STAGES) {
      expect(
        ["advanced", "waiting", "deferred", "finished", "failed"],
        stage,
      ).toContain(seen.get(stage));
    }
  });
});
