import {
  branchNameFor,
  isDeniedPath,
  nextStage,
  prdPathFor,
  runSpendEur,
  stageAfterReview,
  stageOwner,
  type EventStatus,
  type ImplementationPlan,
  type MarketFinding,
  type PrdRecord,
  type ProductOpsRun,
  type ProductOpsStage,
  type ReviewAction,
  type ReviewOutcome,
  type RunEvent,
  type RunType,
  type ServerStage,
  type StageOutcome,
  type StoredProposal,
  type WorkerStage,
} from "@/domain/product-ops";
import { createTurnBudget } from "@/lib/ai/gateway/budgeter";
import type { CallContext, ModelGateway } from "@/lib/ai/gateway/gateway";
import { nullLogger, type Logger } from "@/lib/observability/logger";
import {
  runCpoAgent,
  runPlannerAgent,
  runResearchAgent,
  type AgentDeps,
  type InternalDocs,
  type ModelLadderFactory,
  type RepositoryBrowser,
} from "@/lib/product-ops/agents";
import { synthesiseProposal } from "@/lib/product-ops/cpo";
import { planImplementation, type RepositoryFile } from "@/lib/product-ops/planner";
import { prdSections, renderPrdDocument } from "@/lib/product-ops/prd";
import { researchMarket, researchQueries } from "@/lib/product-ops/research";
import type { SpecialistDeps } from "@/lib/product-ops/specialist";
import { ok, type RepositoryResult } from "@/repositories/errors";
import type { ProductOpsRepository } from "@/repositories/product-ops-repository";
import type { StoredFinding } from "@/repositories/product-ops-rows";

/**
 * The orchestrator.
 *
 * Stateless, by design and not by accident. Durable state lives in Postgres; a
 * call to advanceRun loads a run, dispatches exactly one stage, and records
 * what happened. That is what makes pausing, resuming, retrying and auditing
 * the same mechanism rather than four, and it is why nothing in this workflow
 * is a long-running request.
 *
 * The stages here are the nodes of the LangGraph state graph in
 * lib/product-ops/graph/. The graph owns pausing at the two human gates and
 * resuming from a durable checkpoint; this module owns what a stage does and
 * how it is recorded, and it still runs one stage per invocation so that the
 * graph's checkpoint and the run's row can never disagree about progress.
 *
 * Inside a stage, judgement is delegated to a tool-using agent when the
 * composition supplies models for one (lib/product-ops/agents/); without them
 * the single-shot specialists remain, so a test can drive a stage with a fake
 * gateway and no agent framework.
 *
 * Four kinds of stage, and the type system insists every stage is exactly one
 * of them: terminal, a human gate, work this process can do, and work it
 * cannot. The last kind is the honest half of running an agent that edits a
 * repository — the server has no checkout, so it defers those stages to the
 * CLI worker rather than pretending.
 */

/**
 * What a whole run may spend, by kind.
 *
 * Durable, unlike the gateway's per-request accumulator: the figure is
 * reconstructed from the run's own timeline on every invocation, so a run that
 * spends its budget across six separate stage invocations is still stopped.
 * The persisted daily and global budgets sit above this and are not replaced
 * by it.
 *
 * Starting figures, to be tuned against real traces rather than argued about.
 * An implementation run gets more because a code edit is a reasoning-tier call
 * per file and a verification failure buys one repair pass.
 */
export const RUN_BUDGET_EUR: Readonly<Record<RunType, number>> = {
  manual_market_scan: 0.5,
  feature_implementation: 1,
};

/** What a scan looks for when the operator did not say. */
export const DEFAULT_BRIEF = "German learning for English speakers";

/** How many earlier proposals the CPO is shown, so it does not re-propose one. */
const RECENT_PROPOSALS = 10;

// ---------------------------------------------------------------------------
// The working tree, as a port
// ---------------------------------------------------------------------------

/**
 * Everything the workflow needs that lives outside the database.
 *
 * A port rather than an import, so this module holds no filesystem, no git and
 * no HTTP: the four stages that touch a repository state what they need and
 * the CLI worker supplies it. The server supplies nothing, which is what makes
 * those stages deferred there rather than broken.
 */
export interface Workspace {
  /** The repository these changes are for, as owner/name. */
  readonly repository: string;

  /**
   * The files the planner may read. Chosen by the workspace — never by the
   * model, which has not been given a way to ask for a path.
   *
   * The fallback path, for a deployment without agent models: the planner
   * agent browses instead.
   */
  plannerContext(input: {
    readonly prd: string;
  }): Promise<readonly RepositoryFile[]>;

  /** How the planner agent reads the worktree: listings, files, exact-text search. */
  browser?(): RepositoryBrowser;

