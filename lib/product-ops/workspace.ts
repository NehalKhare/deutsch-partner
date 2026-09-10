import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import {
  isDeniedPath,
  type ImplementationPlan,
  type StoredProposal,
} from "@/domain/product-ops";
import type { CallContext, ModelGateway } from "@/lib/ai/gateway/gateway";
import { wrapUntrusted } from "@/lib/ai/prompts/delimiters";
import type { GitHubClient } from "@/lib/github/client";
import { nullLogger, type Logger } from "@/lib/observability/logger";
import {
  runCoderAgent,
  type AgentDeps,
  type RepositoryBrowser,
} from "@/lib/product-ops/agents";
import { createApplier, type Applier } from "@/lib/product-ops/apply";
import { proposeCodeEdit } from "@/lib/product-ops/coder";
import {
  VERIFY_STEPS,
  type CommandRunner,
  type VerifyStep,
} from "@/lib/product-ops/commands";
import type { RepositoryFile } from "@/lib/product-ops/planner";
import type {
  AppliedChange,
  ImplementationReport,
  PublishReport,
  VerificationReport,
  Workspace,
} from "@/lib/product-ops/workflow";

/**
 * The working tree, as the orchestrator's port sees it.
 *
 * This is the half of the workflow that only exists where the repository is
 * checked out, and it is deliberately assembled from three narrow pieces
 * rather than written as one: the applier decides whether a write is allowed,
 * the command runner decides whether a process may start, and the GitHub
 * client is five HTTP calls. None of them can be reached from the model side
 * of the boundary, and none of them takes an argument the model chose.
 *
 * What is trusted and what is not, stated plainly. The repository's own source
 * is untrusted and is fenced, because a comment in a file can say "ignore all
 * previous instructions" as easily as a web page can. A failing build's output
 * is untrusted for the same reason — it quotes those files back. The PRD and
 * the plan are model-written and human-approved, and are treated as trusted
 * input by policy; the controls that hold regardless are the path allowlist,
 * the deny-list and the two gates, which is the honest way round.
 */

/** How many files one implementation run may touch. A bound on cost. */
export const MAX_FILES_PER_RUN = 6;

/** How many paths the planner is shown. Enough to orient, not a whole tree. */
const MAX_TREE_PATHS = 400;

/** How much of a long document the planner is shown. */
const MAX_DOCUMENT_CHARS = 4_000;

/** Directories that are not this repository's source. */
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".ai",
  "coverage",
  "dist",
  "build",
  "test-results",
  "playwright-report",
]);

/** The label the pull request carries, so these are findable as a class. */
const PULL_REQUEST_LABEL = "product-ops";

/** How many files an exact-text search reads before it stops. A bound on I/O. */
const MAX_SEARCHED_FILES = 400;

/** How many hits a search returns. The tool caps again above this. */
const MAX_SEARCH_HITS = 50;

/** How many edits the coder may propose in one implementation pass. */
const MAX_EDITS_PER_RUN = 20;

/** And in the one repair pass a failing gate buys. */
const MAX_EDITS_PER_REPAIR = 4;

export interface WorkspaceOptions {
  /** The worktree root. Every path is resolved against it. */
  readonly root: string;
  readonly gateway: ModelGateway;
  readonly github: GitHubClient;
  readonly commands: CommandRunner;
  readonly logger?: Logger;
  /** Test seam. The real one walks the worktree. */
  readonly tree?: () => Promise<readonly string[]>;
}

/** Reads a file inside the root, or null. The paths here are literals. */
async function readInside(root: string, path: string): Promise<string | null> {
  const absolute = resolve(root, path);
  if (absolute !== root && !absolute.startsWith(root + sep)) return null;

  try {
    return await readFile(absolute, "utf8");
  } catch {
    return null;
  }
}

/**
 * The repository's paths, breadth-first and bounded.
 *
 * A listing rather than contents. What a planner needs to decide which files a
 * change touches is the shape of the repository, and a listing of four hundred
 * paths costs a fraction of what four files cost.
 */
async function walk(root: string): Promise<readonly string[]> {
  const found: string[] = [];
  const queue: string[] = [root];

  while (queue.length > 0 && found.length < MAX_TREE_PATHS) {
    const directory = queue.shift();
    if (directory === undefined) break;

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (found.length >= MAX_TREE_PATHS) break;
      if (entry.name.startsWith(".") && entry.name !== ".env.example") {
        if (entry.isDirectory()) continue;
      }

      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) queue.push(full);
        continue;
      }
      if (!/\.(ts|tsx|sql|md|json|css)$/.test(entry.name)) continue;

      found.push(relative(root, full));
    }
  }

  return found.sort();
}

