import type { Counter, Histogram, Meter, Tracer, UpDownCounter } from "@opentelemetry/api";

import type { QueueStat } from "@dp/db/jobs-repository";

/**
 * The worker's telemetry instruments, built once from a meter.
 *
 * Every attribute is drawn from a closed set — a job kind, a queue name, an
 * outcome, an error code — never from anything a learner or a model wrote.
 * Bounded cardinality for the metrics backend, and the same no-content rule
 * the logger enforces.
 */

export interface JobMetrics {
  /** Every finished job, by kind, queue and outcome. */
  readonly processed: Counter;
  /** How long a job held its claim, in seconds. */
  readonly duration: Histogram;
  readonly retried: Counter;
  readonly deadLettered: Counter;
  readonly inflight: UpDownCounter;
  /** Claim or requeue calls the loop could not complete. */
  readonly pollErrors: Counter;
}

export interface WorkerTelemetry {
  readonly tracer: Tracer;
  readonly metrics: JobMetrics;
}

export function createWorkerTelemetry(tracer: Tracer, meter: Meter): WorkerTelemetry {
  return {
    tracer,
    metrics: {
      processed: meter.createCounter("worker.jobs.processed", {
        unit: "{job}",
        description: "Finished jobs by kind, queue and outcome",
      }),
      duration: meter.createHistogram("worker.jobs.duration", {
        unit: "s",
        description: "Job run time from claim to completion or failure",
      }),
      retried: meter.createCounter("worker.jobs.retried", {
        unit: "{job}",
        description: "Jobs sent back to the queue for another attempt",
      }),
      deadLettered: meter.createCounter("worker.jobs.dead_lettered", {
        unit: "{job}",
        description: "Jobs failed for good, by kind and error code",
      }),
      inflight: meter.createUpDownCounter("worker.jobs.inflight", {
        unit: "{job}",
        description: "Jobs this process is running right now",
      }),
      pollErrors: meter.createCounter("worker.poll.errors", {
        description: "Polls where a claim or a requeue sweep failed",
      }),
    },
  };
}

/**
 * The queue as the database sees it, observed at each metric export: queued,
 * running and failed rows by queue. The failed count is the dead-letter
 * number an operator alerts on.
 */
export function observeQueueDepth(
  meter: Meter,
  stats: () => Promise<readonly QueueStat[] | null>,
): void {
  const depth = meter.createObservableGauge("worker.queue.depth", {
    unit: "{job}",
    description: "ops_jobs rows by queue and status",
  });

  depth.addCallback(async (observable) => {
    const rows = await stats().catch(() => null);
    if (rows === null) return;
    for (const row of rows) {
      observable.observe(row.count, { queue: row.queue, status: row.status });
    }
  });
}