  /** Writes the approved plan, through the trusted validation layer. */
  implement(input: {
    readonly proposal: StoredProposal;
    readonly prd: string;
    readonly plan: ImplementationPlan;
    readonly context: CallContext;
    /** The coder agent's models and progress sink, when the run has them. */
    readonly agents?: AgentDeps | null;
  }): Promise<ImplementationReport>;

  /**
   * Runs the project's own gate, with one repair pass if it fails.
   *
   * It takes the plan because the repair pass is a write, and a write is
   * checked against the approved file list like any other. A verify() with no
   * arguments would be a verify() whose repair had no allowlist.
   */
  verify(input: {
    readonly plan: ImplementationPlan;
    readonly context: CallContext;
    readonly agents?: AgentDeps | null;
  }): Promise<VerificationReport>;

  /** Pushes the branch and opens, or adopts, the pull request. */
  publish(input: {
    readonly proposal: StoredProposal;
    readonly prd: PrdRecord;
    readonly branch: string;
  }): Promise<PublishReport>;
}

export interface AppliedChange {
  readonly path: string;
  readonly editCount: number;
  readonly bytesBefore: number | null;
  readonly bytesAfter: number | null;
  readonly applied: boolean;
  readonly rejectedReason: string | null;
}

export interface ImplementationReport {
  readonly status: "ok" | "already_done" | "failed";
  readonly changes: readonly AppliedChange[];
  readonly costEur: number;
  /** A code. Never a command's output and never a provider message. */
  readonly detail: string | null;
}

export interface VerificationReport {
  readonly status: "ok" | "failed";
  /** A code — which step failed — never the step's output. */
  readonly detail: string | null;
  /** What a repair pass cost. Zero when the gate passed first time. */
  readonly costEur: number;
  /** What the repair pass wrote, if it wrote anything. */
  readonly changes: readonly AppliedChange[];
}

export interface PublishReport {
  readonly status: "ok" | "failed";
  readonly prNumber: number | null;
  readonly url: string | null;
  readonly detail: string | null;
}

// ---------------------------------------------------------------------------
// What one invocation reports
// ---------------------------------------------------------------------------

export type AdvanceStatus =
  /** The stage ran and the run moved on. */
  | "advanced"
  /** A human gate. Only an operator's decision leaves it. */
  | "waiting"
  /** Work this process is not equipped to do. The worker's, not a failure. */
  | "deferred"
  /** Terminal. There is nothing left to advance. */
  | "finished"
  /** The stage failed and the run is now failed. */
  | "failed"
  /** Somebody else moved the run first. An ordinary outcome for a worker. */
  | "raced"
  /** The store could not be read or written. Nothing was decided. */
  | "unavailable";

export interface AdvanceResult {
  readonly status: AdvanceStatus;
  /** Where the run stands after this call. Null when it could not be read. */
  readonly stage: ProductOpsStage | null;
  /** What the stage reported, or null when nothing ran. */
  readonly outcome: StageOutcome | null;
  readonly costEur: number;
  /** A code, never a message. */
  readonly detail: string | null;
}

export interface WorkflowDeps {
  readonly runs: ProductOpsRepository;
  readonly gateway: ModelGateway;
  /**
   * The tier ladders the agents run on, from the gateway. Absent means the
   * stages fall back to the single-shot specialists, which is what a test
   * with a fake gateway and a deployment without tool-capable models get.
   */
  readonly models?: ModelLadderFactory;
  /** The product's own corpus, for the CPO to check what already exists. */
  readonly docs?: InternalDocs;
  /**
   * A read-only view of the repository, for the planner. The server has one
   * wherever it runs beside a checkout; a worker's workspace supplies its own.
   * Absent everywhere means a plan cannot be produced, and the stage says so.
   */
  readonly browser?: RepositoryBrowser;
  /** Present in the CLI worker, absent in the server. */
  readonly workspace?: Workspace;
  readonly logger?: Logger;
}

// ---------------------------------------------------------------------------
// The stage kinds
// ---------------------------------------------------------------------------

/** The stages something actually runs, whether here or in the worker. */
type WorkStage = ServerStage | WorkerStage;

interface StageResult {
  readonly outcome: StageOutcome;
  readonly costEur: number;
  /** A code when the stage failed. Never a message. */
  readonly errorCode: string | null;
  /** Anything else worth having on the timeline. */
  readonly detail?: Record<string, unknown>;
}

interface StageContext {
  readonly deps: WorkflowDeps;
  readonly run: ProductOpsRun;
  /** The run's own timeline, already read for the budget. */
  readonly events: readonly RunEvent[];
  readonly call: CallContext;
  readonly logger: Logger;
  readonly specialist: SpecialistDeps;
  /** Null when no models were supplied: the stage uses its specialist instead. */
  readonly agents: AgentDeps | null;
}

interface StageRunner {
  run(context: StageContext, workspace: Workspace | undefined): Promise<StageResult>;
}