/** Which files the plan says to touch, tests first. */
function plannedTargets(plan: ImplementationPlan): readonly string[] {
  // Tests before code, per the build spec. It is also the order in which a
  // partial run leaves the most useful branch behind.
  const ordered = [...plan.tests, ...plan.filesToModify, ...plan.filesToCreate];

  return [...new Set(ordered)];
}

/**
 * The first planned path a failing build's output names.
 *
 * Deterministic, and chosen here rather than by asking a model which file to
 * fix: the output is untrusted text, and letting it select the write target
 * would be letting it past the allowlist by suggestion.
 */
export function firstPlannedPathIn(
  output: string,
  plan: ImplementationPlan,
): string | null {
  const candidates = plannedTargets(plan);
  let best: { path: string; at: number } | null = null;

  for (const path of candidates) {
    const at = output.indexOf(path);
    if (at === -1) continue;
    if (best === null || at < best.at) best = { path, at };
  }

  return best?.path ?? null;
}

function refusedChange(path: string, reason: string): AppliedChange {
  return {
    path,
    editCount: 0,
    bytesBefore: null,
    bytesAfter: null,
    applied: false,
    rejectedReason: reason,
  };
}

/** The instruction for one file. Bounded, so a long PRD cannot blow the ceiling. */
function instructionFor(input: {
  readonly prd: string;
  readonly plan: ImplementationPlan;
  readonly path: string;
  readonly exists: boolean;
}): string {
  const lines = [
    input.exists
      ? `Change one existing file: ${input.path}.`
      : `Create one new file: ${input.path}.`,
    "",
    "The approved plan names these files and no others:",
    ...plannedTargets(input.plan).map((path) => `- ${path}`),
    "",
    "What is being built:",
    input.prd.slice(0, MAX_DOCUMENT_CHARS),
  ];

  return lines.join("\n");
}

/**
 * The coder agent's brief for a whole implementation pass.
 *
 * Trusted framing: the plan a person approved and the PRD, bounded. The
 * agent reads files itself and proposes edits one file at a time; what this
 * tells it is which files those may be, and in what order the build spec
 * wants them — tests first.
 */
function implementationBrief(input: {
  readonly prd: string;
  readonly plan: ImplementationPlan;
}): string {
  return [
    "Implement the approved plan. Work through these files, tests first, one propose_edit per file:",
    ...plannedTargets(input.plan).map((path) => `- ${path}`),
    "",
    "What is being built:",
    input.prd.slice(0, MAX_DOCUMENT_CHARS),
  ].join("\n");
}

/**
 * The coder agent's brief for the repair pass.
 *
 * The gate's output is external content — it quotes source files, including
 * the ones the agent just wrote — and rides inside a fence. The trusted part
 * is the instruction around it, and the one path the fix may touch first.
 */
function repairBrief(input: {
  readonly step: VerifyStep;
  readonly output: string;
  readonly target: string;
  readonly plan: ImplementationPlan;
}): string {
  return [
    `The project's ${input.step} gate failed after the implementation. Fix it with the smallest change, starting with ${input.target}.`,
    "The approved plan names these files and no others:",
    ...plannedTargets(input.plan).map((path) => `- ${path}`),
    "",
    wrapUntrusted("command_output", input.output),
  ].join("\n");
}

function pullRequestBody(proposal: StoredProposal, prd: string): string {
  return [
    `Opened by the product-ops worker for proposal \`${proposal.id}\`.`,
    "",
    "**Every line here was written by a model and applied through a path",
    "allowlist a person approved. Review it as you would any other change,",
    "and rather more carefully.**",
    "",
    "## Problem",
    "",
    proposal.problemStatement,
    "",
    "## PRD",
    "",
    prd.slice(0, 20_000),
  ].join("\n");
}

