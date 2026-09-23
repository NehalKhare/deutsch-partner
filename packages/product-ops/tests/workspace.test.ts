import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ImplementationPlan, PrdRecord, StoredProposal } from "@dp/domain/product-ops";
import { gatewayOk } from "@dp/gateway/errors";
import type { CompletionOutcome, ModelGateway } from "@dp/gateway/gateway";
import type { ModelCallSpec } from "@dp/gateway/call-spec";
import type { GitHubClient } from "../src/github";
import type {
  CommandResult,
  CommandRunner,
  VerifyStep,
} from "../src/commands";
import { createWorkspace, firstPlannedPathIn } from "../src/workspace";

/**
 * The working tree.
 *
 * The interesting behaviour is at the seams. A model's edit goes through the
 * validation layer rather than to the filesystem. A failing gate buys exactly
 * one repair pass, and the file that pass writes to is chosen by looking for a
 * planned path in the output rather than by asking the model which file to fix
 * — the output is untrusted text, and letting it pick the target would be
 * letting it past the allowlist by suggestion. And publishing finds its own
 * pull request rather than opening a second one.
 */

let root: string;

const CONTEXT = { requestId: null, userIdHash: "hash-operator" };

const PLAN: ImplementationPlan = {
  filesToModify: ["learning/curriculum.ts"],
  filesToCreate: [],
  databaseChanges: [],
  apiChanges: [],
  uiChanges: [],
  tests: [],
  dependencies: [],
  risks: [],
};

const SOURCE = "export const LEVELS = 3;\n";

const PROPOSAL = {
  id: "5a2b3c4d-1e2f-4a3b-8c4d-5e6f7a8b9c0d",
  title: "Medical German module",
  problemStatement: "Healthcare workers need clinical German.",
} as StoredProposal;

const PRD = {
  document: "# Medical German module\n",
} as PrdRecord;

/** A gateway that replies with one anchored edit, and records what it was sent. */
function gatewayFor(
  edits: readonly unknown[],
  onCall?: (system: string) => void,
) {
  let at = 0;
  const systems: string[] = [];

  const gateway: ModelGateway = {
    async complete(_spec: ModelCallSpec, prompt) {
      systems.push(prompt.system);
      onCall?.(prompt.system);
      const reply = edits[Math.min(at, edits.length - 1)];
      at += 1;

      return gatewayOk<CompletionOutcome>({
        text: JSON.stringify(reply),
        truncated: false,
        degraded: false,
        tier: "reasoning",
        modelIdResolved: "vendor/model",
        inputTokens: 800,
        outputTokens: 300,
        costUsd: 0.01,
        costEur: 0.009,
        attempts: 1,
        ledgerId: 1,
        citations: [],
      });
    },
    async stream() {
      throw new Error("product ops does not stream");
    },
  };

  return { gateway, systems, calls: () => at };
}

function commandsFor(
  outcomes: Partial<Record<VerifyStep, readonly boolean[]>> = {},
) {
  const log: string[] = [];
  const attempts = new Map<VerifyStep, number>();

  const commands: CommandRunner = {
    async verify(step) {
      const at = attempts.get(step) ?? 0;
      attempts.set(step, at + 1);
      const sequence = outcomes[step];
      const ok = sequence === undefined ? true : (sequence[at] ?? true);
      log.push(`verify:${step}:${ok ? "ok" : "fail"}`);

      return {
        ok,
        code: ok ? 0 : 1,
        output: ok ? "" : "learning/curriculum.ts(1,7): error TS2322: no",
      } satisfies CommandResult;
    },
    async git(verb, args = []) {
      log.push(`git:${verb}:${args.join(" ")}`);
      return { ok: true, code: 0, output: "" };
    },
    async commit(message) {
      log.push(`commit:${message}`);
      return { ok: true, code: 0, output: "" };
    },
  };

  return { commands, log };
}