const finished = (costEur: number, detail?: Record<string, unknown>): StageResult => ({
  outcome: "ok",
  costEur,
  errorCode: null,
  detail,
});

const adopted = (detail?: Record<string, unknown>): StageResult => ({
  outcome: "already_done",
  costEur: 0,
  errorCode: null,
  detail,
});

const broke = (
  errorCode: string,
  costEur = 0,
  detail?: Record<string, unknown>,
): StageResult => ({ outcome: "failed", costEur, errorCode, detail });

/** A store failure, as a code that says which layer refused. */
const storeBroke = (kind: string, costEur = 0): StageResult =>
  broke(`store_${kind}`, costEur);

/**
 * The status the timeline records for entering a stage.
 *
 * Entry events and work events share the table and must not be confusable: a
 * work event says "this stage ran and here is its outcome", and an entry event
 * says "the run is now here". Without the distinction, the transition into
 * verification would look exactly like a verification that had passed, and the
 * idempotency guard would skip the check.
 */
export function entryStatus(stage: ProductOpsStage): EventStatus {
  if (stage === "failed") return "failed";
  if (stage === "rejected") return "rejected";

  return "started";
}

function eventStatusFor(outcome: StageOutcome): EventStatus {
  return outcome;
}

/**
 * A stored finding, back in the shape the agents speak.
 *
 * The score defaults to the middle rather than to zero when the column is
 * null: zero would sort a finding to the bottom of the shedding order on the
 * strength of a missing value, and a missing value is not evidence of
 * irrelevance.
 */
function asFinding(stored: StoredFinding): MarketFinding {
  return {
    title: stored.title,
    sourceType: stored.sourceType,
    ...(stored.sourceUrl === null ? {} : { sourceUrl: stored.sourceUrl }),
    summary: stored.summary,
    painPoints: stored.painPoints,
    trends: stored.trends,
    evidence: stored.evidence,
    relevanceScore: stored.relevanceScore ?? 0.5,
  };
}

// ---------------------------------------------------------------------------
// The stages
// ---------------------------------------------------------------------------

const research: StageRunner = {
  async run({ deps, run, call, specialist, agents }) {
    const existing = await deps.runs.listFindings(run.id);
    if (!existing.ok) return storeBroke(existing.error.kind);
    // The stage's own output, from a previous attempt that landed and then
    // died before its transition. Nothing to redo.
    if (existing.data.length > 0) {
      return adopted({ findings: existing.data.length });
    }

    const brief = run.brief ?? DEFAULT_BRIEF;

    if (specialist && agents) {
      // The agent chooses its own queries and records findings as it goes,
      // so a scan that dies halfway keeps what it found. What is trusted is
      // the count from the tool, not the model's account of it.
      const outcome = await runResearchAgent(agents, {
        brief,
        specialist,
        context: call,
        record: async (findings) => {
          const recorded = await deps.runs.recordFindings(run.id, findings);
          return recorded.ok;
        },
      });
      if (outcome.status !== "ok") {
        // The reason is the code; the detail says which error class or issue
        // path produced it, and is the first thing an incident needs.
        return broke(outcome.reason, outcome.costEur, { detail: outcome.detail });
      }
      if (outcome.value.recorded === 0) return broke("no_findings", outcome.costEur);

      return finished(outcome.costEur, {
        agent: "research",
        searches: outcome.value.searches,
        findings: outcome.value.recorded,
        toolCalls: outcome.toolCalls,
      });
    }

    const queries = researchQueries(brief);
    const found: MarketFinding[] = [];
    let costEur = 0;
    let lastFailure: string | null = null;

    for (const query of queries) {
      const outcome = await researchMarket(specialist, { query, context: call });
      costEur += outcome.costEur;

      if (outcome.status === "ok") found.push(...outcome.value);
      else lastFailure = outcome.reason;
    }

    // A scan that found nothing is not a scan worth synthesising from, whether
    // the queries failed or the web simply had nothing to say.
    if (found.length === 0) return broke(lastFailure ?? "no_findings", costEur);

    const recorded = await deps.runs.recordFindings(run.id, found);
    if (!recorded.ok) return storeBroke(recorded.error.kind, costEur);

    return finished(costEur, { queries: queries.length, findings: found.length });
  },
};

