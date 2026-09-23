import { SpanStatusCode, context as otelContext, trace } from "@opentelemetry/api";

import {
  JOB_MAX_ATTEMPTS,
  SLOW_JOB_KINDS,
  jobPayloadSchema,
  lockSecondsFor,
  type JobQueue,
} from "@dp/domain/jobs";
import type { ClaimedJob } from "@dp/db/jobs-repository";

import { withFields } from "@dp/observability/logger";

import type { WorkerContext } from "./composition";
import { handleJob } from "./handlers";
import type { HealthStatus } from "./health";

/**
 * The poll loop.
 *
 * Claim what the queues have, run each job with a heartbeat that keeps its
 * lock alive, report how it ended. At-least-once: a job whose worker died
 * comes back when its lock expires, and every handler is written for that.
 * Stopping is graceful: no new claims, the jobs in flight finish, then the
 * loop returns. If the platform kills the process anyway, the lock expiry
 * and the handlers' idempotency absorb it.
 *
 * Two concurrency budgets rather than one: the slow kinds — a run being
 * driven, a build inside a worktree, the corpus ingest — are capped at
 * slowConcurrency, and when those slots are full the claim excludes them so
 * the three-second jobs keep flowing past a ten-minute one.
 */
export interface LoopOptions {
  readonly queues: readonly JobQueue[];
  readonly concurrency: number;
  /** How many of the slow kinds may run at once. Never above concurrency. */
  readonly slowConcurrency: number;
  readonly pollMs: number;
  readonly lockSeconds: number;
  readonly signal: AbortSignal;
  /** Called after every poll; the health endpoint reads it. */
  readonly onPoll?: (status: HealthStatus) => void;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolveSleep) => {
    if (signal.aborted) return resolveSleep();
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      resolveSleep();
    }
    signal.addEventListener("abort", done, { once: true });
  });

/** How a job ended, as the span attribute and the metrics spell it. */
type JobOutcome = "done" | "retry" | "dead_letter" | "invalid" | "threw";