function githubFor(over: Partial<GitHubClient> = {}) {
  const log: string[] = [];

  const github: GitHubClient = {
    repository: "acme/german-partner",
    async defaultBranch() {
      return "main";
    },
    async refSha() {
      return "abc123";
    },
    async createBranch() {
      return true;
    },
    async findPullRequestForBranch() {
      log.push("find");
      return null;
    },
    async openPullRequest() {
      log.push("open");
      return { number: 9, url: "https://git.test/9" };
    },
    async addLabels() {
      log.push("label");
      return true;
    },
    ...over,
  };

  return { github, log };
}

const EDIT = {
  kind: "modify",
  path: "learning/curriculum.ts",
  rationale: "Add a level.",
  edits: [{ anchor: "LEVELS = 3", replacement: "LEVELS = 4" }],
};

beforeEach(async () => {
  const parent = await mkdtemp(join(tmpdir(), "workspace-test-"));
  root = resolve(parent, "worktree");
  await mkdir(join(root, "learning"), { recursive: true });
  await writeFile(join(root, "learning", "curriculum.ts"), SOURCE, "utf8");
});

afterEach(async () => {
  await rm(resolve(root, ".."), { recursive: true, force: true });
});

describe("the planner's context", () => {
  it("offers the repository's shape and its rules, not its contents", async () => {
    await writeFile(join(root, "AGENTS.md"), "# The rules\n", "utf8");
    const { commands } = commandsFor();
    const { github } = githubFor();
    const { gateway } = gatewayFor([EDIT]);

    const files = await createWorkspace({
      root,
      gateway,
      github,
      commands,
      tree: async () => ["learning/curriculum.ts", "domain/product-ops.ts"],
    }).plannerContext({ prd: PRD.document });

    const tree = files.find((file) => file.path === "repository tree");
    expect(tree?.content).toContain("domain/product-ops.ts");
    // A listing costs a fraction of what the files themselves would, and it
    // is what a planner actually needs to decide which files a change touches.
    expect(files.map((file) => file.path)).toContain("AGENTS.md");
  });

  it("works in a checkout that has neither document", async () => {
    const { commands } = commandsFor();
    const { github } = githubFor();
    const { gateway } = gatewayFor([EDIT]);

    const files = await createWorkspace({
      root,
      gateway,
      github,
      commands,
      tree: async () => [],
    }).plannerContext({ prd: PRD.document });

    expect(files).toHaveLength(1);
  });
});

describe("implementing an approved plan", () => {
  function workspace(
    edits: readonly unknown[],
    options: { commands?: ReturnType<typeof commandsFor> } = {},
  ) {
    const commands = options.commands ?? commandsFor();
    const github = githubFor();
    const { gateway, systems } = gatewayFor(edits);

    return {
      systems,
      log: commands.log,
      githubLog: github.log,
      workspace: createWorkspace({
        root,
        gateway,
        github: github.github,
        commands: commands.commands,
        tree: async () => [],
      }),
    };
  }

  it("writes the edit through the validation layer and commits it", async () => {
    const subject = workspace([EDIT]);

    const report = await subject.workspace.implement({
      proposal: PROPOSAL,
      prd: PRD.document,
      plan: PLAN,
      context: CONTEXT,
    });

    expect(report.status).toBe("ok");
    expect(report.changes[0].applied).toBe(true);
    expect(await readFile(join(root, "learning", "curriculum.ts"), "utf8")).toContain(
      "LEVELS = 4",
    );
    expect(subject.log).toContain("git:add:-A");
    expect(subject.log.some((line) => line.startsWith("commit:"))).toBe(true);
  });

  it("fences the file it is editing rather than pasting it in as instruction", async () => {
    const subject = workspace([EDIT]);

    await subject.workspace.implement({
      proposal: PROPOSAL,
      prd: PRD.document,
      plan: PLAN,
      context: CONTEXT,
    });

    // Repository source is external content: a comment in a file can say
    // "ignore all previous instructions" as easily as a web page can.
    expect(subject.systems[0]).toContain("<retrieved_knowledge>");
    expect(subject.systems[0]).toContain("LEVELS = 3");
  });

  it("records a refusal and fails the run when nothing could be written", async () => {
    const subject = workspace([
      { ...EDIT, path: "lib/ai/gateway/gateway.ts" },
    ]);

    const report = await subject.workspace.implement({
      proposal: PROPOSAL,
      prd: PRD.document,
      plan: PLAN,
      context: CONTEXT,
    });

    expect(report.status).toBe("failed");
    expect(report.detail).toBe("nothing_applied");
    // The coder itself catches the wrong path first: it asked about one file
    // and was answered about another.
    expect(report.changes[0].applied).toBe(false);
    expect(report.changes[0].rejectedReason).not.toBeNull();
    // And nothing was committed.
    expect(subject.log.some((line) => line.startsWith("commit:"))).toBe(false);
  });

  it("reports what the calls cost", async () => {
    const subject = workspace([EDIT]);

    const report = await subject.workspace.implement({
      proposal: PROPOSAL,
      prd: PRD.document,
      plan: PLAN,
      context: CONTEXT,
    });

    expect(report.costEur).toBeGreaterThan(0);
  });
});