const synthesis: StageRunner = {
  async run({ deps, run, call, specialist, agents }) {
    const existing = await deps.runs.findProposalForRun(run.id);
    if (!existing.ok) return storeBroke(existing.error.kind);
    if (existing.data !== null) return adopted({ proposalId: existing.data.id });

    const findings = await deps.runs.listFindings(run.id);
    if (!findings.ok) return storeBroke(findings.error.kind);
    if (findings.data.length === 0) return broke("no_findings");

    // What has already been proposed, so the CPO does not propose it again.
    // Degrades quietly: a proposal written without this context is thinner,
    // not wrong, and failing the stage over it would be worse.
    const earlier = await deps.runs.listProposals(RECENT_PROPOSALS);
    const internalContext = earlier.ok
      ? earlier.data
          .filter((proposal) => proposal.runId !== run.id)
          .map((proposal) => ({
            content: `Already proposed — ${proposal.title} (${proposal.status}): ${proposal.problemStatement}`,
            source: "proposal",
          }))
      : [];

    const outcome = agents
      ? await runCpoAgent(agents, {
          brief: run.brief ?? DEFAULT_BRIEF,
          findings: findings.data.map(asFinding),
          prior: earlier.ok
            ? earlier.data
                .filter((proposal) => proposal.runId !== run.id)
                .map((proposal) => ({
                  title: proposal.title,
                  status: proposal.status,
                  problemStatement: proposal.problemStatement,
                }))
            : [],
          docs: deps.docs,
          context: call,
        })
      : await synthesiseProposal(specialist, {
          brief: run.brief ?? DEFAULT_BRIEF,
          findings: findings.data.map(asFinding),
          internalContext,
          context: call,
        });
    if (outcome.status !== "ok") return broke(outcome.reason, outcome.costEur);

    const saved = await deps.runs.saveProposal(run.id, outcome.value);
    if (!saved.ok) {
      // The unique index on (run_id, title_slug) is the idempotency key. A
      // collision means this proposal is already filed, which is success.
      return saved.error.kind === "conflict"
        ? adopted({ costEur: outcome.costEur })
        : storeBroke(saved.error.kind, outcome.costEur);
    }

    return finished(outcome.costEur, {
      proposalId: saved.data.id,
      priorityScore: saved.data.priorityScore,
    });
  },
};

const prd: StageRunner = {
  async run({ deps, run, call, specialist, logger }) {
    const proposal = await deps.runs.findProposalForRun(run.id);
    if (!proposal.ok) return storeBroke(proposal.error.kind);
    if (proposal.data === null) return broke("no_proposal");

    const existing = await deps.runs.findPrdForProposal(proposal.data.id);
    if (!existing.ok) return storeBroke(existing.error.kind);
    if (existing.data !== null) return adopted({ prdId: existing.data.id });

    const outcome = await prdSections(specialist, {
      proposal: proposal.data,
      context: call,
    });
    if (outcome.status !== "ok") return broke(outcome.reason, outcome.costEur);

    // Rendered, not generated: everything but the four judgement sections is
    // a projection of the row a person approved.
    const document = renderPrdDocument(proposal.data, outcome.value);

    const saved = await deps.runs.savePrd({
      proposalId: proposal.data.id,
      document,
      sections: outcome.value,
      filePath: prdPathFor(proposal.data.id),
    });
    if (!saved.ok) return storeBroke(saved.error.kind, outcome.costEur);

    await moveProposal(deps, proposal.data.id, "prd_ready", logger);

    return finished(outcome.costEur, {
      prdId: saved.data.id,
      documentHash: saved.data.documentHash,
    });
  },
};

/**
 * What the single-shot planner is shown when there is a browser but no
 * tool-capable model: the tree and the two documents that state the rules.
 */
async function plannerContextFrom(
  browser: RepositoryBrowser,
): Promise<readonly RepositoryFile[]> {
  const paths = await browser.list("");
  const files: RepositoryFile[] = [{ path: "repository tree", content: paths.join("\n") }];
  for (const path of ["AGENTS.md", "docs/architecture.md"]) {
    const content = await browser.read(path);
    if (content !== null) files.push({ path, content: content.slice(0, 4_000) });
  }
  return files;
}

