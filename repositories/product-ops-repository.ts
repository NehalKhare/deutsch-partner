import { z } from "zod";

import {
  eventStatusSchema,
  engineeringBreakdownSchema,
  implementationPlanSchema,
  marketFindingSchema,
  operatorIdHashSchema,
  prdSectionsSchema,
  priorityScoreFor,
  productOpsBoardSchema,
  productOpsStageSchema,
  productProposalSchema,
  proposalSlugSchema,
  proposalStatusSchema,
  repoPathSchema,
  reviewActionSchema,
  reviewOutcomeSchema,
  runBriefSchema,
  runTypeSchema,
  stageTransitionSchema,
  titleSlug,
  type CodeChangeRecord,
  type EventStatus,
  type ImplementationPlan,
  type MarketFinding,
  type PrdRecord,
  type PrdSections,
  type ProductOpsBoard,
  type ProductOpsRun,
  type ProductOpsStage,
  type ProductProposal,
  type ProposalReview,
  type ProposalStatus,
  type PullRequestRecord,
  type ReviewAction,
  type ReviewOutcome,
  type RunEvent,
  type RunType,
  type StageTransition,
  type EngineeringBreakdown,
  type StoredPlan,
  type StoredProposal,
} from "@/domain/product-ops";
import {
  fail,
  mapDatabaseError,
  ok,
  type RepositoryResult,
} from "@/repositories/errors";
import { decodeInput, decodeRow, decodeRows } from "@/repositories/result";
import {
  codeChangeFromRow,
  documentHash,
  eventFromRow,
  findingFromRow,
  findingToRow,
  planFromRow,
  planToRow,
  prdFromRow,
  proposalFromRow,
  reviewFromRow,
  pullRequestFromRow,
  runFromRow,
  type StoredFinding,
} from "@/repositories/product-ops-rows";
import type { DatabaseClient } from "@/repositories/types";
import {
  checkpointFromRow,
  checkpointRowSchema,
  checkpointToRow,
  checkpointWriteFromRow,
  checkpointWriteSchema,
  type CheckpointRow,
  type CheckpointWrite,
} from "@/repositories/product-ops-rows";

const RUNS = "ai_runs";
const EVENTS = "ai_run_events";
const FINDINGS = "market_research";
const PROPOSALS = "product_proposals";
const REVIEWS = "proposal_reviews";
const PRDS = "product_prds";
const PLANS = "implementation_plans";
const PULL_REQUESTS = "pull_requests";
const CODE_CHANGES = "code_changes";
const CHECKPOINTS = "ai_run_checkpoints";
const CHECKPOINT_WRITES = "ai_run_checkpoint_writes";

/** How far back a checkpoint listing goes. History, not a feed. */
const MAX_CHECKPOINTS_LISTED = 50;

/** One run's findings. The research stage is bounded, so this is the whole set. */
const MAX_FINDINGS_PER_RUN = 60;

/**
 * One run's timeline, and one plan's changes.
 *
 * Bounded reads rather than open ones. A run has a handful of stages and a
 * plan a handful of files, so a limit this size is the whole history; it is
 * here so that a run which somehow loops cannot turn a page render into an
 * unbounded query.
 */
// Raised from 200 once model calls joined tool calls as progress rows: a full
// run through planning writes a few hundred, and a truncated timeline would
// under-count the run's spend, which is reconstructed from these rows.
const MAX_EVENTS_PER_RUN = 1000;
const MAX_CHANGES_PER_PLAN = 200;
const MAX_REVIEWS_PER_PROPOSAL = 100;
/** How many earlier proposals the CPO is shown, newest first. */
const MAX_RECENT_PROPOSALS = 25;

/**
 * The product-ops tables.
 *
 * Reached only with the secret-key client: every table here has RLS enabled
 * and no policy, so a request-scoped client would be refused rather than
 * return nothing. That is deliberate — a page that silently showed an empty
 * board to a non-operator would look like a working page.
 *
 * Three operations go through database functions rather than statements,
 * because they cannot be correct as separate round trips: a stage transition
 * has to compare and set under a lock, a review has to move the proposal and
 * record the decision together, and the board has to be one query rather than
 * six that can disagree.
 */
