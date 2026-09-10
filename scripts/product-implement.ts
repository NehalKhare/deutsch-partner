import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

import { branchNameFor, prdPathFor } from "../domain/product-ops";
import { createGateway } from "../lib/ai/gateway/factory";
import { createTaskModelLadder } from "../lib/ai/gateway/langchain-model";
import { parseEnv, requireEnvValue } from "../lib/env/schema";
import { createGitHubClient } from "../lib/github/client";
import { createLogger } from "../lib/observability/logger";
import { createCommandRunner } from "../lib/product-ops/commands";
import { createWorkspace } from "../lib/product-ops/workspace";
import { driveRunGraph } from "../lib/product-ops/graph/graph";
import type { AdvanceResult } from "../lib/product-ops/workflow";
import { createProductOpsRepository } from "../repositories/product-ops-repository";
import { createUsageAccounting } from "../repositories/usage-repository";
import type { DatabaseClient } from "../repositories/types";

/**
 * The product-ops coding worker.
 *
 * Run with: pnpm product:implement <proposal-id>
 *
 * This is the half of the workflow that needs a working tree, and it is a CLI
 * script rather than part of the server for exactly that reason. The four
 * stages it runs — planning against the repository, writing the approved plan,
 * running the project's own gate, and opening the pull request — all touch a
 * checkout, and the server has none.
 *
 * Isolation is a throwaway git worktree, the path allowlist in
 * lib/product-ops/apply.ts, and the absence of a shell. That is weaker than a
 * container and it is stated rather than hidden: a container is the documented
 * next step, and the controls that actually hold in the meantime are the
 * allowlist, the command allowlist and the two human approvals this script
 * refuses to proceed without.
 *
 * It is safe to run twice. Every stage checks for its own output first, the
 * branch name is derived from the proposal id, and the pull request is looked
 * up on the remote before one is opened.
 */

function say(message = ""): void {
  process.stdout.write(`${message}\n`);
}

function abort(message: string): never {
  process.stderr.write(`\n  ${message}\n\n`);
  process.exit(1);
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function report(result: AdvanceResult): void {
  const detail = result.detail === null ? "" : ` — ${result.detail}`;
  say(`  ${result.status.padEnd(11)} ${result.stage ?? "?"}${detail}`);
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const env = parseEnv(process.env);

  const proposalId = process.argv[2];
  if (!proposalId || !UUID.test(proposalId)) {
    abort("Usage: pnpm product:implement <proposal-id> [--keep]");
  }

  const url = requireEnvValue(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  const secretKey = requireEnvValue(env.SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY");
  const token = requireEnvValue(env.GITHUB_TOKEN, "GITHUB_TOKEN");
  const repository = requireEnvValue(env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY");

  const logger = createLogger({
    base: { service: "product-ops-worker", environment: env.NODE_ENV },
  });

  // The secret key, because every product-ops table has RLS enabled with no
  // policy at all. There is no other way in, and that is deliberate.
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as DatabaseClient;

  const runs = createProductOpsRepository(client);

  const proposal = await runs.getProposal(proposalId);
  if (!proposal.ok) abort(`No proposal ${proposalId}.`);

  const plan = await runs.findPlanForProposal(proposalId);
  if (!plan.ok) abort("The plan could not be read.");

  // The refusal that matters. Planning may run without an approval — that is
  // what produces the plan a person then approves — but nothing writes a file
  // until one exists.
  const approved = plan.data?.status === "approved";
  const run = await runs.getRun(proposal.data.runId);
  if (!run.ok) abort("The run could not be read.");

  if (!approved && run.data.currentStage !== "code_plan") {
    abort(
      `This run is at "${run.data.currentStage}" and its plan is not approved. ` +
        `Approve it at /operations/product/${proposalId} first.`,
    );
  }

  const branch = branchNameFor(proposalId);

  say(`\n  Proposal  ${proposal.data.title}`);
  say(`  Run       ${run.data.id} at ${run.data.currentStage}`);
  say(`  Branch    ${branch}`);

  // A throwaway worktree. Outside the repository, so a run that dies leaves
  // nothing in the tree somebody is working in, and removed at the end unless
  // --keep is passed for a look at what the agent actually wrote.
  const parent = await mkdtemp(join(tmpdir(), "product-ops-"));
  const root = resolve(parent, "worktree");
  const repositoryRoot = process.cwd();

  const host = createCommandRunner({ cwd: repositoryRoot });
  const created = await host.git("worktree", ["add", "-b", branch, root, "HEAD"]);
  if (!created.ok) {
    // Very often "branch already exists", which on a retry is the whole point.
    const adopted = await host.git("worktree", ["add", root, branch]);
    if (!adopted.ok) {
      await rm(parent, { recursive: true, force: true });
      abort("Could not create a worktree for this branch.");
    }
  }

  say(`  Worktree  ${root}\n`);

  try {
    // The PRD, projected next to the code the agent is about to write. The row
    // remains the source of truth; this is for whoever reads the branch.
    const prd = await runs.findPrdForProposal(proposalId);
    if (prd.ok && prd.data !== null) {
      const target = resolve(root, prdPathFor(proposalId));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, prd.data.document, "utf8");
    }

    const workspace = createWorkspace({
      root,
      gateway: createGateway(client, env, logger),
      github: createGitHubClient({ token, repository }),
      commands: createCommandRunner({ cwd: root }),
      logger,
    });

    const accounting = createUsageAccounting(client, logger);
    const deps = {
      runs,
      gateway: createGateway(client, env, logger),
      // The planner and the coder run as tool-using agents on the tiers the
      // task table assigns, with every call on the same ledger.
      models: (context: Parameters<typeof createTaskModelLadder>[1]) =>
        createTaskModelLadder({ env, accounting, logger }, context),
      workspace,
      logger,
    };

    // The same graph the server drives, here with a working tree, so the four
    // worker stages are runnable. It stops at the next human gate, a terminal
    // state, a failure, or a race with another worker.
    const outcome = await driveRunGraph(deps, run.data.id);
    report(outcome);

    const finished = await runs.getRun(run.data.id);
    if (finished.ok) {
      say(`\n  Run is now at ${finished.data.currentStage}.`);
      if (finished.data.currentStage === "plan_review") {
        say(`  Approve the plan at /operations/product/${proposalId}, then run this again.`);
      }
    }

    // Non-zero on a failure, so a scripted invocation is visibly broken rather
    // than quietly partial. The branch is left behind either way.
    if (outcome.status === "failed" || outcome.status === "unavailable") {
      process.exitCode = 1;
    }
  } finally {
    if (flag("keep")) {
      say(`\n  Worktree kept at ${root}\n`);
    } else {
      await host.git("worktree", ["remove", root, "--force"]);
      await rm(parent, { recursive: true, force: true });
      say();
    }
  }
}

main().catch((error: unknown) => {
  abort(error instanceof Error ? error.message : String(error));
});