const codePlan: StageRunner = {
  async run({ deps, run, call, specialist, logger, agents }, workspace) {
    const proposal = await deps.runs.findProposalForRun(run.id);
    if (!proposal.ok) return storeBroke(proposal.error.kind);
    if (proposal.data === null) return broke("no_proposal");

    const document = await deps.runs.findPrdForProposal(proposal.data.id);
    if (!document.ok) return storeBroke(document.error.kind);
    if (document.data === null) return broke("no_prd");

    const existing = await deps.runs.findPlanForProposal(proposal.data.id);
    if (!existing.ok) return storeBroke(existing.error.kind);
    if (existing.data !== null) return adopted({ planId: existing.data.id });

    // Planning only reads. The server's own browser first, then a worker's
    // workspace; a process with neither cannot plan and says so, rather than
    // deferring to a worker this workflow no longer has a stage for.
    const browser = deps.browser ?? workspace?.browser?.() ?? null;
    if (browser === null && !workspace) return broke("no_repository");

    const outcome =
      agents !== null && browser !== null
        ? // The planner reads the repository itself, through tools that apply
          // the deny-list before the filesystem is asked anything.
          await runPlannerAgent(agents, {
          prd: document.data.document,
          browser,
          context: call,
        })
      : await (async () => {
          const context = workspace
            ? await attempt(() =>
                workspace.plannerContext({ prd: document.data!.document }),
              )
            : await attempt(async () => plannerContextFrom(browser!));
          if (!context.ok) return null;

          return planImplementation(specialist, {
            prd: document.data!.document,
            repository: context.value,
            context: call,
          });
        })();
    if (outcome === null) return broke("workspace_unavailable");
    if (outcome.status !== "ok") return broke(outcome.reason, outcome.costEur);

    const writable = [
      ...outcome.value.filesToModify,
      ...outcome.value.filesToCreate,
    ].filter((path) => !isDeniedPath(path));

    // A plan every one of whose files the apply layer would refuse is a plan
    // that cannot be implemented, and putting it in front of a reviewer would
    // only ask them to approve something that will then be refused.
    if (writable.length === 0) {
      return broke("all_paths_denied", outcome.costEur, { denied: outcome.denied });
    }

    const saved = await deps.runs.savePlan(proposal.data.id, outcome.value);
    if (!saved.ok) return storeBroke(saved.error.kind, outcome.costEur);

    await moveProposal(deps, proposal.data.id, "plan_ready", logger);

    return finished(outcome.costEur, {
      planId: saved.data.id,
      files: writable.length,
      // Reported to the reviewer rather than removed from the plan: the person
      // approving it should see that the model asked for something it may not
      // have. The apply layer refuses these regardless of the approval.
      denied: outcome.denied,
    });
  },
};

const implementation: StageRunner = {
  async run({ deps, run, call, logger, agents }, workspace) {
    if (!workspace) return broke("no_workspace");

    const proposal = await deps.runs.findProposalForRun(run.id);
    if (!proposal.ok) return storeBroke(proposal.error.kind);
    if (proposal.data === null) return broke("no_proposal");

    const plan = await deps.runs.findPlanForProposal(proposal.data.id);
    if (!plan.ok) return storeBroke(plan.error.kind);
    if (plan.data === null) return broke("no_plan");

    // The fail-closed rule this whole feature is built around: autonomous
    // repository modification never begins without a person having approved
    // this specific list of files.
    if (plan.data.status !== "approved") return broke("plan_not_approved");

    const changes = await deps.runs.listCodeChanges(plan.data.id);
    if (!changes.ok) return storeBroke(changes.error.kind);
    if (changes.data.length > 0) return adopted({ changes: changes.data.length });

    const document = await deps.runs.findPrdForProposal(proposal.data.id);
    if (!document.ok) return storeBroke(document.error.kind);
    if (document.data === null) return broke("no_prd");

    const report = await attempt(() =>
      workspace.implement({
        proposal: proposal.data!,
        prd: document.data!.document,
        plan: plan.data!.plan,
        context: call,
        agents,
      }),
    );
    if (!report.ok) return broke("workspace_unavailable");

    // Recorded before the outcome is acted on, applied or refused. This is the
    // answer to "what did the agent do to my repository", which git history
    // does not give for a rejection.
    for (const change of report.value.changes) {
      const recorded = await deps.runs.recordCodeChange({
        planId: plan.data.id,
        ...change,
      });
      if (!recorded.ok) {
        logger.warn("productops.change_unrecorded", {
          runId: run.id,
          errorKind: recorded.error.kind,
        });
      }
    }

    if (report.value.status === "failed") {
      return broke(report.value.detail ?? "implementation", report.value.costEur);
    }
    if (report.value.status === "already_done") {
      return adopted({ costEur: report.value.costEur });
    }

    await moveProposal(deps, proposal.data.id, "verifying", logger);

    return finished(report.value.costEur, {
      changes: report.value.changes.length,
      applied: report.value.changes.filter((change) => change.applied).length,
    });
  },
};

const verification: StageRunner = {
  async run({ deps, run, events, call, logger, agents }, workspace) {
    if (!workspace) return broke("no_workspace");

    // The stage's durable output is its own work event, which is why entry
    // events carry a different status: otherwise the transition *into* this
    // stage would read as a pass.
    if (
      events.some(
        (event) => event.stage === "verification" && event.status === "ok",
      )
    ) {
      return adopted();
    }

    const proposal = await deps.runs.findProposalForRun(run.id);
    if (!proposal.ok) return storeBroke(proposal.error.kind);
    if (proposal.data === null) return broke("no_proposal");

    const plan = await deps.runs.findPlanForProposal(proposal.data.id);
    if (!plan.ok) return storeBroke(plan.error.kind);
    if (plan.data === null) return broke("no_plan");
    // A repair pass writes files, so it is held to the same approval as the
    // implementation stage was.
    if (plan.data.status !== "approved") return broke("plan_not_approved");

    const report = await attempt(() =>
      workspace.verify({ plan: plan.data!.plan, context: call, agents }),
    );
    if (!report.ok) return broke("workspace_unavailable");

    // Whatever the repair pass wrote is recorded, passed or failed. Otherwise
    // a repair that broke something else would be invisible.
    for (const change of report.value.changes) {
      await deps.runs.recordCodeChange({ planId: plan.data.id, ...change });
    }

    if (report.value.status === "failed") {
      return broke(report.value.detail ?? "verification", report.value.costEur);
    }

    await moveProposal(deps, proposal.data.id, "verifying", logger);

    return finished(report.value.costEur, {
      repaired: report.value.changes.length,
    });
  },
};

