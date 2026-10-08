import { describe, expect, it, vi } from "vitest";

import { SpanStatusCode } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type CollectionResult,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { SLOW_JOB_KINDS, type JobKind } from "@dp/domain/jobs";
import type { ClaimedJob, JobsRepository } from "@dp/db/jobs-repository";
import { nullLogger } from "@dp/observability/logger";

import type { WorkerContext } from "@/composition";
import { createWorkerTelemetry } from "@/instruments";
import { processJob, runLoop } from "@/loop";

/**
 * How a claimed job ends, seen from the queue and from the telemetry.
 *
 * The handlers are tested where they live; here the payload is one the
 * dispatcher can run without a database — a job the worker cannot parse, and
 * a job whose handler reports each of the three outcomes. The spans and
 * metrics are read back through in-memory exporters: real instruments, no
 * network.
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
    stats: vi.fn(async () => ({ ok: true as const, data: [] })),
  };
  return { jobs, calls };
}

function telemetryHarness() {
  const spans = new InMemorySpanExporter();
  const tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spans)],
  });
  const reader = new PeriodicExportingMetricReader({
    exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    exportIntervalMillis: 3_600_000,
  });
  const meterProvider = new MeterProvider({ readers: [reader] });

  const metric = async (name: string) => {
    const collected: CollectionResult = await reader.collect();
    return collected.resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((candidate) => candidate.descriptor.name === name);
  };

  return {
    telemetry: createWorkerTelemetry(tracerProvider.getTracer("test"), meterProvider.getMeter("test")),
    spans,
    metric,
  };
}

function job(payload: unknown, attempts = 1, kind: JobKind = "checkpoints.prune"): ClaimedJob {
  return {
    id: 7,
    queue: "jobs",
    kind,
    payload,
    status: "running",
    attempts,
    maxAttempts: 5,
    correlationId: "9f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f",
    requestedByHash: null,
    dedupeKey: kind,
    runAfter: new Date(),
    lockExpiresAt: new Date(Date.now() + 90_000),
    createdAt: new Date(),
  };
}

function contextWith(
  jobs: JobsRepository,
  pruneOutcome: { ok: true; data: number } | { ok: false },
  telemetry = telemetryHarness().telemetry,
): WorkerContext {
  return {
    jobs,
    workerId: "w1",
    logger: nullLogger,
    telemetry,
    notifications: { notify: vi.fn(async () => {}) },
    env: { app: {} },
    runs: {
      pruneCheckpoints: vi.fn(async () =>
        pruneOutcome.ok ? { ok: true, data: pruneOutcome.data } : { ok: false, error: new Error("down") },
      ),
    },
  } as unknown as WorkerContext;
}

const PRUNE = {
  kind: "checkpoints.prune",
  olderThanDays: 30,
  correlationId: "9f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f",
  source: "scheduler",
};

describe("a claimed job", () => {
  it("that cannot be parsed is failed for good, never retried", async () => {
    const { jobs, calls } = fakeJobs();

    await processJob(job({ kind: "rm.rf" }), contextWith(jobs, { ok: true, data: 0 }), 90);

    expect(calls).toEqual(["fail:7:invalid_payload:final"]);
  });

  it("that finishes is completed", async () => {
    const { jobs, calls } = fakeJobs();

    await processJob(job(PRUNE), contextWith(jobs, { ok: true, data: 3 }), 90);

    expect(calls).toEqual(["complete:7"]);
  });

  it("whose store was unavailable is retried, not failed", async () => {
    const { jobs, calls } = fakeJobs();

    await processJob(job(PRUNE, 2), contextWith(jobs, { ok: false }), 90);

    expect(calls).toEqual(["fail:7:store_unavailable:retry"]);
  });

  it("of a slow kind extends its lock at once", async () => {
    const { jobs } = fakeJobs();
    const payload = {
      kind: "ingest.knowledge",
      only: null,
      force: false,
      correlationId: "9f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f",
      source: "scheduler",
    };

    // No model key, so the handler fails fast — the extension it asked for
    // on the way in is what this test is about.
    await processJob(
      job(payload, 1, "ingest.knowledge"),
      contextWith(fakeJobs().jobs, { ok: true, data: 0 }),
      90,
    );
    await processJob(job(payload, 1, "ingest.knowledge"), contextWith(jobs, { ok: true, data: 0 }), 90);

    expect(jobs.heartbeat).toHaveBeenCalledWith(7, "w1", 600);
  });
});

describe("a job's telemetry", () => {
  it("records a span and the counters for a finished job", async () => {
    const harness = telemetryHarness();
    const { jobs } = fakeJobs();

    await processJob(job(PRUNE), contextWith(jobs, { ok: true, data: 3 }, harness.telemetry), 90);

    const finished = harness.spans.getFinishedSpans();
    const root = finished.find((span) => span.name === "job.process");
    const child = finished.find((span) => span.name === "job.handle");
    expect(root?.attributes["job.kind"]).toBe("checkpoints.prune");
    expect(root?.attributes["job.outcome"]).toBe("done");
    expect(child?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);

    const processed = await harness.metric("worker.jobs.processed");
    expect(processed?.dataPoints).toHaveLength(1);
    expect(processed?.dataPoints[0]?.attributes).toEqual({
      kind: "checkpoints.prune",
      queue: "jobs",
      outcome: "done",
    });

    const duration = await harness.metric("worker.jobs.duration");
    expect(duration?.dataPoints).toHaveLength(1);
  });

  it("marks a retried job with the error code and counts it", async () => {
    const harness = telemetryHarness();
    const { jobs } = fakeJobs();

    await processJob(job(PRUNE, 2), contextWith(jobs, { ok: false }, harness.telemetry), 90);

    const root = harness.spans.getFinishedSpans().find((span) => span.name === "job.process");
    expect(root?.attributes["job.outcome"]).toBe("retry");
    expect(root?.attributes["job.error_code"]).toBe("store_unavailable");
    expect(root?.status.code).toBe(SpanStatusCode.ERROR);

    const retried = await harness.metric("worker.jobs.retried");
    expect(retried?.dataPoints[0]?.attributes).toEqual({
      kind: "checkpoints.prune",
      errorCode: "store_unavailable",
    });
  });

  it("counts an unparseable job as dead-lettered, with a code and no content", async () => {
    const harness = telemetryHarness();
    const { jobs } = fakeJobs();

    await processJob(job({ kind: "rm.rf", secret: "hunter2" }), contextWith(jobs, { ok: true, data: 0 }, harness.telemetry), 90);

    const root = harness.spans.getFinishedSpans().find((span) => span.name === "job.process");
    expect(root?.attributes["job.outcome"]).toBe("invalid");
    // Codes only: nothing from the payload may reach an attribute.
    expect(JSON.stringify(root?.attributes)).not.toContain("hunter2");

    const dead = await harness.metric("worker.jobs.dead_lettered");
    expect(dead?.dataPoints[0]?.attributes).toEqual({
      kind: "checkpoints.prune",
      queue: "jobs",
      errorCode: "invalid_payload",
    });
  });
});

describe("the loop's slow lane", () => {
  it("excludes the slow kinds from the claim once their slots are full", async () => {
    const excludedSeen: Array<readonly JobKind[] | undefined> = [];
    let release!: () => void;
    const hanging = new Promise<void>((resolveHang) => {
      release = resolveHang;
    });

    const { jobs } = fakeJobs();
    let claims = 0;
    jobs.claim = vi.fn(async (_queue, _worker, _lock, excluded?: readonly JobKind[]) => {
      claims += 1;
      excludedSeen.push(excluded);
      if (claims === 1) {
        // A slow kind whose payload cannot parse: processing stops inside
        // jobs.fail, which hangs until the test releases it.
        return { ok: true as const, data: job({ kind: "nonsense" }, 1, "productops.drive") };
      }
      return { ok: true as const, data: null };
    });
    jobs.fail = vi.fn(async () => {
      await hanging;
      return { ok: true as const, data: "failed" as const };
    });

    const controller = new AbortController();
    const done = runLoop(contextWith(jobs, { ok: true, data: 0 }), {
      queues: ["jobs"],
      concurrency: 2,
      slowConcurrency: 1,
      pollMs: 5,
      lockSeconds: 90,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(claims).toBeGreaterThanOrEqual(2);
    });

    expect(excludedSeen[0]).toBeUndefined();
    expect(excludedSeen[1]).toEqual(SLOW_JOB_KINDS);

    release();
    controller.abort();
    await done;
  });
});

describe("what the operators are told", () => {
  it("about a job that gave up: its kind, its id and the code, never the payload", async () => {
    const { jobs } = fakeJobs();
    (jobs.fail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, data: "failed" });
    const context = contextWith(jobs, { ok: false });

    await processJob(job(PRUNE, 5), context, 90);

    expect(context.notifications.notify).toHaveBeenCalledWith({
      kind: "jobs.dead_lettered",
      jobId: 7,
      jobKind: "checkpoints.prune",
      errorCode: "store_unavailable",
      attempts: 5,
    });
  });

  it("about a job it could not read, as a dead letter with no content", async () => {
    const { jobs } = fakeJobs();
    const context = contextWith(jobs, { ok: true, data: 0 });

    await processJob(job({ kind: "rm.rf", secret: "hunter2" }), context, 90);

    const notify = context.notifications.notify as ReturnType<typeof vi.fn>;
    expect(notify).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(notify.mock.calls[0])).not.toContain("hunter2");
    expect(notify.mock.calls[0]?.[0]).toMatchObject({ kind: "jobs.dead_lettered", errorCode: "invalid_payload" });
  });

  it("nothing about a job that will be retried", async () => {
    const { jobs } = fakeJobs();
    const context = contextWith(jobs, { ok: false });

    await processJob(job(PRUNE, 2), context, 90);

    expect(context.notifications.notify).not.toHaveBeenCalled();
  });
});
