import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { CodeEdit, ImplementationPlan } from "@dp/domain/product-ops";
import { APPLY_LIMITS, createApplier } from "../src/apply";

/**
 * The trusted validation layer.
 *
 * This is the only code in the product that writes a file a model proposed, so
 * it is the one place where "the prompt says not to" is worth nothing. Every
 * test here is an attempt to get a write past it, and each one has a real
 * counterpart: a traversal, a symlink out of the worktree, a path the plan
 * never mentioned, a deny-listed path the plan *did* mention, an anchor that
 * matches nothing, and an anchor that matches twice.
 *
 * A real temporary directory rather than a mocked filesystem, because two of
 * the checks — the symlink and the resolved real path — are questions only a
 * filesystem can answer, and a mock would answer them the way the mock's
 * author expected.
 */

let root: string;
let outside: string;

const PLAN: ImplementationPlan = {
  filesToModify: ["learning/curriculum.ts"],
  filesToCreate: ["content/medical.md"],
  databaseChanges: [],
  apiChanges: [],
  uiChanges: [],
  tests: ["tests/unit/learning/medical.test.ts"],
  dependencies: [],
  risks: [],
};

const SOURCE = [
  "export const LEVELS = 3;",
  "",
  "export function describeLevel(level: number): string {",
  "  return `Level ${level}`;",
  "}",
  "",
].join("\n");

const modify = (over: Partial<Extract<CodeEdit, { kind: "modify" }>> = {}): CodeEdit => ({
  kind: "modify",
  path: "learning/curriculum.ts",
  rationale: "Add a level.",
  edits: [{ anchor: "export const LEVELS = 3;", replacement: "export const LEVELS = 4;" }],
  ...over,
});

const create = (over: Partial<Extract<CodeEdit, { kind: "create" }>> = {}): CodeEdit => ({
  kind: "create",
  path: "content/medical.md",
  rationale: "The module's content.",
  contents: "# Medical German\n",
  ...over,
});

const applier = (plan: ImplementationPlan = PLAN) =>
  createApplier({ root, plan });