const pullRequest: StageRunner = {
  async run({ deps, run, logger }, workspace) {
    if (!workspace) return broke("no_workspace");

    const proposal = await deps.runs.findProposalForRun(run.id);
    if (!proposal.ok) return storeBroke(proposal.error.kind);
    if (proposal.data === null) return broke("no_proposal");

    const document = await deps.runs.findPrdForProposal(proposal.data.id);
    if (!document.ok) return storeBroke(document.error.kind);
    if (document.data === null) return broke("no_prd");

    // Derived from the proposal and nothing else, which is what makes this
    // idempotent: the same run computes the same branch and finds its own
    // pull request rather than opening a second one.
    const branch = branchNameFor(proposal.data.id);

    const existing = await deps.runs.findPullRequestForBranch(
      workspace.repository,
      branch,
    );
    if (!existing.ok) return storeBroke(existing.error.kind);
    if (existing.data !== null && existing.data.prNumber !== null) {
      return adopted({ prNumber: existing.data.prNumber });
    }

    const report = await attempt(() =>
      workspace.publish({
        proposal: proposal.data!,
        prd: document.data!,
        branch,
      }),
    );
    if (!report.ok) return broke("workspace_unavailable");
    if (report.value.status === "failed") {
      return broke(report.value.detail ?? "publish");
    }

    const saved = await deps.runs.savePullRequest({
      proposalId: proposal.data.id,
      repository: workspace.repository,
      branch,
      prNumber: report.value.prNumber,
      url: report.value.url,
    });
    if (!saved.ok) return storeBroke(saved.error.kind);

    await moveProposal(deps, proposal.data.id, "pr_open", logger);

    return finished(0, { prNumber: report.value.prNumber, branch });
  },
};

/**
 * Every stage something runs, and who runs it.
 *
 * A Readonly<Record<WorkStage, …>>, so adding a stage to the union without
 * deciding what runs it is a type error rather than a run that stops somewhere
 * nobody chose.
 */
const RUNNERS: Readonly<Record<WorkStage, StageRunner>> = {
  research,
  synthesis,
  prd,
  code_plan: codePlan,
  implementation,
  verification,
  pull_request: pullRequest,
};

// ---------------------------------------------------------------------------
// Advancing a run
// ---------------------------------------------------------------------------

/** A workspace call, which touches a filesystem and can therefore throw. */
async function attempt<T>(
  work: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await work() };
  } catch {
    // Deliberately swallowed. A thrown filesystem or git error carries paths
    // and command output, and neither belongs in an error code.
    return { ok: false };
  }
}

/**
 * Moves the proposal's own status along.
 *
 * A warning rather than a failure when it does not take: the run's stage is
 * the state that matters and the proposal status is what the board renders
 * from. Failing a stage that has already done its work, over a label, would
 * turn a cosmetic problem into a lost PRD.
 */
async function moveProposal(
  deps: WorkflowDeps,
  proposalId: string,
  status: Parameters<ProductOpsRepository["setProposalStatus"]>[1],
  logger: Logger,
): Promise<void> {
  const outcome = await deps.runs.setProposalStatus(proposalId, status);
  if (outcome.ok) return;

  logger.warn("productops.status_not_set", {
    proposalId,
    status,
    errorKind: outcome.error.kind,
  });
}

export const nothingRan = (
  status: AdvanceStatus,
  stage: ProductOpsStage | null,
): AdvanceResult => ({ status, stage, outcome: null, costEur: 0, detail: null });

/**
 * The agents' dependencies for one stage of one run.
 *
 * Progress is where the agents meet the dashboard: every finished tool call
 * becomes a 'progress' event on the run's timeline — the agent and the tool,
 * never the arguments or the result — and touches the run, so the board's
 * liveness signal moves while a planner is still reading its ninth file. A
 * progress row that fails to write is logged and forgotten; it must never
 * fail the tool call it describes.
 */
