import { describe, expect, it } from "vitest";

import { workerEnv } from "@/env";

const base = {
  NODE_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_abcdefghijklmnop",
};

describe("the worker's environment", () => {
  it("defaults to the jobs queue with the scheduler on", () => {
    const env = workerEnv(base);

    expect(env.worker.WORKER_QUEUES).toEqual(["jobs"]);
    expect(env.worker.WORKER_SCHEDULER).toBe(true);
    expect(env.worker.WORKER_CONCURRENCY).toBe(2);
  });

  it("reads a comma-separated queue list", () => {
    expect(workerEnv({ ...base, WORKER_QUEUES: "jobs, coder", GITHUB_TOKEN: "ghp_0123456789abcdef", GITHUB_REPOSITORY: "owner/repo", REPO_CHECKOUT_PATH: "/workspace/repo" }).worker.WORKER_QUEUES).toEqual(["jobs", "coder"]);
  });

  it("refuses an unknown queue", () => {
    expect(() => workerEnv({ ...base, WORKER_QUEUES: "jobs,everything" })).toThrow();
  });

  it("refuses the coder queue without a token, a repository and a checkout", () => {
    expect(() => workerEnv({ ...base, WORKER_QUEUES: "coder" })).toThrow(/GITHUB_TOKEN/);
    expect(() =>
      workerEnv({ ...base, WORKER_QUEUES: "coder", GITHUB_TOKEN: "ghp_0123456789abcdef", GITHUB_REPOSITORY: "owner/repo" }),
    ).toThrow(/REPO_CHECKOUT_PATH/);
  });
});