beforeEach(async () => {
  const parent = await mkdtemp(join(tmpdir(), "apply-test-"));
  root = resolve(parent, "worktree");
  outside = resolve(parent, "elsewhere");

  await mkdir(join(root, "learning"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(root, "learning", "curriculum.ts"), SOURCE, "utf8");
  await writeFile(join(outside, "secrets.txt"), "a real secret\n", "utf8");
});

afterEach(async () => {
  await rm(resolve(root, ".."), { recursive: true, force: true });
});

describe("a write the plan allows", () => {
  it("applies an anchored edit and reports what changed", async () => {
    const outcome = await applier().apply(modify());

    expect(outcome.applied).toBe(true);
    expect(outcome.editCount).toBe(1);
    expect(outcome.rejectedReason).toBeNull();
    expect(await readFile(join(root, "learning", "curriculum.ts"), "utf8")).toContain(
      "LEVELS = 4",
    );
  });

  it("creates a new file, and the directory it needs", async () => {
    const outcome = await applier().apply(create());

    expect(outcome.applied).toBe(true);
    expect(outcome.bytesBefore).toBeNull();
    expect(await readFile(join(root, "content", "medical.md"), "utf8")).toContain(
      "Medical German",
    );
  });

  it("creates a test file the plan named, whichever list it is on", async () => {
    // Tests are listed on their own, without saying whether each exists yet,
    // and writing the test before the code is what the build spec asks for.
    const outcome = await applier().apply(
      create({
        path: "tests/unit/learning/medical.test.ts",
        contents: "import { it } from 'vitest';\n",
      }),
    );

    expect(outcome.applied).toBe(true);
  });

  it("applies several edits in order, each against the last one's result", async () => {
    const outcome = await applier().apply(
      modify({
        edits: [
          { anchor: "LEVELS = 3", replacement: "LEVELS = 4" },
          { anchor: "Level ${level}", replacement: "Stufe ${level}" },
        ],
      }),
    );

    expect(outcome.applied).toBe(true);
    const written = await readFile(join(root, "learning", "curriculum.ts"), "utf8");
    expect(written).toContain("LEVELS = 4");
    expect(written).toContain("Stufe");
  });
});

describe("leaving the worktree", () => {
  it("refuses a dot-segment traversal", async () => {
    const outcome = await applier({
      ...PLAN,
      filesToModify: ["../elsewhere/secrets.txt"],
    }).apply(modify({ path: "../elsewhere/secrets.txt" }));

    expect(outcome.applied).toBe(false);
    // The path schema catches this before the filesystem is asked anything.
    expect(outcome.rejectedReason).toBe("invalid_path");
  });

  it("refuses an absolute path, even one the plan names", async () => {
    const target = join(outside, "secrets.txt");
    const outcome = await applier({ ...PLAN, filesToModify: [target] }).apply(
      modify({ path: target }),
    );

    expect(outcome.applied).toBe(false);
    expect(await readFile(target, "utf8")).toBe("a real secret\n");
  });

  it("refuses a symlink that points out of the worktree", async () => {
    // The check a string comparison cannot make. The name is inside the root
    // and the file is not.
    await symlink(join(outside, "secrets.txt"), join(root, "learning", "leak.ts"));

    const outcome = await applier({
      ...PLAN,
      filesToModify: ["learning/leak.ts"],
    }).apply(modify({ path: "learning/leak.ts" }));

    expect(outcome.applied).toBe(false);
    expect(outcome.rejectedReason).toBe("symlink");
    expect(await readFile(join(outside, "secrets.txt"), "utf8")).toBe(
      "a real secret\n",
    );
  });

  it("refuses a new file under a symlinked directory", async () => {
    // The parent chain matters as much as the leaf: the file does not exist
    // yet, so what is resolved is where it would be created.
    await symlink(outside, join(root, "escape"));

    const outcome = await applier({
      ...PLAN,
      filesToCreate: ["escape/planted.md"],
    }).apply(create({ path: "escape/planted.md" }));

    expect(outcome.applied).toBe(false);
    expect(["symlink", "outside_worktree"]).toContain(outcome.rejectedReason);
  });
});

describe("the plan as an allowlist", () => {
  it("refuses a path the plan never mentioned", async () => {
    const outcome = await applier().apply(
      modify({ path: "learning/other.ts" }),
    );

    expect(outcome.applied).toBe(false);
    expect(outcome.rejectedReason).toBe("not_in_plan");
  });

  it("refuses a create for a path only the modify list names", async () => {
    // Which list a path is on is part of the approval: a person approved
    // changing that file, not replacing it wholesale.
    const outcome = await applier().apply(
      create({ path: "learning/curriculum.ts" }),
    );

    expect(outcome.applied).toBe(false);
    expect(outcome.rejectedReason).toBe("not_in_plan");
  });

  it("reads only what the plan names", async () => {
    const layer = applier();

    expect(await layer.read("learning/curriculum.ts")).toContain("LEVELS");
    // A read is how a secret reaches a prompt, and from there a review page.
    expect(await layer.read("learning/other.ts")).toBeNull();
    expect(await layer.read("../elsewhere/secrets.txt")).toBeNull();
  });
});

describe("the deny-list", () => {
  const denied = [
    ".env.local",
    "packages/db/supabase/migrations/20260101000000_x.sql",
    ".github/workflows/ci.yml",
    "packages/gateway/src/gateway.ts",
    "packages/prompts/src/catalogue.ts",
    "packages/security-tests/tests/ai-boundaries.test.ts",
    "package.json",
    "pnpm-lock.yaml",
    "apps/learner/proxy.ts",
  ];

  it.each(denied)("refuses %s even when the plan names it", async (path) => {
    // The plan is model-proposed and human-approved, and a human approving a
    // plan quickly is exactly what this list exists for.
    const outcome = await applier({
      ...PLAN,
      filesToModify: [path],
      filesToCreate: [path],
      tests: [path],
    }).apply(modify({ path }));

    expect(outcome.applied).toBe(false);
    expect(outcome.rejectedReason).toBe("denied_path");
  });

  it("refuses to read a deny-listed file the plan names", async () => {
    await writeFile(join(root, "package.json"), '{"name":"x"}', "utf8");

    expect(
      await applier({ ...PLAN, filesToModify: ["package.json"] }).read(
        "package.json",
      ),
    ).toBeNull();
  });
});

describe("the anchor", () => {
  it("refuses an anchor that matches nothing", async () => {
    const outcome = await applier().apply(
      modify({ edits: [{ anchor: "export const LEVELS = 9;", replacement: "" }] }),
    );

    expect(outcome.applied).toBe(false);
    expect(outcome.rejectedReason).toBe("anchor_missing");
    expect(await readFile(join(root, "learning", "curriculum.ts"), "utf8")).toBe(
      SOURCE,
    );
  });

  it("refuses an anchor that matches twice, rather than guessing", async () => {
    const outcome = await applier().apply(
      modify({ edits: [{ anchor: "level", replacement: "stufe" }] }),
    );

    expect(outcome.applied).toBe(false);
    expect(outcome.rejectedReason).toBe("anchor_ambiguous");
  });

  it("writes nothing when the second of two edits fails", async () => {
    // All or nothing per file. Half a change compiles less often than none.
    const outcome = await applier().apply(
      modify({
        edits: [
          { anchor: "LEVELS = 3", replacement: "LEVELS = 4" },
          { anchor: "does not appear", replacement: "x" },
        ],
      }),
    );

    expect(outcome.applied).toBe(false);
    expect(await readFile(join(root, "learning", "curriculum.ts"), "utf8")).toBe(
      SOURCE,
    );
  });

  it("counts occurrences after the previous edit, not before it", async () => {
    const outcome = await applier().apply(
      modify({
        edits: [
          { anchor: "export const LEVELS = 3;", replacement: "" },
          // The anchor was in the text this file started with, and is not in
          // the text the first edit produced.
          { anchor: "export const LEVELS = 3;", replacement: "x" },
        ],
      }),
    );

    expect(outcome.rejectedReason).toBe("anchor_missing");
  });

  it("treats an empty replacement as a deletion, which is legitimate", async () => {
    const outcome = await applier().apply(
      modify({ edits: [{ anchor: "export const LEVELS = 3;\n", replacement: "" }] }),
    );

    expect(outcome.applied).toBe(true);
    expect(
      await readFile(join(root, "learning", "curriculum.ts"), "utf8"),
    ).not.toContain("LEVELS");
  });
});

describe("the file itself", () => {
  it("refuses to modify a file that is not there", async () => {
    const outcome = await applier({
      ...PLAN,
      filesToModify: ["learning/absent.ts"],
    }).apply(modify({ path: "learning/absent.ts" }));

    expect(outcome.rejectedReason).toBe("file_missing");
  });

  it("refuses to create over a file that is", async () => {
    // A create over an existing file is a whole-file rewrite, which the output
    // ceiling makes impossible to express and therefore to review.
    await mkdir(join(root, "content"), { recursive: true });
    await writeFile(join(root, "content", "medical.md"), "existing\n", "utf8");

    const outcome = await applier().apply(create());

    expect(outcome.rejectedReason).toBe("file_exists");
    expect(await readFile(join(root, "content", "medical.md"), "utf8")).toBe(
      "existing\n",
    );
  });
});

describe("the size caps", () => {
  it("refuses a file larger than one source file has any business being", async () => {
    const outcome = await createApplier({
      root,
      plan: PLAN,
      limits: { maxFileBytes: 32, maxTotalBytes: APPLY_LIMITS.maxTotalBytes },
    }).apply(create({ contents: "x".repeat(64) }));

    expect(outcome.rejectedReason).toBe("file_too_large");
  });

  it("refuses the write that would take the run past its total", async () => {
    const layer = createApplier({
      root,
      plan: PLAN,
      limits: { maxFileBytes: 1_000, maxTotalBytes: 40 },
    });

    const first = await layer.apply(create({ contents: "x".repeat(30) }));
    const second = await layer.apply(
      modify({ edits: [{ anchor: "LEVELS = 3", replacement: "LEVELS = 4" }] }),
    );

    expect(first.applied).toBe(true);
    expect(second.rejectedReason).toBe("change_too_large");
    expect(layer.writtenBytes()).toBe(30);
  });
});