function agentDepsFor(
  deps: WorkflowDeps,
  run: ProductOpsRun,
  stage: ProductOpsStage,
  logger: Logger,
): AgentDeps | null {
  if (!deps.models) return null;

  return {
    models: deps.models,
    logger,
    onProgress: async (progress) => {
      const recorded = await deps.runs.recordEvent({
        runId: run.id,
        stage,
        status: "progress",
        detail: { tool: progress.tool, ok: progress.ok },
      });
      if (!recorded.ok) {
        logger.warn("productops.progress_unrecorded", {
          runId: run.id,
          stage,
          errorKind: recorded.error.kind,
        });
      }
      await deps.runs.touchRun(run.id);
    },
  };
}

/**
 * Runs exactly one stage of one run.
 *
 * Every path through this function ends with the run either where it was or
 * one stage further on, and with the timeline saying which. Nothing here
 * loops: a caller that wants a run driven to its next gate calls this again,
 * and each call is a resume point.
 */
export async function advanceRun(
  deps: WorkflowDeps,
  runId: string,
): Promise<AdvanceResult> {
  const logger = deps.logger ?? nullLogger;

  const loaded = await deps.runs.getRun(runId);
  if (!loaded.ok) {
    logger.warn("productops.run_unreadable", {
      runId,
      errorKind: loaded.error.kind,
    });
    return nothingRan("unavailable", null);
  }

  const run = loaded.data;
  const stage = run.currentStage;
  const owner = stageOwner(stage);

  if (owner === "nobody") return nothingRan("finished", stage);
  if (owner === "operator") return nothingRan("waiting", stage);
  if (owner === "worker" && !deps.workspace) {
    // Not a failure. The server has no checkout; this stage belongs to the
    // CLI worker, and saying so is more useful than failing the run.
    return nothingRan("deferred", stage);
  }

  const runner = RUNNERS[stage as WorkStage];

  const events = await deps.runs.listEvents(runId);
  if (!events.ok) return nothingRan("unavailable", stage);

  const ceiling = RUN_BUDGET_EUR[run.runType];
  const remaining = ceiling - runSpendEur(events.data);

  if (remaining <= 0) {
    logger.warn("productops.run_over_budget", {
      audit: true,
      runId,
      stage,
      ceiling,
    });
    return await settle(
      deps,
      run,
      stage,
      broke("run_budget"),
      logger,
    );
  }

  const call: CallContext = {
    requestId: run.requestId,
    // The operator's pseudonym, which is the only identity these tables hold.
    // Their spend lands on the existing cost dashboard under it.
    userIdHash: run.operatorIdHash,
    turn: createTurnBudget(remaining),
  };

  const result = await runner.run(
    {
      deps,
      run,
      events: events.data,
      call,
      logger,
      specialist: { gateway: deps.gateway, logger },
      agents: deps.models ? agentDepsFor(deps, run, stage, logger) : null,
    },
    deps.workspace,
  );

  return await settle(deps, run, stage, result, logger);
}

/**
 * Records what a stage did and moves the run.
 *
 * The work event is written first and the transition second, and that order is
 * the whole recovery story: a process that dies between them leaves evidence
 * the stage ran, which the next attempt's idempotency guard finds. The reverse
 * order would leave a run that had moved on from work nobody can see.
 */
async function settle(
  deps: WorkflowDeps,
  run: ProductOpsRun,
  stage: ProductOpsStage,
  result: StageResult,
  logger: Logger,
): Promise<AdvanceResult> {
  const recorded = await deps.runs.recordEvent({
    runId: run.id,
    stage,
    status: eventStatusFor(result.outcome),
    detail: {
      costEur: result.costEur,
      ...(result.errorCode === null ? {} : { errorCode: result.errorCode }),
      ...(result.detail ?? {}),
    },
  });
  if (!recorded.ok) {
    logger.warn("productops.event_unrecorded", {
      runId: run.id,
      stage,
      errorKind: recorded.error.kind,
    });
  }

  const to = nextStage(stage, result.outcome);
  if (to === null) {
    // Only reachable if a stage runner is registered for a gate, which the
    // type of RUNNERS forbids. Kept because a function that can fall off the
    // end is one a refactor can quietly break.
    return {
      status: "waiting",
      stage,
      outcome: result.outcome,
      costEur: result.costEur,
      detail: result.errorCode,
    };
  }

  const moved = await deps.runs.advanceStage({
    runId: run.id,
    from: stage,
    to,
    event: {
      status: entryStatus(to),
      from: stage,
      requestId: run.requestId,
      ...(result.errorCode === null ? {} : { errorCode: result.errorCode }),
    },
  });

  if (!moved.ok) {
    return {
      status: "unavailable",
      stage,
      outcome: result.outcome,
      costEur: result.costEur,
      detail: result.errorCode,
    };
  }

  if (!moved.data.advanced) {
    // Somebody else got there first. Ordinary, and the work this invocation
    // did is on the timeline either way.
    logger.info("productops.transition_refused", {
      runId: run.id,
      from: stage,
      stage: moved.data.stage,
    });
    return {
      status: "raced",
      stage: moved.data.stage,
      outcome: result.outcome,
      costEur: result.costEur,
      detail: result.errorCode,
    };
  }

  logger.info("productops.stage_finished", {
    runId: run.id,
    from: stage,
    stage: moved.data.stage,
    outcome: result.outcome,
    costEur: result.costEur,
    errorCode: result.errorCode,
  });

  return {
    status: result.outcome === "failed" ? "failed" : "advanced",
    stage: moved.data.stage,
    outcome: result.outcome,
    costEur: result.costEur,
    detail: result.errorCode,
  };
}

