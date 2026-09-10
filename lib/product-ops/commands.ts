import { execFile } from "node:child_process";

/**
 * The commands the worker may run.
 *
 * A fixed allowlist, passed as argument arrays. Never a shell string, never
 * `shell: true`, and never a command, a flag or an argument derived from model
 * output — which is why the agent is not given a way to name one. What it can
 * ask for is a file edit; running the project's own gate afterwards is this
 * module's decision, not its.
 *
 * The argument validator exists for the arguments this module itself builds:
 * a branch name is derived from a proposal id, and a commit message quotes a
 * proposal title a model wrote. Neither reaches a shell, because there is no
 * shell, but a leading dash turns an argument into a flag and that is worth
 * refusing on its own.
 */

/** The project's own gate, in the order it should fail. */
export const VERIFY_STEPS = ["typecheck", "lint", "test", "build"] as const;

export type VerifyStep = (typeof VERIFY_STEPS)[number];

/**
 * Every git verb the worker needs, and no others.
 *
 * Notably absent: anything that rewrites history, anything that changes a
 * remote, and `config`. A worker that could add a remote could push anywhere.
 */
export const GIT_VERBS = [
  "add",
  "checkout",
  "commit",
  "diff",
  "push",
  "rev-parse",
  "status",
  "worktree",
] as const;

export type GitVerb = (typeof GIT_VERBS)[number];

/**
 * What an argument may contain.
 *
 * Deliberately narrow, and checked rather than escaped. Escaping is a thing
 * one does when the target is a shell; there is no shell here, so the useful
 * property is that an argument which does not look like an argument never gets
 * built at all.
 */
const SAFE_ARGUMENT = /^[A-Za-z0-9._@/:=+-]+$/;

/** The flags the worker is allowed to pass. A closed set, like the verbs. */
const ALLOWED_FLAGS = new Set([
  "-m",
  "-b",
  "-A",
  "--porcelain",
  "--set-upstream",
  "--force-with-lease",
  "--stat",
  "HEAD",
]);

export function isSafeArgument(argument: string): boolean {
  if (ALLOWED_FLAGS.has(argument)) return true;
  if (argument.startsWith("-")) return false;

  return SAFE_ARGUMENT.test(argument);
}

const MAX_MESSAGE_CHARS = 200;

/**
 * A commit message is free text, and is checked by a different rule.
 *
 * It quotes a proposal title a model wrote, so it cannot be held to the token
 * rule above — a title has spaces in it. What it is held to is that it is one
 * line, is not a flag, and carries nothing that means one thing in a terminal
 * and another in a file. There is no shell for it to escape into; this is
 * about what ends up in the repository's history.
 */
export function isSafeMessage(message: string): boolean {
  if (message.length === 0 || message.length > MAX_MESSAGE_CHARS) return false;
  if (message.startsWith("-")) return false;

  for (const character of message) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }

  return true;
}

export interface CommandResult {
  readonly ok: boolean;
  readonly code: number;
  /**
   * Combined output, truncated.
   *
   * Kept because a failing gate's output is what a repair pass needs. Treated
   * as untrusted on the way into a prompt — it quotes source files, including
   * whatever the agent just wrote into them.
   */
  readonly output: string;
}

/** Enough of a failure to act on. A full test log is not a prompt. */
export const MAX_OUTPUT_CHARS = 6_000;

export interface CommandRunner {
  verify(step: VerifyStep): Promise<CommandResult>;
  git(verb: GitVerb, args?: readonly string[]): Promise<CommandResult>;
  /**
   * Separate from git() because a message is not a token.
   *
   * Keeping it as its own method is what lets the argument rule stay as
   * narrow as it is: nothing else the worker runs has free text in it.
   */
  commit(message: string): Promise<CommandResult>;
}

export type Exec = (
  file: string,
  args: readonly string[],
  cwd: string,
) => Promise<CommandResult>;

/**
 * The one place a process is started.
 *
 * execFile, not exec: the difference is a shell, and a shell is the difference
 * between an argument and a command. The environment is passed through as-is
 * because the gate needs a PATH and the repository's own tooling, and the
 * token the GitHub client holds is never in argv — it travels as a header on
 * an HTTPS request and nowhere else.
 */
const nodeExec: Exec = (file, args, cwd) =>
  new Promise((resolvePromise) => {
    execFile(
      file,
      [...args],
      { cwd, shell: false, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`.slice(0, MAX_OUTPUT_CHARS);
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;

        resolvePromise({ ok: code === 0, code, output });
      },
    );
  });

const REFUSED: CommandResult = {
  ok: false,
  code: -1,
  output: "refused: not an allowed command",
};

export function createCommandRunner(options: {
  readonly cwd: string;
  readonly exec?: Exec;
}): CommandRunner {
  const run = options.exec ?? nodeExec;

  return {
    async verify(step) {
      // A closed set, so there is nothing to validate: the caller cannot name
      // a step that is not one of four literals.
      if (!VERIFY_STEPS.includes(step)) return REFUSED;

      return run("pnpm", [step], options.cwd);
    },

    async git(verb, args = []) {
      if (!GIT_VERBS.includes(verb)) return REFUSED;
      if (!args.every(isSafeArgument)) return REFUSED;

      return run("git", [verb, ...args], options.cwd);
    },

    async commit(message) {
      if (!isSafeMessage(message)) return REFUSED;

      return run("git", ["commit", "-m", message], options.cwd);
    },
  };
}
