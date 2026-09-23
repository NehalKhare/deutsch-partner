import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { JobPayload } from "@dp/domain/jobs";
import { branchNameFor, prdPathFor } from "@dp/domain/product-ops";
import { requireEnvValue } from "@dp/env/schema";
import { createCommandRunner } from "@dp/product-ops/commands";
import { createGitHubClient } from "@dp/product-ops/github";
import { driveRunGraph } from "@dp/product-ops/graph/graph";
import { createWorkspace } from "@dp/product-ops/workspace";

import type { JobHandler } from "./types";

type Implement = Extract<JobPayload, { kind: "productops.implement" }>;

/**
 * The coding half of the workflow: plan against the checkout, write the
 * approved plan, run the project's own gate, open the pull request.
 *
 * Runs only in a process given a checkout and a repository token — the
 * "coder" queue's worker. Isolation is a throwaway git worktree outside the
 * checkout, the path allowlist in the apply layer, the command allowlist and
 * the absence of a shell, inside a container that holds nothing else. The
 * two human approvals are what actually gate it: nothing writes a file until
 * a plan is approved, and this refuses to start otherwise.
 *
 * Safe to run twice. Every stage checks for its own output first, the branch
 * name is derived from the proposal id, and the pull request is looked up on
 * the remote before one is opened.
 */
export const implementProposal: JobHandler<Implement> = async (payload, context, run) => {
  const env = context.env.app;
  const checkout = context.env.worker.REPO_CHECKOUT_PATH;
  if (!checkout) return { status: "failed", errorCode: "no_repository" };

  const token = requireEnvValue(env.GITHUB_TOKEN, "GITHUB_TOKEN");
  const repository = requireEnvValue(env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY");
  const { runs, workflow } = context;
  const logger = run.logger;

  const proposal = await runs.getProposal(payload.proposalId);
  if (!proposal.ok) return { status: "failed", errorCode: "no_proposal" };

  const plan = await runs.findPlanForProposal(payload.proposalId);
  if (!plan.ok) return { status: "retry", errorCode: "store_unavailable" };

  const loaded = await runs.getRun(proposal.data.runId);
  if (!loaded.ok) return { status: "retry", errorCode: "store_unavailable" };

  // The refusal that matters. Planning may run without an approval — that is
  // what produces the plan a person then approves — but nothing writes a file
  // until one exists.
  const approved = plan.data?.status === "approved";
  if (!approved && loaded.data.currentStage !== "code_plan") {
    logger.warn("productops.implement_refused", {
      proposalId: payload.proposalId,
      stage: loaded.data.currentStage,
    });
    return { status: "failed", errorCode: "plan_not_approved" };
  }

  const branch = branchNameFor(payload.proposalId);

  // A throwaway worktree, outside the checkout, removed at the end.
  const parent = await mkdtemp(join(tmpdir(), "product-ops-"));
  const root = resolve(parent, "worktree");
  const host = createCommandRunner({ cwd: checkout });

  // The checkout was cloned when the container started; the branch is cut
  // from what the remote has now, not from what it had then.
  await host.git("fetch", ["origin"]);

  const created = await host.git("worktree", ["add", "-b", branch, root, "origin/HEAD"]);
  if (!created.ok) {
    // Very often "branch already exists", which on a retry is the whole point.
    const adopted = await host.git("worktree", ["add", root, branch]);
    if (!adopted.ok) {
      await rm(parent, { recursive: true, force: true });
      return { status: "failed", errorCode: "worktree_failed" };
    }
  }

  try {
    // The PRD, projected next to the code the agent is about to write.
    const prd = await runs.findPrdForProposal(payload.proposalId);
    if (prd.ok && prd.data !== null) {
      const target = resolve(root, prdPathFor(payload.proposalId));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, prd.data.document, "utf8");
    }

    const workspace = createWorkspace({
      root,
      gateway: workflow.gateway,
      github: createGitHubClient({ token, repository }),
      commands: createCommandRunner({ cwd: root }),
      logger,
    });

    const outcome = await driveRunGraph({ ...workflow, workspace, logger }, loaded.data.id);

    logger.info("worker.proposal_implemented", {
      proposalId: payload.proposalId,
      runId: loaded.data.id,
      status: outcome.status,
      stage: outcome.stage,
      costEur: outcome.costEur,
    });

    if (outcome.status === "unavailable") return { status: "retry", errorCode: "store_unavailable" };
    return { status: "done", detail: { status: outcome.status, stage: outcome.stage } };
  } finally {
    await host.git("worktree", ["remove", root, "--force"]);
    await rm(parent, { recursive: true, force: true });
  }
};
