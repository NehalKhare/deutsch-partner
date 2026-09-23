import { createTelemetry } from "@dp/observability/telemetry";

import { createWorkerContext } from "./composition";
import { workerEnv } from "./env";
import { startHealthServer, type HealthStatus } from "./health";
import { observeQueueDepth } from "./instruments";
import { runLoop } from "./loop";

/**
 * The worker process.
 *
 * Validate the environment, wire the dependencies, answer health checks, and
 * drain the queues until asked to stop. The recurring jobs are pg_cron's
 * business now, not this process's: the database enqueues them on schedule
 * and however many replicas run, they only ever drain.
 */
async function main(): Promise<void> {
  const env = workerEnv();
  // No endpoint, no exporters: the worker runs identically with telemetry off.
  const telemetry = createTelemetry({
    serviceName: env.app.OTEL_SERVICE_NAME ?? "worker",
    endpoint: env.app.OTEL_EXPORTER_OTLP_ENDPOINT,
    headers: env.app.OTEL_EXPORTER_OTLP_HEADERS,
    environment: env.app.NODE_ENV,
  });
  const context = createWorkerContext(env, telemetry);
  const { logger } = context;
  const settings = env.worker;

  if (telemetry.enabled) {
    observeQueueDepth(telemetry.meter, async () => {
      const outcome = await context.jobs.stats();
      return outcome.ok ? outcome.data : null;
    });
  }

  const controller = new AbortController();
  let health: HealthStatus = {
    queues: settings.WORKER_QUEUES,
    inflight: 0,
    lastPollAt: null,
    lastPollOk: false,
  };
  const server = startHealthServer(settings.PORT, () => health);

  const stop = (signal: string) => {
    logger.info("worker.stopping", { signal });
    controller.abort();
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));

  logger.info("worker.started", {
    queues: settings.WORKER_QUEUES,
    concurrency: settings.WORKER_CONCURRENCY,
    slowConcurrency: settings.WORKER_SLOW_CONCURRENCY,
    telemetry: telemetry.enabled,
    checkout: context.workflow.browser !== undefined,
  });

  await runLoop(context, {
    queues: settings.WORKER_QUEUES,
    concurrency: settings.WORKER_CONCURRENCY,
    slowConcurrency: settings.WORKER_SLOW_CONCURRENCY,
    pollMs: settings.WORKER_POLL_MS,
    lockSeconds: settings.WORKER_LOCK_SECONDS,
    signal: controller.signal,
    onPoll: (status) => {
      health = status;
    },
  });

  server.close();
  logger.info("worker.stopped", {});
  // After the last log line, so the flush carries it out.
  await telemetry.shutdown();
}

main().catch((error: unknown) => {
  process.stderr.write(`worker failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
