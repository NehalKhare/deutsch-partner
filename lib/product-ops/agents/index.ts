import { z } from "zod";

import {
  deniedPathsIn,
  implementationPlanSchema,
  productProposalSchema,
  type ImplementationPlan,
  type MarketFinding,
  type ProductProposal,
} from "@/domain/product-ops";
import type { CallContext } from "@/lib/ai/gateway/gateway";
import { createTurnBudget } from "@/lib/ai/gateway/budgeter";
import type { Applier, ApplyOutcome } from "@/lib/product-ops/apply";
import {
  runAgent,
  type AgentContext,
  type AgentDeps,
  type AgentOutcome,
} from "@/lib/product-ops/agents/runtime";
import {
  TOOL_FENCES,
  coderTools,
  cpoTools,
  plannerTools,
  researchTools,
  type InternalDocs,
  type PriorProposal,
  type RepositoryBrowser,
} from "@/lib/product-ops/agents/tools";
import type { LearnerFeedbackSource } from "@/lib/product-ops/feedback";
import type { SpecialistDeps } from "@/lib/product-ops/specialist";

/**
 * The four product-ops agents.
 *
 * Each is the shared runtime plus its own tools, its own bounds, and the one
 * thing it refuses to believe about its own answer. What comes out is what
 * the tools recorded — findings written, edits applied — never the model's
 * account of what it did, which is why the research and coding agents hand
 * back counts from their tool closures rather than from the reply.
 */

export type {
  AgentContext,
  AgentDeps,
  AgentFailure,
  AgentOutcome,
  ModelLadderFactory,
} from "@/lib/product-ops/agents/runtime";
export type { AgentProgress, ModelProgress, ToolProgress } from "@/lib/product-ops/agents/middleware";

/**
 * The agent's view of a call context.
 *
 * The orchestrator hands every stage a turn budget sized to what the run has
 * left; an agent asked to run without one gets a budget of nothing, which
 * stops it before its first model call rather than letting it spend on an
 * unbudgeted path (product-ops-spec.md section 14).
 */
function agentContext(context: CallContext): AgentContext {
  return {
    requestId: context.requestId,
    userIdHash: context.userIdHash,
    turn: context.turn ?? createTurnBudget(0),
  };
}
export type {
  InternalDocs,
  PriorProposal,
  RepositoryBrowser,
} from "@/lib/product-ops/agents/tools";

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

/** How many web searches one scan may run. Each is a paid call. */
export const MAX_SEARCHES_PER_SCAN = 6;

/**
 * Small on purpose: the agent answers on the cheap tier's 600-token turns, and
 * a summary that does not fit the turn is a summary that is cut off.
 */
const researchSummarySchema = z.strictObject({
  anglesCovered: z.array(z.string().min(1).max(80)).min(1).max(4),
  summary: z.string().min(1).max(400),
});

export interface ResearchAgentRequest {
  readonly brief: string;
  readonly specialist: SpecialistDeps;
  readonly context: CallContext;
  readonly record: (findings: readonly MarketFinding[]) => Promise<boolean>;
  /** The learners' own feedback, for the agent to read before it searches. */
  readonly feedback?: LearnerFeedbackSource;
}

export interface ResearchAgentReport {
  readonly searches: number;
  readonly recorded: number;
}

export async function runResearchAgent(
  deps: AgentDeps,
  request: ResearchAgentRequest,
): Promise<AgentOutcome<ResearchAgentReport>> {
  const toolset = researchTools({
    specialist: request.specialist,
    context: request.context,
    record: request.record,
    feedback: request.feedback,
  });

  const outcome = await runAgent(deps, {
    agent: "research",
    task: "productops.market_research",
    tools: toolset.tools,
    fences: TOOL_FENCES,
    schema: researchSummarySchema,
    message: `Brief: ${request.brief}`,
    context: agentContext(request.context),
    // One tool call per search plus the one read of learner feedback, and
    // the model calls that drive them.
    limits: { toolCalls: MAX_SEARCHES_PER_SCAN + 1, modelCalls: MAX_SEARCHES_PER_SCAN + 4 },
  });

  const report = { searches: toolset.searches(), recorded: toolset.recorded() };

  // A scan whose closing summary was malformed, or whose loop hit a cap, but
  // whose findings landed is a scan that worked: the rows are the output and
  // the summary is a courtesy. Only a budget refusal or an absent model is a
  // failure worth stopping the run over when there is something to show.
  if (
    outcome.status === "failed" &&
    (outcome.reason === "invalid_output" || outcome.reason === "tool_limit") &&
    report.recorded > 0
  ) {
    return { ...outcome, status: "ok", value: report };
  }
  if (outcome.status !== "ok") return outcome;

  return { ...outcome, value: report };
}

// ---------------------------------------------------------------------------
// The CPO
// ---------------------------------------------------------------------------

export interface CpoAgentRequest {
  readonly brief: string;
  readonly findings: readonly MarketFinding[];
  readonly prior: readonly PriorProposal[];
  readonly docs?: InternalDocs;
  readonly context: CallContext;
}