export interface ProductOpsRepository {
  startRun(input: {
    runType: RunType;
    operatorIdHash: string;
    requestId: string | null;
    /** What to look for. Null falls back to the default scan. */
    brief: string | null;
  }): Promise<RepositoryResult<ProductOpsRun>>;

  getRun(runId: string): Promise<RepositoryResult<ProductOpsRun>>;

  /**
   * Moves a run on, or reports that somebody else already did.
   *
   * A refused transition is data, not an error: losing a race is an ordinary
   * outcome for a worker and the caller decides what it means.
   */
  advanceStage(input: {
    runId: string;
    from: ProductOpsStage;
    to: ProductOpsStage;
    event: Record<string, unknown>;
  }): Promise<RepositoryResult<StageTransition>>;

  /**
   * Appends to the timeline without moving the run.
   *
   * The record of what a stage did, written before the transition that leaves
   * it. Two things depend on that order: a stage whose work landed and whose
   * transition did not is recognisable on the next attempt, and the euro cost
   * of the work survives even when the transition never happens.
   */
  recordEvent(input: {
    runId: string;
    stage: ProductOpsStage;
    status: EventStatus;
    detail: Record<string, unknown>;
  }): Promise<RepositoryResult<void>>;

  listEvents(runId: string): Promise<RepositoryResult<RunEvent[]>>;

  /**
   * The timeline after a given row, oldest first. What a live feed reads on
   * each tick, so that following a run costs one indexed range scan rather
   * than the whole timeline again.
   */
  listEventsAfter(runId: string, afterId: number): Promise<RepositoryResult<RunEvent[]>>;

  recordFindings(
    runId: string,
    findings: readonly MarketFinding[],
  ): Promise<RepositoryResult<void>>;

  listFindings(runId: string): Promise<RepositoryResult<StoredFinding[]>>;

  saveProposal(
    runId: string,
    proposal: ProductProposal,
  ): Promise<RepositoryResult<StoredProposal>>;

  getProposal(proposalId: string): Promise<RepositoryResult<StoredProposal>>;

  /** Null rather than not_found: a run without a proposal yet is normal. */
  findProposalForRun(
    runId: string,
  ): Promise<RepositoryResult<StoredProposal | null>>;

  /** The most recent proposals, as context for the next one. */
  listProposals(limit: number): Promise<RepositoryResult<StoredProposal[]>>;

  setProposalStatus(
    proposalId: string,
    status: ProposalStatus,
  ): Promise<RepositoryResult<void>>;

  /**
   * Stores the PRD for a proposal, or returns the one already stored.
   *
   * An upsert on the proposal, which is the idempotency key: the table has a
   * unique constraint on it, so a stage that generated a document and died
   * before recording it writes the same row on retry rather than a second one.
   */
  savePrd(input: {
    proposalId: string;
    document: string;
    sections: PrdSections;
    filePath: string;
  }): Promise<RepositoryResult<PrdRecord>>;

  findPrdForProposal(
    proposalId: string,
  ): Promise<RepositoryResult<PrdRecord | null>>;

  savePlan(
    proposalId: string,
    plan: ImplementationPlan,
  ): Promise<RepositoryResult<StoredPlan>>;

  findPlanForProposal(
    proposalId: string,
  ): Promise<RepositoryResult<StoredPlan | null>>;

  /**
   * Writes the engineering breakdown onto a plan that exists. Separate from
   * savePlan because it is written by a separate call, and a retry of the
   * planning stage may have only this half left to do.
   */
  saveBreakdown(
    planId: string,
    breakdown: EngineeringBreakdown,
  ): Promise<RepositoryResult<StoredPlan>>;

  listCodeChanges(planId: string): Promise<RepositoryResult<CodeChangeRecord[]>>;

