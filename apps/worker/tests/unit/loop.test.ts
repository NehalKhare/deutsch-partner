import { describe, expect, it, vi } from "vitest";

import type { ClaimedJob, JobsRepository } from "@dp/db/jobs-repository";
import { nullLogger } from "@dp/observability/logger";

import type { WorkerContext } from "@/composition";
import { processJob } from "@/loop";

/**
 * How a claimed job ends, seen from the queue.
 *
 * The handlers are tested where they live; here the payload is one the
 * dispatcher can run without a database — a job the worker cannot parse, and
 * a job whose handler reports each of the three outcomes.
 */

function fakeJobs() {
  const calls: string[] = [];
  const jobs: JobsRepository = {
    enqueue: vi.fn(async () => ({ ok: true as const, data: { id: 1, created: true, queue: "jobs" as const } })),
    requeueExpired: vi.fn(async () => ({ ok: true as const, data: 0 })),
    claim: vi.fn(async () => ({ ok: true as const, data: null })),
    heartbeat: vi.fn(async () => ({ ok: true as const, data: true })),
    complete: vi.fn(async (id: number) => {
      calls.push(`complete:${id}`);
      return { ok: true as const, data: true };
    }),
    fail: vi.fn(async (id: number, _worker: string, code: string, _attempt: number, options?: { final?: boolean }) => {
      calls.push(`fail:${id}:${code}:${options?.final ? "final" : "retry"}`);
      return { ok: true as const, data: options?.final ? ("failed" as const) : ("queued" as const) };
    }),
  };
  return { jobs, calls };
}

function job(payload: unknown, attempts = 1): ClaimedJob {
  return {
    id: 7,
    queue: "jobs",
    kind: "checkpoints.prune",
    payload,
    status: "running",
    attempts,
    maxAttempts: 5,
    correlationId: "9f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f",
    requestedByHash: null,
    dedupeKey: "checkpoints.prune",
    runAfter: new Date(),
    lockExpiresAt: new Date(Date.now() + 90_000),
    createdAt: new Date(),
  };
}

function contextWith(jobs: JobsRepository, pruneOutcome: { ok: true; data: number } | { ok: false }): WorkerContext {
  return {
    jobs,
    workerId: "w1",
    logger: nullLogger,
    runs: {
      pruneCheckpoints: vi.fn(async () =>
        pruneOutcome.ok ? { ok: true, data: pruneOutcome.data } : { ok: false, error: new Error("down") },
      ),
    },
  } as unknown as WorkerContext;
}

describe("a claimed job", () => {
  it("that cannot be parsed is failed for good, never retried", async () => {
    const { jobs, calls } = fakeJobs();

    await processJob(job({ kind: "rm.rf" }), contextWith(jobs, { ok: true, data: 0 }), 90);

    expect(calls).toEqual(["fail:7:invalid_payload:final"]);
  });

  it("that finishes is completed", async () => {
    const { jobs, calls } = fakeJobs();
    const payload = { kind: "checkpoints.prune", olderThanDays: 30, correlationId: "9f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f", source: "scheduler" };

    await processJob(job(payload), contextWith(jobs, { ok: true, data: 3 }), 90);

    expect(calls).toEqual(["complete:7"]);
  });

  it("whose store was unavailable is retried, not failed", async () => {
    const { jobs, calls } = fakeJobs();
    const payload = { kind: "checkpoints.prune", olderThanDays: 30, correlationId: "9f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f", source: "scheduler" };

    await processJob(job(payload, 2), contextWith(jobs, { ok: false }), 90);

    expect(calls).toEqual(["fail:7:store_unavailable:retry"]);
  });
});
