import { describe, expect, it, vi } from "vitest";

import {
  GIT_VERBS,
  VERIFY_STEPS,
  createCommandRunner,
  isSafeArgument,
  isSafeMessage,
  type Exec,
} from "../src/commands";

/**
 * The command allowlist.
 *
 * The property that matters is negative: there is no path from model output to
 * a process. The agent is not given a way to name a command, and this checks
 * the layer that would refuse one if it were — the verb allowlist, the
 * argument rule, and the absence of a shell.
 *
 * The exec is injected, so these tests assert what *would* have been run
 * rather than running it. A test that actually started `pnpm build` would be a
 * test nobody runs.
 */

function runner() {
  const calls: Array<{ file: string; args: readonly string[]; cwd: string }> = [];
  const exec: Exec = async (file, args, cwd) => {
    calls.push({ file, args, cwd });
    return { ok: true, code: 0, output: "" };
  };

  return { calls, commands: createCommandRunner({ cwd: "/tmp/worktree", exec }) };
}

describe("the verification gate", () => {
  it.each(VERIFY_STEPS)("runs pnpm %s as an argument array", async (step) => {
    const { calls, commands } = runner();

    await commands.verify(step);

    expect(calls).toEqual([
      { file: "pnpm", args: [step], cwd: "/tmp/worktree" },
    ]);
  });

  it("refuses a step outside the four", async () => {
    const { calls, commands } = runner();

    const result = await commands.verify("deploy" as never);

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("runs the steps this project's own gate runs, in its order", () => {
    // pnpm verify is typecheck && lint && test && build. A worker that
    // verified less than the definition of done would be opening pull
    // requests against a lower bar than a person has to clear.
    expect([...VERIFY_STEPS]).toEqual(["typecheck", "lint", "test", "build"]);
  });
});

describe("git", () => {
  it("passes the verb and its arguments separately", async () => {
    const { calls, commands } = runner();

    await commands.git("push", ["--set-upstream", "origin", "product-ops/abc"]);

    expect(calls[0]).toMatchObject({
      file: "git",
      args: ["push", "--set-upstream", "origin", "product-ops/abc"],
    });
  });

  it("refuses a verb that is not on the list", async () => {
    const { calls, commands } = runner();

    const result = await commands.git("reset" as never, ["--hard"]);

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("has no verb that rewrites history or changes a remote", () => {
    // A worker that could add a remote could push anywhere.
    for (const forbidden of ["reset", "rebase", "remote", "clean", "config"]) {
      expect(GIT_VERBS as readonly string[]).not.toContain(forbidden);
    }
  });

  it.each([
    ["a semicolon", "main; rm -rf /"],
    ["a pipe", "main | tee /etc/passwd"],
    ["a subshell", "$(whoami)"],
    ["a backtick", "`id`"],
    ["an ampersand", "main && curl example.test"],
    ["a newline", "main\nrm -rf /"],
    ["an unlisted flag", "--exec=/bin/sh"],
    ["a space", "two words"],
  ])("refuses an argument carrying %s", async (_label, argument) => {
    // There is no shell for any of these to escape into. They are refused
    // anyway: an argument that does not look like an argument is a sign the
    // caller built it out of something it should not have.
    const { calls, commands } = runner();

    const result = await commands.git("checkout", [argument]);

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("accepts the arguments the worker actually builds", () => {
    for (const argument of [
      "product-ops/5a2b3c4d-1e2f-4a3b-8c4d-5e6f7a8b9c0d",
      "origin",
      "HEAD",
      "-b",
      "-A",
      "--set-upstream",
      "/tmp/product-ops-abc/worktree",
    ]) {
      expect(isSafeArgument(argument), argument).toBe(true);
    }
  });
});

describe("the commit message", () => {
  it("is its own method, because a message is not a token", async () => {
    const { calls, commands } = runner();

    await commands.commit("Product ops: Medical German module");

    expect(calls[0].args).toEqual([
      "commit",
      "-m",
      "Product ops: Medical German module",
    ]);
  });

  it("accepts a title a model wrote, spaces and all", () => {
    expect(isSafeMessage("Product ops: Aussprache üben, für Anfänger")).toBe(true);
  });

  it("refuses a message that spans lines or starts as a flag", () => {
    expect(isSafeMessage("first line\nsecond line")).toBe(false);
    expect(isSafeMessage("--amend")).toBe(false);
    expect(isSafeMessage("")).toBe(false);
    expect(isSafeMessage("x".repeat(500))).toBe(false);
  });

  it("refuses a message carrying a terminal escape", async () => {
    // A message reaches a terminal, a git log and a pull request. A control
    // character means one thing in each.
    const { calls, commands } = runner();

    const result = await commands.commit("Product ops: [2Kfake success");

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("the process itself", () => {
  it("never opens a shell", async () => {
    // Asserted on the module's source rather than on behaviour, because the
    // failure mode is a future edit adding one flag, and no test of the
    // injected exec would see it.
    //
    // Comments are stripped first. The module's own prose says what it does
    // not do, and a gate that read prose would be satisfied by a sentence and
    // fooled by one — which is exactly what happened the first time this test
    // ran.
    const { readFileSync } = await import("node:fs");
    const code = readFileSync(new URL("../src/commands.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    expect(code).toContain("shell: false");
    expect(code).not.toMatch(/shell:\s*true/);
    // execFile, not exec: the difference between the two is a shell.
    expect(code).not.toMatch(/\bexec\(/);
    expect(code).not.toMatch(/\bspawn\(|\bexecSync\(/);
  });

  it("truncates output, because a failing log is not a prompt", async () => {
    const exec = vi.fn(async () => ({
      ok: false,
      code: 1,
      output: "x".repeat(10),
    }));
    const commands = createCommandRunner({ cwd: "/tmp", exec });

    const result = await commands.verify("test");

    expect(result.output.length).toBeLessThanOrEqual(10);
  });
});