describe("choosing what to repair", () => {
  it("takes the first planned path the output names", () => {
    const output = [
      "node_modules/typescript/lib/foo.d.ts(1,1): note",
      "learning/curriculum.ts(1,7): error TS2322",
    ].join("\n");

    expect(firstPlannedPathIn(output, PLAN)).toBe("learning/curriculum.ts");
  });

  it("answers null rather than guessing when the output names none", () => {
    // Deterministic, and never delegated: the output is untrusted text, and a
    // model asked which file to fix could name any file in the plan — or try
    // to name one outside it.
    expect(firstPlannedPathIn("error: something went wrong", PLAN)).toBeNull();
    expect(firstPlannedPathIn("edit lib/ai/gateway/gateway.ts", PLAN)).toBeNull();
  });
});

describe("verification", () => {
  function subject(
    outcomes: Partial<Record<VerifyStep, readonly boolean[]>>,
    edits: readonly unknown[] = [EDIT],
  ) {
    const commands = commandsFor(outcomes);
    const github = githubFor();
    const { gateway, calls } = gatewayFor(edits);

    return {
      log: commands.log,
      modelCalls: calls,
      workspace: createWorkspace({
        root,
        gateway,
        github: github.github,
        commands: commands.commands,
        tree: async () => [],
      }),
    };
  }

  it("runs the project's own gate and asks for no repair when it passes", async () => {
    const run = subject({});

    const report = await run.workspace.verify({ plan: PLAN, context: CONTEXT });

    expect(report.status).toBe("ok");
    expect(report.costEur).toBe(0);
    expect(run.modelCalls()).toBe(0);
    expect(run.log).toEqual([
      "verify:typecheck:ok",
      "verify:lint:ok",
      "verify:test:ok",
      "verify:build:ok",
    ]);
  });

  it("stops at the first failing step rather than running the rest", async () => {
    const run = subject({ typecheck: [false, false] });

    await run.workspace.verify({ plan: PLAN, context: CONTEXT });

    expect(run.log.filter((line) => line.startsWith("verify:lint"))).toEqual([]);
  });

  it("buys exactly one repair pass, and no more", async () => {
    const run = subject({ typecheck: [false, false] });

    const report = await run.workspace.verify({ plan: PLAN, context: CONTEXT });

    expect(report.status).toBe("failed");
    expect(report.detail).toBe("typecheck");
    // One model call. A second failure is a run that stops with the branch
    // intact for a person, not a third attempt.
    expect(run.modelCalls()).toBe(1);
    expect(report.changes).toHaveLength(1);
  });

  it("passes when the repair fixes it, and commits the fix", async () => {
    const run = subject({ typecheck: [false, true] });

    const report = await run.workspace.verify({ plan: PLAN, context: CONTEXT });

    expect(report.status).toBe("ok");
    expect(report.changes[0].applied).toBe(true);
    expect(report.costEur).toBeGreaterThan(0);
    expect(run.log.some((line) => line.startsWith("commit:"))).toBe(true);
  });

  it("does not repair a file the output names but the plan does not", async () => {
    const commands: CommandRunner = {
      async verify() {
        return {
          ok: false,
          code: 1,
          output: "lib/ai/gateway/gateway.ts(1,1): error TS2322",
        };
      },
      async git() {
        return { ok: true, code: 0, output: "" };
      },
      async commit() {
        return { ok: true, code: 0, output: "" };
      },
    };
    const { gateway, calls } = gatewayFor([EDIT]);

    const report = await createWorkspace({
      root,
      gateway,
      github: githubFor().github,
      commands,
      tree: async () => [],
    }).verify({ plan: PLAN, context: CONTEXT });

    expect(report.status).toBe("failed");
    // No call at all: there was nothing in the plan to repair, and the
    // deny-listed file the compiler complained about is not this agent's.
    expect(calls()).toBe(0);
  });
});

