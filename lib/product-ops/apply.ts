import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";

import {
  isDeniedPath,
  repoPathSchema,
  type AnchoredEdit,
  type CodeEdit,
  type ImplementationPlan,
} from "@/domain/product-ops";

/**
 * The trusted validation layer.
 *
 * Guardrails section 12 forbids executing model-generated writes without one,
 * and this is it: the only code in the product that writes a file a model
 * proposed. Nothing above it is a control. The prompt says what the agent may
 * touch, and the prompt is not the boundary; the plan a person approved and
 * the deny-list below it are.
 *
 * Five checks, in this order, every one fail-closed:
 *
 *   1. The resolved real path is inside the worktree. Traversal and symlinks
 *      are refused, and a symlink is refused by resolving rather than by
 *      pattern-matching, because a name that looks safe can point anywhere.
 *   2. The path appears in the approved plan's own file lists.
 *   3. The deny-list overrides the plan, whatever the plan says.
 *   4. Each anchor matches the target file exactly once. Zero, or two, is a
 *      rejection: this layer never guesses which occurrence was meant.
 *   5. The resulting file, and the run's total change, are under caps.
 *
 * The deny-list is not redundant with the plan. The plan is model-proposed and
 * human-approved, and a human approving a plan quickly is exactly the failure
 * mode the deny-list exists for.
 */

export interface ApplyLimits {
  /** One source file. Larger than anything in this repository. */
  readonly maxFileBytes: number;
  /** Everything one implementation run may write, across every file. */
  readonly maxTotalBytes: number;
}

export const APPLY_LIMITS: ApplyLimits = {
  maxFileBytes: 64_000,
  maxTotalBytes: 256_000,
};

/**
 * Why a write was refused, as a closed set.
 *
 * Codes rather than messages, and stored as such: a rejection reason ends up
 * in a database column and on an operator's screen, and a filesystem error
 * string carries absolute paths.
 */
export const REJECTION_REASONS = [
  "invalid_path",
  "outside_worktree",
  "symlink",
  "not_in_plan",
  "denied_path",
  "file_missing",
  "file_exists",
  "anchor_missing",
  "anchor_ambiguous",
  "file_too_large",
  "change_too_large",
  "unreadable",
  "unwritable",
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface ApplyOutcome {
  readonly path: string;
  readonly applied: boolean;
  readonly editCount: number;
  readonly bytesBefore: number | null;
  readonly bytesAfter: number | null;
  readonly rejectedReason: RejectionReason | null;
}

export interface Applier {
  /** Validates and, if every check passes, writes. */
  apply(edit: CodeEdit): Promise<ApplyOutcome>;
  /**
   * Reads a file the plan names, for the agent to edit.
   *
   * Behind the same first three checks as a write: a read of a path outside
   * the worktree is how a secret reaches a prompt, and from there a proposal
   * page.
   */
  read(path: string): Promise<string | null>;
  /** What has been written so far, against the run's cap. */
  writtenBytes(): number;
}

export interface ApplierOptions {
  /** The worktree. Absolute, and the boundary every path is resolved against. */
  readonly root: string;
  /** The approved plan. Its file lists are the allowlist. */
  readonly plan: ImplementationPlan;
  readonly limits?: ApplyLimits;
}

const refused = (
  path: string,
  rejectedReason: RejectionReason,
  editCount = 0,
): ApplyOutcome => ({
  path,
  applied: false,
  editCount,
  bytesBefore: null,
  bytesAfter: null,
  rejectedReason,
});

/**
 * Where the plan allows this kind of change.
 *
 * A test file counts for either: the plan lists the tests a change needs
 * without saying whether each one exists yet, and writing the test before the
 * code is what the build spec asks for.
 */
function allowedBy(plan: ImplementationPlan, edit: CodeEdit): boolean {
  const lists =
    edit.kind === "modify"
      ? [plan.filesToModify, plan.tests]
      : [plan.filesToCreate, plan.tests];

  return lists.some((list) => list.includes(edit.path));
}

/**
 * The real path of a target inside the root, or null when it is not inside it.
 *
 * Resolved rather than compared as strings. A path can leave the root three
 * ways this catches: a dot segment, an absolute path, and a symlink — that
 * last one only visible after asking the filesystem where the name actually
 * points. For a file that does not exist yet, the deepest existing ancestor is
 * resolved instead, which is where a symlinked parent directory would show up.
 */
async function insideRoot(
  root: string,
  relative: string,
): Promise<{ ok: true; absolute: string } | { ok: false; reason: RejectionReason }> {
  if (isAbsolute(relative)) return { ok: false, reason: "outside_worktree" };

  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  const absolute = resolve(realRoot, relative);
  const contained = (candidate: string) =>
    candidate === realRoot || candidate.startsWith(realRoot + sep);

  // The lexical check first, so a traversal is refused before the filesystem
  // is asked anything at all.
  if (!contained(absolute)) return { ok: false, reason: "outside_worktree" };

  try {
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) return { ok: false, reason: "symlink" };

    const real = await realpath(absolute);
    return contained(real)
      ? { ok: true, absolute }
      : { ok: false, reason: "outside_worktree" };
  } catch {
    // It does not exist yet. Its parent chain still has to be inside the root
    // and free of symlinks, which is what resolving the nearest existing
    // ancestor establishes.
    let ancestor = dirname(absolute);
    for (;;) {
      try {
        const real = await realpath(ancestor);
        return contained(real)
          ? { ok: true, absolute }
          : { ok: false, reason: "outside_worktree" };
      } catch {
        const next = dirname(ancestor);
        if (next === ancestor) return { ok: false, reason: "outside_worktree" };
        ancestor = next;
      }
    }
  }
}

