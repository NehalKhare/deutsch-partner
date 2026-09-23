import { createWorkerContext } from "./composition";
import { workerEnv } from "./env";
import { startHealthServer, type HealthStatus } from "./health";
import { runLoop } from "./loop";
import { createScheduler } from "./scheduler";

/**
 * The worker process.
 *
 * Validate the environment, wire the dependencies, answer health checks,
 * enqueue the scheduled jobs if this process is meant to, and drain the
 * queues until asked to stop.
 */
async function main(): Promise<void> {
  const env = workerEnv();
  const context = createWorkerContext(env);
  const { logger } = context;
  const settings = env.worker;

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

  let schedulerTimer: NodeJS.Timeout | null = null;
  if (settings.WORKER_SCHEDULER && settings.WORKER_QUEUES.includes("jobs")) {
    const scheduler = createScheduler({
      enqueue: async (payload) => {
        const outcome = await context.jobs.enqueue({ payload });
        if (!outcome.ok) logger.warn("worker.schedule_failed", { kind: payload.kind });
      },
    });
    const tick = () =>
      void scheduler.tick().then((due) => {
        if (due.length > 0) logger.info("worker.scheduled", { kinds: due });
      });
    tick();
    schedulerTimer = setInterval(tick, 60_000);
  }

  logger.info("worker.started", {
    queues: settings.WORKER_QUEUES,
    concurrency: settings.WORKER_CONCURRENCY,
    scheduler: schedulerTimer !== null,
    checkout: context.workflow.browser !== undefined,
  });

  await runLoop(context, {
    queues: settings.WORKER_QUEUES,
    concurrency: settings.WORKER_CONCURRENCY,
    pollMs: settings.WORKER_POLL_MS,
    lockSeconds: settings.WORKER_LOCK_SECONDS,
    signal: controller.signal,
    onPoll: (status) => {
      health = status;
    },
  });

  if (schedulerTimer) clearInterval(schedulerTimer);
  server.close();
  logger.info("worker.stopped", {});
}

main().catch((error: unknown) => {
  process.stderr.write(`worker failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