export function createWorkspace(options: WorkspaceOptions): Workspace {
  const logger = options.logger ?? nullLogger;
  const tree = options.tree ?? (() => walk(options.root));
  const specialist = { gateway: options.gateway, logger };

  /**
   * One file, proposed and then validated.
   *
   * The model's reply never reaches the filesystem: the applier is what
   * writes, and it checks the path against the plan, the deny-list and the
   * worktree before it does.
   */
  async function editOne(
    applier: Applier,
    input: {
      readonly path: string;
      readonly prd: string;
      readonly plan: ImplementationPlan;
      readonly context: CallContext;
      readonly notes?: readonly { content: string; source: string }[];
    },
  ): Promise<{ change: AppliedChange; costEur: number }> {
    const source = await applier.read(input.path);

    const proposed = await proposeCodeEdit(specialist, {
      instruction: instructionFor({
        prd: input.prd,
        plan: input.plan,
        path: input.path,
        exists: source !== null,
      }),
      path: input.path,
      source,
      notes: input.notes,
      context: input.context,
    });

    if (proposed.status !== "ok") {
      return {
        change: refusedChange(input.path, proposed.reason),
        costEur: proposed.costEur,
      };
    }

    const applied = await applier.apply(proposed.value);

    if (!applied.applied) {
      // At warn, because a refused write is the validation layer doing its
      // job and also the thing an operator most wants to know about.
      logger.warn("productops.write_refused", {
        path: applied.path,
        reason: applied.rejectedReason,
      });
    }

    return { change: applied, costEur: proposed.costEur };
  }

  /**
   * The worktree as the planner agent sees it.
   *
   * Listings from the same bounded walk the fallback planner gets; reads
   * inside the root only; and search as an in-process scan for an exact
   * text rather than a grep, so no argument of the model's choosing is ever
   * passed to a process. The deny-list is applied here too, under the tools
   * that already apply it: a planner never reads a secret.
   */
  const browser = (): RepositoryBrowser => ({
    async list(prefix) {
      const paths = await tree();
      const wanted = prefix.length === 0 ? "" : `${prefix}/`;

      return paths.filter(
        (path) => !isDeniedPath(path) && (wanted === "" || path.startsWith(wanted)),
      );
    },

    async read(path) {
      if (isDeniedPath(path)) return null;
      return readInside(options.root, path);
    },

    async search(text) {
      const hits: { path: string; line: number; text: string }[] = [];
      const paths = (await tree()).filter((path) => !isDeniedPath(path));

      for (const path of paths.slice(0, MAX_SEARCHED_FILES)) {
        if (hits.length >= MAX_SEARCH_HITS) break;
        const content = await readInside(options.root, path);
        if (content === null || !content.includes(text)) continue;

        const lines = content.split("\n");
        for (const [index, line] of lines.entries()) {
          if (!line.includes(text)) continue;
          hits.push({ path, line: index + 1, text: line.trim().slice(0, 200) });
          if (hits.length >= MAX_SEARCH_HITS) break;
        }
      }

      return hits;
    },
  });

  /**
   * A whole implementation pass by the coder agent.
   *
   * The agent reads and edits through the applier, so every write is checked
   * against the approved plan, the deny-list and the worktree exactly as the
   * per-file path is. What comes back is the applier's record of what was
   * attempted, not the model's account.
   */
  async function editWithAgent(
    agents: AgentDeps,
    applier: Applier,
    input: {
      readonly instruction: string;
      readonly context: CallContext;
      readonly maxEdits: number;
    },
  ): Promise<{ changes: readonly AppliedChange[]; costEur: number; failed: string | null }> {
    const outcome = await runCoderAgent(agents, {
      instruction: input.instruction,
      applier,
      context: input.context,
      maxEdits: input.maxEdits,
      onChange: (change) => {
        if (!change.applied) {
          logger.warn("productops.write_refused", {
            path: change.path,
            reason: change.rejectedReason,
          });
        }
      },
    });

    if (outcome.status !== "ok") {
      return { changes: [], costEur: outcome.costEur, failed: outcome.reason };
    }

    return { changes: outcome.value.changes, costEur: outcome.costEur, failed: null };
  }

  return {
    repository: options.github.repository,
    browser,

    async plannerContext() {
      const paths = await tree();
      const agents = await readInside(options.root, "AGENTS.md");
      const architecture = await readInside(
        options.root,
        join("docs", "architecture.md"),
      );

      const files: RepositoryFile[] = [
        { path: "repository tree", content: paths.join("\n") },
      ];

      // The two documents that say what this codebase's rules are. A plan that
      // has not read them proposes changes CI will refuse.
      if (agents !== null) {
        files.push({ path: "AGENTS.md", content: agents.slice(0, MAX_DOCUMENT_CHARS) });
      }
      if (architecture !== null) {
        files.push({
          path: "docs/architecture.md",
          content: architecture.slice(0, MAX_DOCUMENT_CHARS),
        });
      }

      return files;
    },

    async implement({ proposal, prd, plan, context, agents }) {
      const applier = createApplier({ root: options.root, plan });

      const changes: AppliedChange[] = [];
      let costEur = 0;

      if (agents) {
        const pass = await editWithAgent(agents, applier, {
          instruction: implementationBrief({ prd, plan }),
          context,
          maxEdits: MAX_EDITS_PER_RUN,
        });
        changes.push(...pass.changes);
        costEur += pass.costEur;
        if (pass.failed !== null && !changes.some((change) => change.applied)) {
          return { status: "failed", changes, costEur, detail: pass.failed };
        }
      } else {
        const targets = plannedTargets(plan).slice(0, MAX_FILES_PER_RUN);
        for (const path of targets) {
          const outcome = await editOne(applier, { path, prd, plan, context });
          changes.push(outcome.change);
          costEur += outcome.costEur;
        }
      }

      // Nothing written is a failed implementation, not an empty success: the
      // branch would be identical to its base and the pull request empty.
      if (!changes.some((change) => change.applied)) {
        return {
          status: "failed",
          changes,
          costEur,
          detail: "nothing_applied",
        } satisfies ImplementationReport;
      }

      const staged = await options.commands.git("add", ["-A"]);
      if (!staged.ok) {
        return { status: "failed", changes, costEur, detail: "stage_failed" };
      }

      const committed = await options.commands.commit(
        `Product ops: ${proposal.title}`,
      );
      if (!committed.ok) {
        return { status: "failed", changes, costEur, detail: "commit_failed" };
      }

      return { status: "ok", changes, costEur, detail: null };
    },

    async verify({ plan, context, agents }) {
      const applier = createApplier({ root: options.root, plan });

      /** The failing step's output, kept for the repair pass. */
      let failing = "";

      const gate = async (): Promise<VerifyStep | null> => {
        for (const step of VERIFY_STEPS) {
          const result = await options.commands.verify(step);
          if (!result.ok) {
            logger.warn("productops.gate_failed", { step, code: result.code });
            failing = result.output;
            return step;
          }
        }

        return null;
      };

      const firstFailure = await gate();
      if (firstFailure === null) {
        return { status: "ok", detail: null, costEur: 0, changes: [] };
      }

      // One repair pass, per the routing document's rule for structured
      // output and this spec's for the gate: a second failure is a run that
      // stops with the branch intact for a person.
      const target = firstPlannedPathIn(failing, plan);
      if (target === null) {
        return {
          status: "failed",
          detail: firstFailure,
          costEur: 0,
          changes: [],
        } satisfies VerificationReport;
      }

      const repair = agents
        ? await (async () => {
            const pass = await editWithAgent(agents, applier, {
              instruction: repairBrief({
                step: firstFailure,
                output: failing,
                target,
                plan,
              }),
              context,
              maxEdits: MAX_EDITS_PER_REPAIR,
            });
            return { changes: pass.changes, costEur: pass.costEur };
          })()
        : await (async () => {
            const one = await editOne(applier, {
              path: target,
              prd: "",
              plan,
              context,
              // Fenced. Compiler and test output quotes source files back,
              // including the ones this agent just wrote.
              notes: [{ content: failing, source: `${firstFailure} output` }],
            });
            return { changes: [one.change], costEur: one.costEur };
          })();

      if (!repair.changes.some((change) => change.applied)) {
        return {
          status: "failed",
          detail: firstFailure,
          costEur: repair.costEur,
          changes: [...repair.changes],
        };
      }

      const secondFailure = await gate();
      if (secondFailure !== null) {
        return {
          status: "failed",
          detail: secondFailure,
          costEur: repair.costEur,
          changes: [...repair.changes],
        };
      }

      await options.commands.git("add", ["-A"]);
      await options.commands.commit("Product ops: fix the failing gate");

      return {
        status: "ok",
        detail: null,
        costEur: repair.costEur,
        changes: [...repair.changes],
      };
    },

    async publish({ proposal, prd, branch }) {
      const pushed = await options.commands.git("push", [
        "--set-upstream",
        "origin",
        branch,
      ]);
      if (!pushed.ok) {
        return {
          status: "failed",
          prNumber: null,
          url: null,
          detail: "push_failed",
        } satisfies PublishReport;
      }

      // The idempotency check the spec asks for, on the remote rather than in
      // the database: a worker that pushed and died before recording anything
      // finds its own pull request here and adopts it.
      const existing = await options.github.findPullRequestForBranch(branch);
      if (existing !== null) {
        return {
          status: "ok",
          prNumber: existing.number,
          url: existing.url,
          detail: null,
        };
      }

      const opened = await options.github.openPullRequest({
        branch,
        base: await options.github.defaultBranch(),
        title: proposal.title,
        body: pullRequestBody(proposal, prd.document),
      });

      if (opened === null) {
        return {
          status: "failed",
          prNumber: null,
          url: null,
          detail: "pull_request_refused",
        };
      }

      await options.github.addLabels(opened.number, [PULL_REQUEST_LABEL]);

      return {
        status: "ok",
        prNumber: opened.number,
        url: opened.url,
        detail: null,
      };
    },
  };
}