/**
 * Applies one anchored edit, or says why it cannot.
 *
 * split().length is the count of occurrences, and it is the whole check: an
 * anchor that appears once identifies a place, and an anchor that appears
 * twice identifies an intention nobody stated.
 */
function substitute(
  source: string,
  edit: AnchoredEdit,
): { ok: true; text: string } | { ok: false; reason: RejectionReason } {
  const occurrences = source.split(edit.anchor).length - 1;

  if (occurrences === 0) return { ok: false, reason: "anchor_missing" };
  if (occurrences > 1) return { ok: false, reason: "anchor_ambiguous" };

  return { ok: true, text: source.replace(edit.anchor, edit.replacement) };
}

export function createApplier(options: ApplierOptions): Applier {
  const limits = options.limits ?? APPLY_LIMITS;
  let written = 0;

  /** Checks one, two and three. Nothing is read until all three pass. */
  async function admit(
    path: string,
    edit: CodeEdit | null,
  ): Promise<
    { ok: true; absolute: string } | { ok: false; reason: RejectionReason }
  > {
    // The schema first: it is the only thing that has refused a control
    // character or a backslash, and both mean one thing in a log and another
    // on a filesystem.
    if (!repoPathSchema.safeParse(path).success) {
      return { ok: false, reason: "invalid_path" };
    }

    if (edit !== null && !allowedBy(options.plan, edit)) {
      return { ok: false, reason: "not_in_plan" };
    }

    // Third and last, so that a deny-listed path the plan happens to name is
    // still refused. This is the check a hurried approval cannot waive.
    if (isDeniedPath(path)) return { ok: false, reason: "denied_path" };

    return insideRoot(options.root, path);
  }

  return {
    writtenBytes: () => written,

    async read(path) {
      const planned =
        options.plan.filesToModify.includes(path) ||
        options.plan.filesToCreate.includes(path) ||
        options.plan.tests.includes(path);
      if (!planned) return null;

      if (!repoPathSchema.safeParse(path).success) return null;
      if (isDeniedPath(path)) return null;

      const located = await insideRoot(options.root, path);
      if (!located.ok) return null;

      try {
        return await readFile(located.absolute, "utf8");
      } catch {
        return null;
      }
    },

    async apply(edit) {
      const located = await admit(edit.path, edit);
      if (!located.ok) return refused(edit.path, located.reason);

      const editCount = edit.kind === "modify" ? edit.edits.length : 1;

      let before: string | null = null;
      try {
        before = await readFile(located.absolute, "utf8");
      } catch {
        before = null;
      }

      if (edit.kind === "modify" && before === null) {
        return refused(edit.path, "file_missing", editCount);
      }
      // A create over an existing file is a whole-file rewrite, which is the
      // one shape the output ceiling makes it impossible to review.
      if (edit.kind === "create" && before !== null) {
        return refused(edit.path, "file_exists", editCount);
      }

      let text = before ?? "";
      if (edit.kind === "create") {
        text = edit.contents;
      } else {
        // Sequentially, and each against the text the previous one produced:
        // an edit whose anchor the previous edit removed has not matched
        // once, and saying so is more useful than writing half a change.
        for (const one of edit.edits) {
          const applied = substitute(text, one);
          if (!applied.ok) return refused(edit.path, applied.reason, editCount);
          text = applied.text;
        }
      }

      const bytesBefore = before === null ? null : Buffer.byteLength(before, "utf8");
      const bytesAfter = Buffer.byteLength(text, "utf8");

      if (bytesAfter > limits.maxFileBytes) {
        return refused(edit.path, "file_too_large", editCount);
      }
      if (written + bytesAfter > limits.maxTotalBytes) {
        return refused(edit.path, "change_too_large", editCount);
      }

      try {
        if (edit.kind === "create") {
          await mkdir(dirname(located.absolute), { recursive: true });
        }
        await writeFile(located.absolute, text, "utf8");
      } catch {
        return refused(edit.path, "unwritable", editCount);
      }

      written += bytesAfter;

      return {
        path: edit.path,
        applied: true,
        editCount,
        bytesBefore,
        bytesAfter,
        rejectedReason: null,
      };
    },
  };
}