describe("publishing", () => {
  function subject(over: Partial<GitHubClient> = {}) {
    const commands = commandsFor();
    const github = githubFor(over);
    const { gateway } = gatewayFor([EDIT]);

    return {
      log: commands.log,
      githubLog: github.log,
      workspace: createWorkspace({
        root,
        gateway,
        github: github.github,
        commands: commands.commands,
        tree: async () => [],
      }),
    };
  }

  it("pushes the branch and opens a labelled pull request", async () => {
    const run = subject();

    const report = await run.workspace.publish({
      proposal: PROPOSAL,
      prd: PRD,
      branch: "product-ops/abc",
    });

    expect(report).toMatchObject({ status: "ok", prNumber: 9 });
    expect(run.log).toContain("git:push:--set-upstream origin product-ops/abc");
    expect(run.githubLog).toEqual(["find", "open", "label"]);
  });

  it("adopts the pull request it already opened", async () => {
    // The property most worth proving: a worker that pushed and died before
    // recording anything must not open a second pull request.
    const run = subject({
      async findPullRequestForBranch() {
        return { number: 7, url: "https://git.test/7" };
      },
    });

    const report = await run.workspace.publish({
      proposal: PROPOSAL,
      prd: PRD,
      branch: "product-ops/abc",
    });

    expect(report).toMatchObject({ status: "ok", prNumber: 7 });
    expect(run.githubLog).not.toContain("open");
  });

  it("says the push failed rather than opening a pull request for nothing", async () => {
    const commands: CommandRunner = {
      async verify() {
        return { ok: true, code: 0, output: "" };
      },
      async git() {
        return { ok: false, code: 1, output: "rejected" };
      },
      async commit() {
        return { ok: true, code: 0, output: "" };
      },
    };
    const github = githubFor();
    const { gateway } = gatewayFor([EDIT]);

    const report = await createWorkspace({
      root,
      gateway,
      github: github.github,
      commands,
      tree: async () => [],
    }).publish({ proposal: PROPOSAL, prd: PRD, branch: "product-ops/abc" });

    expect(report.status).toBe("failed");
    expect(report.detail).toBe("push_failed");
    expect(github.log).toEqual([]);
  });

  it("says a pull request was written by a model, in the pull request", async () => {
    // The reviewer is the last control in this whole design, and a body that
    // did not say what they were reviewing would be hiding it from them.
    let sent = "";
    const run = subject({
      async openPullRequest(input) {
        sent = input.body;
        return { number: 9, url: "https://git.test/9" };
      },
    });

    await run.workspace.publish({
      proposal: PROPOSAL,
      prd: PRD,
      branch: "product-ops/abc",
    });

    expect(sent).toMatch(/written by a model/i);
    expect(sent).toContain(PROPOSAL.id);
  });
});
