import { JOB_MAX_ATTEMPTS, jobPayloadSchema, type JobQueue } from "@dp/domain/jobs";
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
 */
export interface LoopOptions {
  readonly queues: readonly JobQueue[];
  readonly concurrency: number;
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

export async function processJob(
  job: ClaimedJob,
  context: WorkerContext,
  lockSeconds: number,
): Promise<void> {
  const { jobs, workerId } = context;
  const logger = withFields(context.logger, {
    jobId: job.id,
    kind: job.kind,
    queue: job.queue,
    correlationId: job.correlationId,
    attempt: job.attempts,
  });

  const payload = jobPayloadSchema.safeParse(job.payload);
  if (!payload.success) {
    // A row the worker cannot read is nobody's to run. Failed at once, and
    // said so: a retry would read the same row.
    logger.error("worker.job_invalid", { audit: true, issues: payload.error.issues.length });
    await jobs.fail(job.id, workerId, "invalid_payload", job.attempts, { final: true });
    return;
  }

  const heartbeat = setInterval(() => {
    void jobs.heartbeat(job.id, workerId, lockSeconds).then((beat) => {
      if (beat.ok && !beat.data) logger.warn("worker.lock_lost", {});
    });
  }, Math.max(5_000, (lockSeconds * 1000) / 3));

  const startedAt = Date.now();
  logger.info("worker.job_started", {});

  try {
    const outcome = await handleJob(payload.data, context, {
      jobId: job.id,
      attempt: job.attempts,
      logger,
    });
    const durationMs = Date.now() - startedAt;

    if (outcome.status === "done") {
      await jobs.complete(job.id, workerId);
      logger.info("worker.job_done", { durationMs, ...outcome.detail });
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
    } else {
      logger.warn("worker.job_retry", { errorCode: outcome.errorCode, durationMs });
    }
  } catch (error) {
    // A handler that throws has a bug; the job is retried and the bug is
    // logged as a code, never as a message that could carry a prompt.
    logger.error("worker.job_threw", { errorName: error instanceof Error ? error.name : "unknown" });
    await jobs.fail(job.id, workerId, "handler_threw", job.attempts);
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runLoop(context: WorkerContext, options: LoopOptions): Promise<void> {
  const inflight = new Set<Promise<void>>();
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

  const track = (work: Promise<void>) => {
    inflight.add(work);
    void work.finally(() => inflight.delete(work));
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
      if (!moved.ok) lastPollOk = false;
    }

    for (const queue of options.queues) {
      while (inflight.size < options.concurrency && !options.signal.aborted) {
        const claimed = await context.jobs.claim(queue, context.workerId, options.lockSeconds);
        if (!claimed.ok) {
          lastPollOk = false;
          context.logger.warn("worker.claim_failed", { queue, errorKind: claimed.error.kind });
          break;
        }
        if (claimed.data === null) break;
        track(processJob(claimed.data, context, options.lockSeconds));
      }
    }

    report();
    await sleep(options.pollMs, options.signal);
  }

  context.logger.info("worker.draining", { inflight: inflight.size });
  await Promise.allSettled([...inflight]);
  report();
}