  /** The audit trail for one proposal, oldest first. */
  listReviews(proposalId: string): Promise<RepositoryResult<ProposalReview[]>>;

  review(input: {
    proposalId: string;
    action: ReviewAction;
    newPriority: number | null;
    comment: string | null;
    operatorIdHash: string;
  }): Promise<RepositoryResult<ReviewOutcome>>;

  findPullRequestForBranch(
    repository: string,
    branch: string,
  ): Promise<RepositoryResult<PullRequestRecord | null>>;

  savePullRequest(input: {
    proposalId: string;
    repository: string;
    branch: string;
    prNumber: number | null;
    url: string | null;
  }): Promise<RepositoryResult<PullRequestRecord>>;

  recordCodeChange(input: {
    planId: string;
    path: string;
    editCount: number;
    bytesBefore: number | null;
    bytesAfter: number | null;
    applied: boolean;
    rejectedReason: string | null;
  }): Promise<RepositoryResult<void>>;

  board(limit: number): Promise<RepositoryResult<ProductOpsBoard>>;

  /**
   * Removes a finished run and everything that cascades from it.
   *
   * Only a run at a terminal failure or rejection; the filter is in the query,
   * so a running run cannot be deleted by a stale button. The caller checks
   * separately that no proposal hangs off it, because a proposal is a
   * decision's subject and its reviews are the audit trail.
   */
  deleteRun(runId: string): Promise<RepositoryResult<void>>;

  /**
   * Stamps the run's updated_at without changing anything else.
   *
   * The board's liveness signal. A stage transition touches the row already;
   * this is for the tool calls inside a long stage, so a planner reading its
   * twelfth file does not look like a process that died.
   */
  touchRun(runId: string): Promise<RepositoryResult<void>>;

  // The graph's checkpoints. A cache of where in the graph a run stands, keyed
  // by the run as the thread. The rows above remain the truth for every
  // artifact; deleting these loses nothing a person would miss.

  putCheckpoint(checkpoint: CheckpointRow): Promise<RepositoryResult<void>>;

  /** The named checkpoint, or the latest in the namespace when no id is given. */
  getCheckpoint(input: {
    threadId: string;
    checkpointNs: string;
    checkpointId?: string;
  }): Promise<RepositoryResult<CheckpointRow | null>>;

  /** Newest first, optionally only those older than a given id. */
  listCheckpoints(input: {
    threadId: string;
    checkpointNs: string;
    before?: string;
    limit?: number;
  }): Promise<RepositoryResult<CheckpointRow[]>>;

  putCheckpointWrites(input: {
    threadId: string;
    checkpointNs: string;
    checkpointId: string;
    writes: readonly CheckpointWrite[];
  }): Promise<RepositoryResult<void>>;

  listCheckpointWrites(input: {
    threadId: string;
    checkpointNs: string;
    checkpointId: string;
  }): Promise<RepositoryResult<CheckpointWrite[]>>;

  deleteCheckpoints(threadId: string): Promise<RepositoryResult<void>>;
}

const checkpointKeySchema = z.strictObject({
  threadId: z.uuid(),
  checkpointNs: z.string().max(200),
  checkpointId: z.string().min(1).max(200),
});

const startRunInputSchema = z.strictObject({
  runType: runTypeSchema,
  operatorIdHash: operatorIdHashSchema,
  requestId: z.uuid().nullable(),
  brief: runBriefSchema.nullable(),
});

const eventInputSchema = z.strictObject({
  runId: z.uuid(),
  stage: productOpsStageSchema,
  status: eventStatusSchema,
  detail: z.record(z.string(), z.unknown()),
});

const prdInputSchema = z.strictObject({
  proposalId: z.uuid(),
  document: z.string().min(1).max(60_000),
  sections: prdSectionsSchema,
  filePath: repoPathSchema,
});

const advanceInputSchema = z.strictObject({
  runId: z.uuid(),
  from: productOpsStageSchema,
  to: productOpsStageSchema,
  event: z.record(z.string(), z.unknown()),
});