export async function processJob(
  job: ClaimedJob,
  context: WorkerContext,
  lockSeconds: number,
): Promise<void> {
  const { jobs, workerId, telemetry } = context;
  const { metrics } = telemetry;
  const logger = withFields(context.logger, {
    jobId: job.id,
    kind: job.kind,
    queue: job.queue,
    correlationId: job.correlationId,
    attempt: job.attempts,
  });

  const startedAt = Date.now();
  const span = telemetry.tracer.startSpan("job.process", {
    attributes: {
      "job.kind": job.kind,
      "job.queue": job.queue,
      "job.id": job.id,
      "job.attempt": job.attempts,
    },
  });

  // One exit for the span and the two per-job metrics, so an outcome cannot
  // be recorded in one place and forgotten in another. Codes only, never a
  // message that could carry a prompt.
  const finish = (outcome: JobOutcome, errorCode?: string) => {
    span.setAttribute("job.outcome", outcome);
    if (errorCode !== undefined) span.setAttribute("job.error_code", errorCode);
    if (outcome !== "done") span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();

    const attributes = { kind: job.kind, queue: job.queue, outcome };
    metrics.processed.add(1, attributes);
    metrics.duration.record((Date.now() - startedAt) / 1000, attributes);
  };

  const payload = jobPayloadSchema.safeParse(job.payload);
  if (!payload.success) {
    // A row the worker cannot read is nobody's to run. Failed at once, and
    // said so: a retry would read the same row.
    logger.error("worker.job_invalid", { audit: true, issues: payload.error.issues.length });
    await jobs.fail(job.id, workerId, "invalid_payload", job.attempts, { final: true });
    metrics.deadLettered.add(1, { kind: job.kind, queue: job.queue, errorCode: "invalid_payload" });
    finish("invalid", "invalid_payload");
    return;
  }

  // A slow kind holds a longer lock than the claim gave it, so a heartbeat
  // hiccup mid-build does not hand the worktree to a second worker. The
  // extension is best-effort; the interval below keeps it fresh either way.
  const kindLock = lockSecondsFor(job.kind, lockSeconds);
  if (kindLock !== lockSeconds) void jobs.heartbeat(job.id, workerId, kindLock);

  const heartbeat = setInterval(() => {
    void jobs.heartbeat(job.id, workerId, kindLock).then((beat) => {
      if (beat.ok && !beat.data) logger.warn("worker.lock_lost", {});
    });
  }, Math.max(5_000, (kindLock * 1000) / 3));

  logger.info("worker.job_started", {});

  try {
    const handleSpan = telemetry.tracer.startSpan(
      "job.handle",
      {},
      trace.setSpan(otelContext.active(), span),
    );
    let outcome;
    try {
      outcome = await handleJob(payload.data, context, {
        jobId: job.id,
        attempt: job.attempts,
        logger,
      });
    } finally {
      handleSpan.end();
    }
    const durationMs = Date.now() - startedAt;

    if (outcome.status === "done") {
      await jobs.complete(job.id, workerId);
      logger.info("worker.job_done", { durationMs, ...outcome.detail });
      finish("done");
      return;
    }

    const final = outcome.status === "failed";
    const result = await jobs.fail(job.id, workerId, outcome.errorCode, job.attempts, { final });
    const status = result.ok ? result.data : "unknown";
    if (status === "failed") {
      logger.error("worker.job_dead_lettered", {
        audit: true,
        errorCode: outcome.errorCode,
        attempts: job.attempts,
        maxAttempts: JOB_MAX_ATTEMPTS,
        durationMs,
      });
      metrics.deadLettered.add(1, { kind: job.kind, queue: job.queue, errorCode: outcome.errorCode });
      finish("dead_letter", outcome.errorCode);
    } else {
      logger.warn("worker.job_retry", { errorCode: outcome.errorCode, durationMs });
      metrics.retried.add(1, { kind: job.kind, errorCode: outcome.errorCode });
      finish("retry", outcome.errorCode);
    }
  } catch (error) {
    // A handler that throws has a bug; the job is retried and the bug is
    // logged as a code, never as a message that could carry a prompt.
    const errorName = error instanceof Error ? error.name : "unknown";
    logger.error("worker.job_threw", { errorName });
    span.setAttribute("error.name", errorName);
    await jobs.fail(job.id, workerId, "handler_threw", job.attempts);
    metrics.retried.add(1, { kind: job.kind, errorCode: "handler_threw" });
    finish("threw", "handler_threw");
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runLoop(context: WorkerContext, options: LoopOptions): Promise<void> {
  const { metrics } = context.telemetry;
  const slowCap = Math.min(options.slowConcurrency, options.concurrency);
  const inflight = new Set<Promise<void>>();
  let slowInflight = 0;
  let polls = 0;
  let lastPollAt: number | null = null;
  let lastPollOk = false;

  const report = () =>
    options.onPoll?.({
      queues: options.queues,
      inflight: inflight.size,
      lastPollAt,
      lastPollOk,
    });

  const track = (work: Promise<void>, slow: boolean) => {
    inflight.add(work);
    metrics.inflight.add(1);
    if (slow) slowInflight += 1;
    void work.finally(() => {
      inflight.delete(work);
      metrics.inflight.add(-1);
      if (slow) slowInflight -= 1;
    });
  };

  while (!options.signal.aborted) {
    polls += 1;
    lastPollAt = Date.now();
    lastPollOk = true;

    // Every tenth poll, give the jobs of dead workers back to the queue.
    if (polls % 10 === 1) {
      const moved = await context.jobs.requeueExpired();
      if (moved.ok && moved.data > 0) {
        context.logger.warn("worker.jobs_requeued", { count: moved.data });
      }
      if (!moved.ok) {
        lastPollOk = false;
        metrics.pollErrors.add(1, { stage: "requeue" });
      }
    }

    for (const queue of options.queues) {
      while (inflight.size < options.concurrency && !options.signal.aborted) {
        const excluded = slowInflight >= slowCap ? SLOW_JOB_KINDS : undefined;
        const claimed = await context.jobs.claim(
          queue,
          context.workerId,
          options.lockSeconds,
          excluded,
        );
        if (!claimed.ok) {
          lastPollOk = false;
          metrics.pollErrors.add(1, { stage: "claim" });
          context.logger.warn("worker.claim_failed", { queue, errorKind: claimed.error.kind });
          break;
        }
        if (claimed.data === null) break;
        track(
          processJob(claimed.data, context, options.lockSeconds),
          SLOW_JOB_KINDS.includes(claimed.data.kind),
        );
      }
    }

    report();
    await sleep(options.pollMs, options.signal);
  }

  context.logger.info("worker.draining", { inflight: inflight.size });
  await Promise.allSettled([...inflight]);
  report();
}
