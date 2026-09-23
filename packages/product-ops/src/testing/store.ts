import { ok, repositoryError, fail } from "@dp/db/errors";
import {
  nextStage,
  priorityScoreFor,
  titleSlug,
  type CodeChangeRecord,
  type PrdRecord,
  type ProductOpsRun,
  type ProductOpsStage,
  type ProposalReview,
  type PullRequestRecord,
  type RunEvent,
  type RunStatus,
  type StoredPlan,
  type StoredProposal,
  stageOwner,
} from "@dp/domain/product-ops";
import type { ProductOpsRepository } from "../repository";
import {
  findingHash,
  type CheckpointRow,
  type CheckpointWrite,
} from "../rows";
import { contentHash } from "@dp/gateway/content-hash";

/**
 * The product-ops tables, in memory.
 *
 * Written by hand rather than mocked, because what the workflow tests need is
 * a store that behaves like the real one in the two places the orchestrator
 * depends on: the stage transition is a compare-and-set that can refuse, and
 * the idempotency keys are unique. Both are mirrored here from the migration.
 * The database's own version of these properties is tested against a real
 * engine in tests/db, so this only has to agree with it, not prove it.
 */

const uuid = (seed: number): string =>
  `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;

export interface ProductOpsStore {
  readonly repository: ProductOpsRepository;
  readonly runs: Map<string, ProductOpsRun>;
  readonly events: RunEvent[];
  readonly findings: Array<{ runId: string; hash: string; finding: unknown }>;
  readonly proposals: StoredProposal[];
  readonly reviews: ProposalReview[];
  readonly prds: PrdRecord[];
  readonly plans: StoredPlan[];
  readonly changes: CodeChangeRecord[];
  readonly pullRequests: PullRequestRecord[];
  readonly checkpoints: CheckpointRow[];
  readonly checkpointWrites: Array<CheckpointWrite & { threadId: string; checkpointNs: string; checkpointId: string }>;
  /** Fails the next call to the named method once, with the given kind. */
  breakOnce(method: keyof ProductOpsRepository, kind?: "unavailable"): void;
}

const statusForStage = (stage: ProductOpsStage): RunStatus => {
  if (stage === "human_review" || stage === "plan_review") return "awaiting_review";
  if (stage === "completed") return "completed";
  if (stage === "failed") return "failed";
  if (stage === "rejected") return "rejected";
  return "running";
};

export function createProductOpsStore(): ProductOpsStore {
  const runs = new Map<string, ProductOpsRun>();
  const events: RunEvent[] = [];
  const findings: Array<{ runId: string; hash: string; finding: unknown }> = [];
  const proposals: StoredProposal[] = [];
  const reviews: ProposalReview[] = [];
  const prds: PrdRecord[] = [];
  const plans: StoredPlan[] = [];
  const changes: CodeChangeRecord[] = [];
  const pullRequests: PullRequestRecord[] = [];
  const checkpoints: CheckpointRow[] = [];
  const checkpointWrites: Array<
    CheckpointWrite & { threadId: string; checkpointNs: string; checkpointId: string }
  > = [];
  const broken = new Set<string>();

  let sequence = 1;
  const nextId = () => uuid(sequence++);
  const now = () => new Date("2026-09-10T12:00:00.000Z");

  /** One shot at making a call fail, for the paths a happy store cannot reach. */
  const failing = (method: string) => {
    if (!broken.has(method)) return false;
    broken.delete(method);
    return true;
  };

  const repository: ProductOpsRepository = {
    async startRun(input) {
      if (failing("startRun")) return fail(repositoryError("unavailable"));

      const run: ProductOpsRun = {
        id: nextId(),
        runType: input.runType,
        status: "running",
        currentStage: "research",
        operatorIdHash: input.operatorIdHash,
        requestId: input.requestId,
        brief: input.brief,
        errorCode: null,
        startedAt: now(),
        completedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      runs.set(run.id, run);

      return ok(run);
    },

    async getRun(runId) {
      if (failing("getRun")) return fail(repositoryError("unavailable"));

      const run = runs.get(runId);

      return run ? ok(run) : fail(repositoryError("not_found"));
    },

    async advanceStage({ runId, from, to, event }) {
      if (failing("advanceStage")) return fail(repositoryError("unavailable"));

      const run = runs.get(runId);
      if (!run) return fail(repositoryError("not_found"));

      // The compare-and-set, as the database does it: a stale transition is
      // refused rather than applied, and the caller is told where the run is.
      if (run.currentStage !== from) {
        return ok({ advanced: false, stage: run.currentStage });
      }

      const { status, requestId, errorCode, ...detail } = event as Record<
        string,
        unknown
      >;
      void requestId;

      // Mirrors the migration: entering a terminal stage stamps the end and
      // keeps or sets the code; leaving one — a retry — clears both.
      const terminal = to === "completed" || to === "failed" || to === "rejected";
      runs.set(runId, {
        ...run,
        currentStage: to,
        status: statusForStage(to),
        errorCode: terminal
          ? typeof errorCode === "string"
            ? errorCode
            : run.errorCode
          : null,
        completedAt: terminal ? now() : null,
      });

      events.push({
        id: events.length + 1,
        runId,
        stage: to,
        status: (typeof status === "string" ? status : "ok") as RunEvent["status"],
        detail,
        createdAt: now(),
      });

      return ok({ advanced: true, stage: to });
    },

    async recordEvent({ runId, stage, status, detail }) {
      if (failing("recordEvent")) return fail(repositoryError("unavailable"));

      events.push({
        id: events.length + 1,
        runId,
        stage,
        status,
        detail,
        createdAt: now(),
      });

      return ok(undefined);
    },

    async listEvents(runId) {
      if (failing("listEvents")) return fail(repositoryError("unavailable"));

      return ok(events.filter((event) => event.runId === runId));
    },

    async listEventsAfter(runId, afterId) {
      if (failing("listEventsAfter")) return fail(repositoryError("unavailable"));

      return ok(events.filter((event) => event.runId === runId && event.id > afterId));
    },

    async recordFindings(runId, incoming) {
      if (failing("recordFindings")) return fail(repositoryError("unavailable"));

      for (const finding of incoming) {
        const hash = findingHash(finding);
        // unique (run_id, finding_hash), ignoring duplicates.
        if (findings.some((row) => row.runId === runId && row.hash === hash)) {
          continue;
        }
        findings.push({ runId, hash, finding });
      }

      return ok(undefined);
    },

    async listFindings(runId) {
      if (failing("listFindings")) return fail(repositoryError("unavailable"));

      return ok(
        findings
          .filter((row) => row.runId === runId)
          .map((row, index) => {
            const finding = row.finding as {
              title: string;
              sourceType: "web" | "forum" | "review" | "competitor" | "internal";
              sourceUrl?: string;
              summary: string;
              painPoints: readonly string[];
              trends: readonly string[];
              evidence: readonly { url?: string; finding: string }[];
              relevanceScore: number;
            };

            return {
              id: index + 1,
              runId,
              title: finding.title,
              sourceUrl: finding.sourceUrl ?? null,
              sourceType: finding.sourceType,
              summary: finding.summary,
              painPoints: [...finding.painPoints],
              trends: [...finding.trends],
              evidence: finding.evidence.map((item) => ({ ...item })),
              relevanceScore: finding.relevanceScore,
              findingHash: row.hash,
              createdAt: now(),
            };
          }),
      );
    },

    async saveProposal(runId, proposal) {
      if (failing("saveProposal")) return fail(repositoryError("unavailable"));

      const slug = titleSlug(proposal.title);
      // unique (run_id, title_slug): a re-run of synthesis collides here.
      if (
        proposals.some(
          (stored) => stored.runId === runId && stored.titleSlug === slug,
        )
      ) {
        return fail(repositoryError("conflict"));
      }

      const stored: StoredProposal = {
        id: nextId(),
        runId,
        title: proposal.title,
        titleSlug: slug,
        problemStatement: proposal.problemStatement,
        marketJustification: proposal.marketJustification,
        targetUsers: proposal.targetUsers,
        userImpact: proposal.userImpact,
        proposedSolution: proposal.proposedSolution,
        complexity: proposal.complexity,
        priorityScore: priorityScoreFor(proposal.impact, proposal.complexity),
        implementationOutline: [...proposal.implementationOutline],
        affectedAreas: [...proposal.affectedAreas],
        supportingResearch: proposal.evidence.map((item) => ({ ...item })),
        internalContext: [],
        status: "pending_review",
        createdAt: now(),
        updatedAt: now(),
      };
      proposals.push(stored);

      return ok(stored);
    },

    async getProposal(proposalId) {
      if (failing("getProposal")) return fail(repositoryError("unavailable"));

      const found = proposals.find((proposal) => proposal.id === proposalId);

      return found ? ok(found) : fail(repositoryError("not_found"));
    },

    async findProposalForRun(runId) {
      if (failing("findProposalForRun")) {
        return fail(repositoryError("unavailable"));
      }

      return ok(proposals.find((proposal) => proposal.runId === runId) ?? null);
    },

    async listProposals(limit) {
      if (failing("listProposals")) return fail(repositoryError("unavailable"));

      return ok([...proposals].reverse().slice(0, limit));
    },

    async setProposalStatus(proposalId, status) {
      if (failing("setProposalStatus")) {
        return fail(repositoryError("unavailable"));
      }

      const index = proposals.findIndex((proposal) => proposal.id === proposalId);
      if (index === -1) return fail(repositoryError("not_found"));

      proposals[index] = { ...proposals[index], status, updatedAt: now() };

      return ok(undefined);
    },

    async savePrd({ proposalId, document, sections, filePath }) {
      if (failing("savePrd")) return fail(repositoryError("unavailable"));

      const record: PrdRecord = {
        id: nextId(),
        proposalId,
        document,
        documentHash: contentHash(document),
        sections,
        filePath,
        createdAt: now(),
        updatedAt: now(),
      };

      // proposal_id is unique, so this is an upsert rather than a second row.
      const index = prds.findIndex((prd) => prd.proposalId === proposalId);
      if (index === -1) prds.push(record);
      else prds[index] = { ...record, id: prds[index].id };

      return ok(record);
    },

    async findPrdForProposal(proposalId) {
      if (failing("findPrdForProposal")) {
        return fail(repositoryError("unavailable"));
      }

      return ok(prds.find((prd) => prd.proposalId === proposalId) ?? null);
    },

    async savePlan(proposalId, plan) {
      if (failing("savePlan")) return fail(repositoryError("unavailable"));

      const index = plans.findIndex((stored) => stored.proposalId === proposalId);
      const record: StoredPlan = {
        id: index === -1 ? nextId() : plans[index].id,
        proposalId,
        plan,
        // An upsert writes the plan's own columns and leaves the rest alone.
        breakdown: index === -1 ? null : plans[index].breakdown,
        // An upsert leaves an approval alone; nothing here re-approves a plan.
        status: index === -1 ? "pending_review" : plans[index].status,
        createdAt: now(),
        updatedAt: now(),
      };

      if (index === -1) plans.push(record);
      else plans[index] = record;

      return ok(record);
    },

    async saveBreakdown(planId, breakdown) {
      if (failing("saveBreakdown")) return fail(repositoryError("unavailable"));

      const index = plans.findIndex((stored) => stored.id === planId);
      if (index === -1) return fail(repositoryError("not_found"));

      plans[index] = { ...plans[index], breakdown, updatedAt: now() };

      return ok(plans[index]);
    },

    async findPlanForProposal(proposalId) {
      if (failing("findPlanForProposal")) {
        return fail(repositoryError("unavailable"));
      }

      return ok(plans.find((plan) => plan.proposalId === proposalId) ?? null);
    },

    async listCodeChanges(planId) {
      if (failing("listCodeChanges")) return fail(repositoryError("unavailable"));

      return ok(changes.filter((change) => change.planId === planId));
    },

    async listReviews(proposalId) {
      if (failing("listReviews")) return fail(repositoryError("unavailable"));

      return ok(reviews.filter((review) => review.proposalId === proposalId));
    },

    async review({ proposalId, action, newPriority, comment, operatorIdHash }) {
      if (failing("review")) return fail(repositoryError("unavailable"));

      const index = proposals.findIndex((proposal) => proposal.id === proposalId);
      if (index === -1) return fail(repositoryError("not_found"));

      const previous = proposals[index];
      const status =
        action === "approve"
          ? "approved"
          : action === "reject"
            ? "rejected"
            : action === "approve_plan"
              ? "coding"
              : previous.status;
      const priorityScore =
        action === "reprioritise" && newPriority !== null
          ? newPriority
          : previous.priorityScore;

      if (action === "approve_plan") {
        const planIndex = plans.findIndex(
          (plan) => plan.proposalId === proposalId,
        );
        // The database refuses a plan approval with no plan to approve, so
        // that a run cannot reach 'coding' with no allowlist behind it.
        if (planIndex === -1) return fail(repositoryError("not_found"));
        plans[planIndex] = { ...plans[planIndex], status: "approved" };
      }

      proposals[index] = { ...previous, status, priorityScore, updatedAt: now() };

      reviews.push({
        id: reviews.length + 1,
        proposalId,
        action,
        previousPriority: previous.priorityScore,
        newPriority: action === "reprioritise" ? newPriority : null,
        comment,
        operatorIdHash,
        createdAt: now(),
      });

      return ok({ status, priorityScore });
    },

    async findPullRequestForBranch(repositoryName, branch) {
      if (failing("findPullRequestForBranch")) {
        return fail(repositoryError("unavailable"));
      }

      return ok(
        pullRequests.find(
          (record) =>
            record.repository === repositoryName && record.branch === branch,
        ) ?? null,
      );
    },

    async savePullRequest({ proposalId, repository: name, branch, prNumber, url }) {
      if (failing("savePullRequest")) {
        return fail(repositoryError("unavailable"));
      }

      const index = pullRequests.findIndex(
        (record) => record.repository === name && record.branch === branch,
      );
      const record: PullRequestRecord = {
        id: index === -1 ? nextId() : pullRequests[index].id,
        proposalId,
        provider: "github",
        repository: name,
        branch,
        prNumber,
        url,
        status: "open",
        createdAt: now(),
        updatedAt: now(),
      };

      if (index === -1) pullRequests.push(record);
      else pullRequests[index] = record;

      return ok(record);
    },

    async recordCodeChange(input) {
      if (failing("recordCodeChange")) {
        return fail(repositoryError("unavailable"));
      }

      changes.push({
        id: changes.length + 1,
        planId: input.planId,
        path: input.path,
        editCount: input.editCount,
        bytesBefore: input.bytesBefore,
        bytesAfter: input.bytesAfter,
        applied: input.applied,
        rejectedReason: input.rejectedReason,
        createdAt: now(),
      });

      return ok(undefined);
    },

    async pruneCheckpoints() {
      if (failing("pruneCheckpoints")) return fail(repositoryError("unavailable"));
      return ok(0);
    },

    async listStalledRuns(input) {
      if (failing("listStalledRuns")) return fail(repositoryError("unavailable"));

      const before = now().getTime() - input.quietForMs;
      return ok(
        [...runs.values()]
          .filter(
            (run) =>
              run.status === "running" &&
              stageOwner(run.currentStage) === "server" &&
              run.updatedAt.getTime() < before,
          )
          .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
          .slice(0, input.limit),
      );
    },

    async touchRun(runId) {
      if (failing("touchRun")) return fail(repositoryError("unavailable"));

      const run = runs.get(runId);
      if (!run) return fail(repositoryError("not_found"));
      runs.set(runId, { ...run, updatedAt: new Date(run.updatedAt.getTime() + 1) });

      return ok(undefined);
    },

    async putCheckpoint(checkpoint) {
      if (failing("putCheckpoint")) return fail(repositoryError("unavailable"));

      const index = checkpoints.findIndex(
        (row) =>
          row.threadId === checkpoint.threadId &&
          row.checkpointNs === checkpoint.checkpointNs &&
          row.checkpointId === checkpoint.checkpointId,
      );
      if (index === -1) checkpoints.push(checkpoint);
      else checkpoints[index] = checkpoint;

      return ok(undefined);
    },

    async getCheckpoint({ threadId, checkpointNs, checkpointId }) {
      if (failing("getCheckpoint")) return fail(repositoryError("unavailable"));

      const matching = checkpoints
        .filter(
          (row) =>
            row.threadId === threadId &&
            row.checkpointNs === checkpointNs &&
            (checkpointId === undefined || row.checkpointId === checkpointId),
        )
        .toSorted((a, b) => b.checkpointId.localeCompare(a.checkpointId));

      return ok(matching[0] ?? null);
    },

    async listCheckpoints({ threadId, checkpointNs, before, limit }) {
      if (failing("listCheckpoints")) return fail(repositoryError("unavailable"));

      return ok(
        checkpoints
          .filter(
            (row) =>
              row.threadId === threadId &&
              row.checkpointNs === checkpointNs &&
              (before === undefined || row.checkpointId < before),
          )
          .toSorted((a, b) => b.checkpointId.localeCompare(a.checkpointId))
          .slice(0, limit ?? 50),
      );
    },

    async putCheckpointWrites({ threadId, checkpointNs, checkpointId, writes }) {
      if (failing("putCheckpointWrites")) {
        return fail(repositoryError("unavailable"));
      }

      for (const write of writes) {
        const index = checkpointWrites.findIndex(
          (row) =>
            row.threadId === threadId &&
            row.checkpointNs === checkpointNs &&
            row.checkpointId === checkpointId &&
            row.taskId === write.taskId &&
            row.idx === write.idx,
        );
        const row = { ...write, threadId, checkpointNs, checkpointId };
        if (index === -1) checkpointWrites.push(row);
        else checkpointWrites[index] = row;
      }

      return ok(undefined);
    },

    async listCheckpointWrites({ threadId, checkpointNs, checkpointId }) {
      if (failing("listCheckpointWrites")) {
        return fail(repositoryError("unavailable"));
      }

      return ok(
        checkpointWrites
          .filter(
            (row) =>
              row.threadId === threadId &&
              row.checkpointNs === checkpointNs &&
              row.checkpointId === checkpointId,
          )
          .toSorted((a, b) => a.idx - b.idx)
          .map(({ taskId, idx, channel, valueType, value }) => ({
            taskId,
            idx,
            channel,
            valueType,
            value,
          })),
      );
    },

    async deleteCheckpoints(threadId) {
      if (failing("deleteCheckpoints")) return fail(repositoryError("unavailable"));

      for (let i = checkpoints.length - 1; i >= 0; i -= 1) {
        if (checkpoints[i].threadId === threadId) checkpoints.splice(i, 1);
      }
      for (let i = checkpointWrites.length - 1; i >= 0; i -= 1) {
        if (checkpointWrites[i].threadId === threadId) checkpointWrites.splice(i, 1);
      }

      return ok(undefined);
    },

    async deleteRun(runId) {
      if (failing("deleteRun")) return fail(repositoryError("unavailable"));

      const run = runs.get(runId);
      if (run && (run.status === "failed" || run.status === "rejected")) {
        runs.delete(runId);
        for (let index = events.length - 1; index >= 0; index -= 1) {
          if (events[index].runId === runId) events.splice(index, 1);
        }
      }

      return ok(undefined);
    },

    async board(limit) {
      if (failing("board")) return fail(repositoryError("unavailable"));

      return ok({
        generatedAt: now(),
        proposals: proposals.slice(0, limit).map((proposal) => ({
          id: proposal.id,
          runId: proposal.runId,
          title: proposal.title,
          titleSlug: proposal.titleSlug,
          status: proposal.status,
          complexity: proposal.complexity,
          priorityScore: proposal.priorityScore,
          createdAt: proposal.createdAt,
          updatedAt: proposal.updatedAt,
          runStage: runs.get(proposal.runId)?.currentStage ?? "research",
          runStatus: runs.get(proposal.runId)?.status ?? "running",
          reviewCount: 0,
          hasPrd: prds.some((prd) => prd.proposalId === proposal.id),
          hasPlan: plans.some((plan) => plan.proposalId === proposal.id),
          pullRequest:
            pullRequests
              .filter((record) => record.proposalId === proposal.id)
              .map((record) => ({
                number: record.prNumber,
                url: record.url,
                status: record.status,
              }))[0] ?? null,
        })),
        runs: [...runs.values()].slice(0, limit).map((run) => ({
          id: run.id,
          runType: run.runType,
          status: run.status,
          stage: run.currentStage,
          errorCode: run.errorCode,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          updatedAt: run.updatedAt,
        })),
      });
    },
  };

  return {
    repository,
    runs,
    events,
    findings,
    proposals,
    reviews,
    prds,
    plans,
    changes,
    pullRequests,
    checkpoints,
    checkpointWrites,
    breakOnce(method) {
      broken.add(method);
    },
  };
}

/** Puts a run at a given stage without walking the workflow to get there. */
export async function seedRunAt(
  store: ProductOpsStore,
  stage: ProductOpsStage,
  over: { brief?: string | null } = {},
): Promise<string> {
  const started = await store.repository.startRun({
    runType: "manual_market_scan",
    operatorIdHash: "hash-operator",
    requestId: null,
    brief: over.brief === undefined ? "healthcare German" : over.brief,
  });

  if (!started.ok) throw new Error("the store refused to start a run");

  const run = started.data;
  store.runs.set(run.id, {
    ...run,
    currentStage: stage,
    status:
      stage === "human_review" || stage === "plan_review"
        ? "awaiting_review"
        : run.status,
  });

  return run.id;
}

/** Kept beside the store so a test asserting a transition can name it. */
export { nextStage };