const reviewInputSchema = z.strictObject({
  proposalId: z.uuid(),
  action: reviewActionSchema,
  newPriority: z.number().int().min(0).max(100).nullable(),
  comment: z.string().max(2000).nullable(),
  operatorIdHash: operatorIdHashSchema,
});

const pullRequestInputSchema = z.strictObject({
  proposalId: z.uuid(),
  repository: z.string().min(1).max(200),
  branch: z.string().min(1).max(200),
  prNumber: z.number().int().positive().nullable(),
  url: z.string().max(500).nullable(),
});

/**
 * A code change, refused or applied.
 *
 * The refinement mirrors the table's CHECK so an unexplained refusal is a
 * typed error here rather than a check violation surfacing from Postgres. Both
 * layers keep it: this one gives a caller something to act on, and the
 * database's holds even if a future caller skips this path.
 */
const codeChangeInputSchema = z
  .strictObject({
    planId: z.uuid(),
    path: z.string().min(1).max(200),
    editCount: z.number().int().min(0),
    bytesBefore: z.number().int().min(0).nullable(),
    bytesAfter: z.number().int().min(0).nullable(),
    applied: z.boolean(),
    rejectedReason: z.string().min(1).max(200).nullable(),
  })
  .refine(
    (change) =>
      change.applied
        ? change.rejectedReason === null
        : change.rejectedReason !== null,
    { message: "a refused change must say why, and an applied one must not" },
  );