/** Every address the findings actually carry. The only ones a proposal may cite. */
function knownUrls(findings: readonly MarketFinding[]): ReadonlySet<string> {
  const urls = new Set<string>();
  for (const finding of findings) {
    if (finding.sourceUrl) urls.add(finding.sourceUrl.toLowerCase());
    for (const item of finding.evidence) {
      if (item.url) urls.add(item.url.toLowerCase());
    }
  }
  return urls;
}

export async function runCpoAgent(
  deps: AgentDeps,
  request: CpoAgentRequest,
): Promise<AgentOutcome<ProductProposal>> {
  const outcome = await runAgent(deps, {
    agent: "cpo",
    task: "productops.proposal_synthesis",
    tools: cpoTools({
      findings: request.findings,
      prior: request.prior,
      docs: request.docs,
    }),
    fences: TOOL_FENCES,
    schema: productProposalSchema,
    message: `Brief: ${request.brief}`,
    context: agentContext(request.context),
    limits: { toolCalls: 8, modelCalls: 10 },
  });
  if (outcome.status !== "ok") return outcome;

  // Cite only what the findings carry. The finding survives; the address it
  // was attributed to does not, if nobody actually read it.
  const known = knownUrls(request.findings);
  const evidence = outcome.value.evidence.filter(
    (item) => item.url === undefined || known.has(item.url.toLowerCase()),
  );

  return { ...outcome, value: { ...outcome.value, evidence } };
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

export interface PlannerAgentRequest {
  readonly prd: string;
  readonly browser: RepositoryBrowser;
  readonly context: CallContext;
}

export type PlannerAgentOutcome =
  | (Extract<AgentOutcome<ImplementationPlan>, { status: "ok" }> & {
      /**
       * Paths the plan names that the apply layer will refuse regardless.
       * Reported rather than removed: the reviewer should see that the model
       * wanted something it may not have.
       */
      readonly denied: readonly string[];
    })
  | Extract<AgentOutcome<ImplementationPlan>, { status: "failed" }>;

export async function runPlannerAgent(
  deps: AgentDeps,
  request: PlannerAgentRequest,
): Promise<PlannerAgentOutcome> {
  const outcome = await runAgent(deps, {
    agent: "planner",
    task: "productops.code_plan",
    tools: plannerTools({ prd: request.prd, browser: request.browser }),
    fences: TOOL_FENCES,
    schema: implementationPlanSchema,
    message:
      "Plan the implementation of the PRD. Read it with read_prd, orient in the repository, then answer with the plan.",
    context: agentContext(request.context),
    // Tool calls are local reads and cost nothing; model calls are the cost,
    // because every turn re-sends the transcript on the reasoning tier. So
    // the tool allowance is generous — a model that reads six files in one
    // turn is being frugal, not greedy — and the model-call cap is the tight
    // one. Twelve turns is a PRD, a couple of listings, two or three batches
    // of reads, and the answer with room for a repair.
    limits: { toolCalls: 30, modelCalls: 12 },
  });
  if (outcome.status !== "ok") return outcome;

  return { ...outcome, denied: deniedPathsIn(outcome.value) };
}

// ---------------------------------------------------------------------------
// The coder
// ---------------------------------------------------------------------------

const coderSummarySchema = z.strictObject({
  filesChanged: z.array(z.string().min(1).max(200)).max(30),
  summary: z.string().min(1).max(1200),
});

export interface CoderAgentRequest {
  /** What to build, derived from the approved plan and the PRD. Trusted framing. */
  readonly instruction: string;
  readonly applier: Applier;
  readonly onChange: (outcome: ApplyOutcome) => Promise<void> | void;
  readonly context: CallContext;
  /** How many edits this pass may propose. A repair pass gets fewer. */
  readonly maxEdits?: number;
}

export interface CoderAgentReport {
  readonly changes: readonly ApplyOutcome[];
}

export async function runCoderAgent(
  deps: AgentDeps,
  request: CoderAgentRequest,
): Promise<AgentOutcome<CoderAgentReport>> {
  const toolset = coderTools({ applier: request.applier, onChange: request.onChange });
  const maxEdits = request.maxEdits ?? 20;

  const outcome = await runAgent(deps, {
    agent: "coder",
    task: "productops.code_edit",
    tools: toolset.tools,
    fences: TOOL_FENCES,
    schema: coderSummarySchema,
    message: request.instruction,
    context: agentContext(request.context),
    // Reads and edits together; the model call cap sits just above.
    limits: { toolCalls: maxEdits * 2, modelCalls: maxEdits * 2 + 2 },
  });

  const report = { changes: toolset.changes() };

  // As with research: the edits are the output. A malformed closing summary
  // after applied edits is not a failed implementation.
  if (
    outcome.status === "failed" &&
    outcome.reason === "invalid_output" &&
    report.changes.some((change) => change.applied)
  ) {
    return { ...outcome, status: "ok", value: report };
  }
  if (outcome.status !== "ok") return outcome;

  return { ...outcome, value: report };
}