/**
 * Advances a run until something else has to happen.
 *
 * A loop around advanceRun rather than a longer advanceRun, so that the
 * one-stage-per-invocation property still holds underneath: every iteration is
 * a complete, recorded, resumable step, and stopping between any two of them
 * loses nothing. It ends at the first stage that is not this process's to run
 * — a human gate, a worker stage, a terminal state, a failure, or a race.
 *
 * The step cap is a bound on one invocation, not on the run. The pipeline is
 * nine stages long and no legitimate drive is longer, so a drive that hits the
 * cap is a loop, and stopping is the right answer to a loop.
 */
export const MAX_DRIVE_STEPS = 8;

export async function driveRun(
  deps: WorkflowDeps,
  runId: string,
  maxSteps: number = MAX_DRIVE_STEPS,
): Promise<AdvanceResult> {
  let last: AdvanceResult = nothingRan("waiting", null);

  for (let step = 0; step < maxSteps; step += 1) {
    last = await advanceRun(deps, runId);
    if (last.status !== "advanced") return last;
  }

  (deps.logger ?? nullLogger).warn("productops.drive_capped", {
    runId,
    maxSteps,
    stage: last.stage,
  });

  return last;
}

// ---------------------------------------------------------------------------
// The human gates
// ---------------------------------------------------------------------------

export interface ReviewRequest {
  readonly proposalId: string;
  readonly action: ReviewAction;
  readonly newPriority: number | null;
  readonly comment: string | null;
  readonly operatorIdHash: string;
}

export interface ReviewResult {
  readonly review: ReviewOutcome;
  readonly advance: AdvanceResult;
  /** The run the decision moved, so a caller can drive it on. */
  readonly runId: string;
}

/**
 * Records a human decision and moves the run it belongs to.
 *
 * Both, in one place, because they are one act: a proposal that is approved
 * and a run still sitting at its gate is the state an operator would call a
 * bug. The decision itself is atomic in the database — the review row, the
 * proposal's status and, for a plan approval, the plan's — and the transition
 * that follows is the same compare-and-set every worker uses.
 *
 * Nothing here decides whether the caller may do this. That is the action's
 * job and the route's before it, and the tables' privileges after.
 */
export async function applyReview(
  deps: WorkflowDeps,
  request: ReviewRequest,
): Promise<RepositoryResult<ReviewResult>> {
  const logger = deps.logger ?? nullLogger;

  const proposal = await deps.runs.getProposal(request.proposalId);
  if (!proposal.ok) return proposal;

  const run = await deps.runs.getRun(proposal.data.runId);
  if (!run.ok) return run;

  const stage = run.data.currentStage;

  const recorded = await deps.runs.review(request);
  if (!recorded.ok) return recorded;

  // An operator action on a privileged surface, per guardrails S24.
  logger.info("productops.reviewed", {
    audit: true,
    action: request.action,
    proposalId: request.proposalId,
    runId: run.data.id,
    stage,
    userIdHash: request.operatorIdHash,
    status: recorded.data.status,
  });

  const to = stageAfterReview(stage, request.action);
  if (to === null) {
    // A comment and a reprioritisation are decisions worth recording that are
    // not decisions to proceed. The run stays at its gate.
    return ok({
      review: recorded.data,
      advance: nothingRan("waiting", stage),
      runId: run.data.id,
    });
  }

  const moved = await deps.runs.advanceStage({
    runId: run.data.id,
    from: stage,
    to,
    event: {
      status: entryStatus(to),
      from: stage,
      review: request.action,
      requestId: run.data.requestId,
    },
  });
  if (!moved.ok) return moved;

  // Accepting a plan ends the run, and the board reads the proposal's own
  // status: the database function records the decision as 'coding', which
  // was true when a worker followed, and 'completed' is what is true now.
  if (moved.data.advanced && to === "completed") {
    await moveProposal(deps, request.proposalId, "completed", logger);
  }

  return ok({
    review: recorded.data,
    advance: {
      status: moved.data.advanced ? "advanced" : "raced",
      stage: moved.data.stage,
      outcome: null,
      costEur: 0,
      detail: null,
    },
    runId: run.data.id,
  });
}