export function createProductOpsRepository(
  client: DatabaseClient,
): ProductOpsRepository {
  return {
    async startRun(input) {
      const parsed = decodeInput(input, startRunInputSchema);
      if (!parsed.ok) return parsed;

      const outcome = await client
        .from(RUNS)
        .insert({
          run_type: parsed.data.runType,
          status: "running",
          current_stage: "research",
          operator_id_hash: parsed.data.operatorIdHash,
          request_id: parsed.data.requestId,
          // The brief lives in metadata rather than in a column of its own:
          // it is the run's input, not part of its state, and nothing queries
          // or constrains it.
          metadata: parsed.data.brief === null ? {} : { brief: parsed.data.brief },
          started_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      return decodeRow(outcome, runFromRow);
    },

    async getRun(runId) {
      const id = decodeInput(runId, z.uuid());
      if (!id.ok) return id;

      const outcome = await client
        .from(RUNS)
        .select("*")
        .eq("id", id.data)
        .single();

      return decodeRow(outcome, runFromRow);
    },

    async advanceStage(input) {
      const parsed = decodeInput(input, advanceInputSchema);
      if (!parsed.ok) return parsed;

      const outcome = await client.rpc("advance_product_ops_run", {
        p_run_id: parsed.data.runId,
        p_from: parsed.data.from,
        p_to: parsed.data.to,
        p_event: parsed.data.event,
      });

      return decodeRow(outcome, stageTransitionSchema);
    },

    async recordEvent(input) {
      const parsed = decodeInput(input, eventInputSchema);
      if (!parsed.ok) return parsed;

      const outcome = await client.from(EVENTS).insert({
        run_id: parsed.data.runId,
        stage: parsed.data.stage,
        status: parsed.data.status,
        detail: parsed.data.detail,
      });

      if (outcome.error) return fail(mapDatabaseError(outcome.error));

      return ok(undefined);
    },

    async listEvents(runId) {
      const id = decodeInput(runId, z.uuid());
      if (!id.ok) return id;

      const outcome = await client
        .from(EVENTS)
        .select("*")
        .eq("run_id", id.data)
        // By id, not by created_at: two events inside one transaction share a
        // timestamp, and the order they were written in is the order they
        // happened in.
        .order("id", { ascending: true })
        .limit(MAX_EVENTS_PER_RUN);

      return decodeRows(outcome, eventFromRow);
    },

    async listEventsAfter(runId, afterId) {
      const id = decodeInput(runId, z.uuid());
      if (!id.ok) return id;
      const after = decodeInput(afterId, z.number().int().min(0));
      if (!after.ok) return after;

      const outcome = await client
        .from(EVENTS)
        .select("*")
        .eq("run_id", id.data)
        .gt("id", after.data)
        .order("id", { ascending: true })
        .limit(MAX_EVENTS_PER_RUN);

      return decodeRows(outcome, eventFromRow);
    },

    async recordFindings(runId, findings) {
      const id = decodeInput(runId, z.uuid());
      if (!id.ok) return id;

      // Nothing to write is not a degenerate case worth a round trip: a
      // research query that found nothing relevant is a normal answer.
      if (findings.length === 0) return ok(undefined);

      const validated = decodeInput(
        findings,
        z.array(marketFindingSchema).max(MAX_FINDINGS_PER_RUN),
      );
      if (!validated.ok) return validated;

      const outcome = await client.from(FINDINGS).upsert(
        validated.data.map((finding) => findingToRow(id.data, finding)),
        // The unique index is what makes the research stage idempotent. Doing
        // nothing on conflict means a retry after a crash mid-stage adds
        // nothing and still reports success.
        { onConflict: "run_id,finding_hash", ignoreDuplicates: true },
      );

      if (outcome.error) return fail(mapDatabaseError(outcome.error));

      return ok(undefined);
    },

    async listFindings(runId) {
      const id = decodeInput(runId, z.uuid());
      if (!id.ok) return id;

      const outcome = await client
        .from(FINDINGS)
        .select("*")
        .eq("run_id", id.data)
        .order("relevance_score", { ascending: false })
        .limit(MAX_FINDINGS_PER_RUN);

      return decodeRows(outcome, findingFromRow);
    },

    async saveProposal(runId, proposal) {
      const id = decodeInput(runId, z.uuid());
      if (!id.ok) return id;

      const parsed = decodeInput(proposal, productProposalSchema);
      if (!parsed.ok) return parsed;

      // Both derived here rather than taken from the model: the slug is what
      // makes a re-run collide, and the priority is a function of the
      // judgements so that the number on the review page is accountable.
      const slug = decodeInput(titleSlug(parsed.data.title), proposalSlugSchema);
      if (!slug.ok) return slug;

      const outcome = await client
        .from(PROPOSALS)
        .insert({
          run_id: id.data,
          title: parsed.data.title,
          title_slug: slug.data,
          problem_statement: parsed.data.problemStatement,
          market_justification: parsed.data.marketJustification,
          target_users: parsed.data.targetUsers,
          user_impact: parsed.data.userImpact,
          proposed_solution: parsed.data.proposedSolution,
          complexity: parsed.data.complexity,
          priority_score: priorityScoreFor(
            parsed.data.impact,
            parsed.data.complexity,
          ),
          implementation_outline: parsed.data.implementationOutline,
          affected_areas: parsed.data.affectedAreas,
          supporting_research: parsed.data.evidence,
          internal_context: [],
          status: "pending_review",
        })
        .select("*")
        .single();

      return decodeRow(outcome, proposalFromRow);
    },

    async getProposal(proposalId) {
      const id = decodeInput(proposalId, z.uuid());
      if (!id.ok) return id;

      const outcome = await client
        .from(PROPOSALS)
        .select("*")
        .eq("id", id.data)
        .single();

      return decodeRow(outcome, proposalFromRow);
    },

    async findProposalForRun(runId) {
      const id = decodeInput(runId, z.uuid());
      if (!id.ok) return id;

      const outcome = await client
        .from(PROPOSALS)
        .select("*")
        .eq("run_id", id.data)
        .limit(1);

      const rows = decodeRows(outcome, proposalFromRow);
      if (!rows.ok) return rows;

      return ok(rows.data[0] ?? null);
    },

    async listProposals(limit) {
      const parsed = decodeInput(
        limit,
        z.number().int().min(1).max(MAX_RECENT_PROPOSALS),
      );
      if (!parsed.ok) return parsed;

      const outcome = await client
        .from(PROPOSALS)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(parsed.data);

      return decodeRows(outcome, proposalFromRow);
    },

    async setProposalStatus(proposalId, status) {
      const parsed = decodeInput(
        { proposalId, status },
        z.strictObject({
          proposalId: z.uuid(),
          status: proposalStatusSchema,
        }),
      );
      if (!parsed.ok) return parsed;

      const outcome = await client
        .from(PROPOSALS)
        .update({ status: parsed.data.status })
        .eq("id", parsed.data.proposalId);

      if (outcome.error) return fail(mapDatabaseError(outcome.error));

      return ok(undefined);
    },

    async savePrd(input) {
      const parsed = decodeInput(input, prdInputSchema);
      if (!parsed.ok) return parsed;

      const outcome = await client
        .from(PRDS)
        .upsert(
          {
            proposal_id: parsed.data.proposalId,
            document: parsed.data.document,
            // Over the document only, so the worker can check that what it is
            // implementing is what a person read.
            document_hash: documentHash(parsed.data.document),
            sections: parsed.data.sections,
            file_path: parsed.data.filePath,
          },
          { onConflict: "proposal_id" },
        )
        .select("*")
        .single();

      return decodeRow(outcome, prdFromRow);
    },

    async findPrdForProposal(proposalId) {
      const id = decodeInput(proposalId, z.uuid());
      if (!id.ok) return id;

      const outcome = await client
        .from(PRDS)
        .select("*")
        .eq("proposal_id", id.data)
        .limit(1);

      const rows = decodeRows(outcome, prdFromRow);
      if (!rows.ok) return rows;

      return ok(rows.data[0] ?? null);
    },

    async savePlan(proposalId, plan) {
      const id = decodeInput(proposalId, z.uuid());
      if (!id.ok) return id;

      const parsed = decodeInput(plan, implementationPlanSchema);
      if (!parsed.ok) return parsed;

      const outcome = await client
        .from(PLANS)
        .upsert(planToRow(id.data, parsed.data), { onConflict: "proposal_id" })
        .select("*")
        .single();

      return decodeRow(outcome, planFromRow);
    },

    async findPlanForProposal(proposalId) {
      const id = decodeInput(proposalId, z.uuid());
      if (!id.ok) return id;

      const outcome = await client
        .from(PLANS)
        .select("*")
        .eq("proposal_id", id.data)
        .limit(1);

      const rows = decodeRows(outcome, planFromRow);
      if (!rows.ok) return rows;

      return ok(rows.data[0] ?? null);
    },

    async saveBreakdown(planId, breakdown) {
      const id = decodeInput(planId, z.uuid());
      if (!id.ok) return id;

      const parsed = decodeInput(breakdown, engineeringBreakdownSchema);
      if (!parsed.ok) return parsed;

      const outcome = await client
        .from(PLANS)
        .update({ breakdown: parsed.data })
        .eq("id", id.data)
        .select("*")
        .single();

      return decodeRow(outcome, planFromRow);
    },

    async listCodeChanges(planId) {
      const id = decodeInput(planId, z.uuid());
      if (!id.ok) return id;

      const outcome = await client
        .from(CODE_CHANGES)
        .select("*")
        .eq("plan_id", id.data)
        .order("id", { ascending: true })
        .limit(MAX_CHANGES_PER_PLAN);

      return decodeRows(outcome, codeChangeFromRow);
    },

    async listReviews(proposalId) {
      const id = decodeInput(proposalId, z.uuid());
      if (!id.ok) return id;

      const outcome = await client
        .from(REVIEWS)
        .select("*")
        .eq("proposal_id", id.data)
        .order("id", { ascending: true })
        .limit(MAX_REVIEWS_PER_PROPOSAL);

      return decodeRows(outcome, reviewFromRow);
    },

    async review(input) {
      const parsed = decodeInput(input, reviewInputSchema);
      if (!parsed.ok) return parsed;

      const outcome = await client.rpc("record_proposal_review", {
        p_proposal_id: parsed.data.proposalId,
        p_action: parsed.data.action,
        p_new_priority: parsed.data.newPriority,
        p_comment: parsed.data.comment,
        p_operator_id_hash: parsed.data.operatorIdHash,
      });

      return decodeRow(outcome, reviewOutcomeSchema);
    },

    async findPullRequestForBranch(repository, branch) {
      const parsed = decodeInput(
        { repository, branch },
        z.strictObject({
          repository: z.string().min(1).max(200),
          branch: z.string().min(1).max(200),
        }),
      );
      if (!parsed.ok) return parsed;

      const outcome = await client
        .from(PULL_REQUESTS)
        .select("*")
        .eq("repository", parsed.data.repository)
        .eq("branch", parsed.data.branch)
        .limit(1);

      const rows = decodeRows(outcome, pullRequestFromRow);
      if (!rows.ok) return rows;

      return ok(rows.data[0] ?? null);
    },

    async savePullRequest(input) {
      const parsed = decodeInput(input, pullRequestInputSchema);
      if (!parsed.ok) return parsed;

      const outcome = await client
        .from(PULL_REQUESTS)
        .upsert(
          {
            proposal_id: parsed.data.proposalId,
            repository: parsed.data.repository,
            branch: parsed.data.branch,
            pr_number: parsed.data.prNumber,
            url: parsed.data.url,
          },
          // Upsert rather than insert, because the branch is the identity: a
          // worker that pushed and died before recording the pull request
          // finds this row waiting on retry instead of colliding with it.
          { onConflict: "repository,branch" },
        )
        .select("*")
        .single();

      return decodeRow(outcome, pullRequestFromRow);
    },

    async recordCodeChange(input) {
      const parsed = decodeInput(input, codeChangeInputSchema);
      if (!parsed.ok) return parsed;

      const outcome = await client.from(CODE_CHANGES).insert({
        plan_id: parsed.data.planId,
        path: parsed.data.path,
        edit_count: parsed.data.editCount,
        bytes_before: parsed.data.bytesBefore,
        bytes_after: parsed.data.bytesAfter,
        applied: parsed.data.applied,
        rejected_reason: parsed.data.rejectedReason,
      });

      if (outcome.error) return fail(mapDatabaseError(outcome.error));

      return ok(undefined);
    },

    async deleteRun(runId) {
      const id = decodeInput(runId, z.uuid());
      if (!id.ok) return id;

      const outcome = await client
        .from(RUNS)
        .delete()
        .eq("id", id.data)
        .in("status", ["failed", "rejected"]);

      if (outcome.error) return fail(mapDatabaseError(outcome.error));

      return ok(undefined);
    },

    async board(limit) {
      const parsed = decodeInput(limit, z.number().int().min(1).max(200));
      if (!parsed.ok) return parsed;

      const outcome = await client.rpc("product_ops_dashboard", {
        p_limit: parsed.data,
      });

      return decodeRow(outcome, productOpsBoardSchema);
    },

    async touchRun(runId) {
      const id = decodeInput(runId, z.uuid());
      if (!id.ok) return id;

      const outcome = await client.rpc("touch_product_ops_run", {
        p_run_id: id.data,
      });
      if (outcome.error) return fail(mapDatabaseError(outcome.error));

      return ok(undefined);
    },

    async putCheckpoint(checkpoint) {
      const parsed = decodeInput(checkpoint, checkpointRowSchema);
      if (!parsed.ok) return parsed;

      // An upsert on the primary key: the saver may write the same checkpoint
      // twice on a retry, and the second write is the same checkpoint.
      const outcome = await client
        .from(CHECKPOINTS)
        .upsert(checkpointToRow(parsed.data), {
          onConflict: "thread_id,checkpoint_ns,checkpoint_id",
        });
      if (outcome.error) return fail(mapDatabaseError(outcome.error));

      return ok(undefined);
    },

    async getCheckpoint(input) {
      const parsed = decodeInput(
        input,
        checkpointKeySchema.partial({ checkpointId: true }),
      );
      if (!parsed.ok) return parsed;

      let query = client
        .from(CHECKPOINTS)
        .select("*")
        .eq("thread_id", parsed.data.threadId)
        .eq("checkpoint_ns", parsed.data.checkpointNs);
      if (parsed.data.checkpointId !== undefined) {
        query = query.eq("checkpoint_id", parsed.data.checkpointId);
      }

      // Checkpoint ids are uuid6, so lexical order is time order; the latest
      // is the largest.
      const outcome = await query
        .order("checkpoint_id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (outcome.error) return fail(mapDatabaseError(outcome.error));
      if (outcome.data === null || outcome.data === undefined) return ok(null);

      return decodeRow(outcome, checkpointFromRow);
    },

    async listCheckpoints(input) {
      const parsed = decodeInput(
        input,
        z.strictObject({
          threadId: z.uuid(),
          checkpointNs: z.string().max(200),
          before: z.string().min(1).max(200).optional(),
          limit: z.number().int().min(1).max(MAX_CHECKPOINTS_LISTED).optional(),
        }),
      );
      if (!parsed.ok) return parsed;

      let query = client
        .from(CHECKPOINTS)
        .select("*")
        .eq("thread_id", parsed.data.threadId)
        .eq("checkpoint_ns", parsed.data.checkpointNs);
      if (parsed.data.before !== undefined) {
        query = query.lt("checkpoint_id", parsed.data.before);
      }

      const outcome = await query
        .order("checkpoint_id", { ascending: false })
        .limit(parsed.data.limit ?? MAX_CHECKPOINTS_LISTED);

      return decodeRows(outcome, checkpointFromRow);
    },

    async putCheckpointWrites(input) {
      const parsed = decodeInput(
        input,
        checkpointKeySchema.extend({
          writes: z.array(checkpointWriteSchema).max(500),
        }),
      );
      if (!parsed.ok) return parsed;
      if (parsed.data.writes.length === 0) return ok(undefined);

      const outcome = await client.from(CHECKPOINT_WRITES).upsert(
        parsed.data.writes.map((write) => ({
          thread_id: parsed.data.threadId,
          checkpoint_ns: parsed.data.checkpointNs,
          checkpoint_id: parsed.data.checkpointId,
          task_id: write.taskId,
          idx: write.idx,
          channel: write.channel,
          value_type: write.valueType,
          value: write.value,
        })),
        { onConflict: "thread_id,checkpoint_ns,checkpoint_id,task_id,idx" },
      );
      if (outcome.error) return fail(mapDatabaseError(outcome.error));

      return ok(undefined);
    },

    async listCheckpointWrites(input) {
      const parsed = decodeInput(input, checkpointKeySchema);
      if (!parsed.ok) return parsed;

      const outcome = await client
        .from(CHECKPOINT_WRITES)
        .select("*")
        .eq("thread_id", parsed.data.threadId)
        .eq("checkpoint_ns", parsed.data.checkpointNs)
        .eq("checkpoint_id", parsed.data.checkpointId)
        .order("idx", { ascending: true })
        .limit(500);

      return decodeRows(outcome, checkpointWriteFromRow);
    },

    async deleteCheckpoints(threadId) {
      const id = decodeInput(threadId, z.uuid());
      if (!id.ok) return id;

      // Writes first, then checkpoints; the cascade from ai_runs covers the
      // case where the run itself is retired.
      const writes = await client.from(CHECKPOINT_WRITES).delete().eq("thread_id", id.data);
      if (writes.error) return fail(mapDatabaseError(writes.error));
      const checkpoints = await client.from(CHECKPOINTS).delete().eq("thread_id", id.data);
      if (checkpoints.error) return fail(mapDatabaseError(checkpoints.error));

      return ok(undefined);
    },
  };
}
