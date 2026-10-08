import { existsSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";

import { createClient } from "@supabase/supabase-js";

import { createJobsRepository, type JobsRepository } from "@dp/db/jobs-repository";
import {
  FEEDBACK_WINDOW_DAYS,
  createLearnerFeedbackRepository,
  type LearnerFeedbackRepository,
} from "@dp/db/learner-feedback-repository";
import { createOpsNotificationSink } from "@dp/db/notifications-repository";
import type { DatabaseClient } from "@dp/db/types";
import type { OpsNotificationSink } from "@dp/domain/notifications";
import { requireEnvValue } from "@dp/env/schema";
import { createGateway } from "@dp/gateway/factory";
import { createTaskModelLadder } from "@dp/gateway/langchain-model";
import { createModelRegistry, registryOverridesFromEnv, type ModelRegistry } from "@dp/gateway/registry";
import { createUsageAccounting, type UsageAccounting } from "@dp/gateway/repositories/usage-repository";
import { createLogger, type Logger } from "@dp/observability/logger";
import { nullTelemetry, type Telemetry } from "@dp/observability/telemetry";
import { createLocalRepositoryBrowser } from "@dp/product-ops/browser";
import type { LearnerFeedbackSource } from "@dp/product-ops/feedback";
import { createProductOpsRepository, type ProductOpsRepository } from "@dp/product-ops/repository";
import type { WorkflowDeps } from "@dp/product-ops/workflow";

import type { WorkerEnv } from "./env";
import { createWorkerTelemetry, type WorkerTelemetry } from "./instruments";

/**
 * Wiring the worker's dependencies, once per process.
 *
 * One client, the secret key: every table the worker touches — the queue,
 * the product-ops tables, the accounting tables, the knowledge corpus — has
 * RLS enabled with no policy at all, and there is nobody else to act as. The
 * gateway is composed here exactly as the learner app composes it, so a
 * model call from a job is ledgered, budgeted and priced like one from a
 * turn.
 */
export interface WorkerContext {
  readonly env: WorkerEnv;
  readonly workerId: string;
  readonly logger: Logger;
  readonly telemetry: WorkerTelemetry;
  readonly client: DatabaseClient;
  readonly jobs: JobsRepository;
  readonly runs: ProductOpsRepository;
  readonly feedback: LearnerFeedbackRepository;
  readonly accounting: UsageAccounting;
  readonly registry: ModelRegistry;
  /**
   * Where the operators are told what needs a person: a run parked at a
   * gate, a job that gave up, a budget closing. Never throws, never awaited
   * for the job's sake.
   */
  readonly notifications: OpsNotificationSink;
  /** The product-ops workflow's dependencies, with the checkout if there is one. */
  readonly workflow: WorkflowDeps;
}

/**
 * The aggregate as the research stage reads it: a value or null, never a
 * throw, because a scan whose feedback cannot be read is still a scan.
 */
function feedbackSource(feedback: LearnerFeedbackRepository, logger: Logger): LearnerFeedbackSource {
  return {
    async summary(days) {
      const outcome = await feedback
        .summary({ days: Math.min(days, FEEDBACK_WINDOW_DAYS * 12) })
        .catch(() => null);
      if (outcome === null || !outcome.ok) {
        logger.warn("productops.feedback_unavailable", {});
        return null;
      }
      return outcome.data;
    },
  };
}

export function createSecretClient(env: WorkerEnv): DatabaseClient {
  const url = requireEnvValue(env.app.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  const secretKey = requireEnvValue(env.app.SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY");

  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as DatabaseClient;
}

export function createWorkerContext(env: WorkerEnv, telemetry: Telemetry = nullTelemetry): WorkerContext {
  const workerId = env.worker.WORKER_ID ?? `${hostname()}-${process.pid}`;
  const logger = createLogger({
    base: { service: "worker", environment: env.app.NODE_ENV, workerId },
    // Every line the sink sees also reaches the OTLP logs pipeline, already
    // redacted, when telemetry is on.
    emit: telemetry.logEmitter,
  });
  const client = createSecretClient(env);
  const runs = createProductOpsRepository(client);
  const feedback = createLearnerFeedbackRepository(client);
  const accounting = createUsageAccounting(client, logger);
  const registry = createModelRegistry(registryOverridesFromEnv(env.app));
  const notifications = createOpsNotificationSink(client, { logger });

  // A path is not a checkout. The image names one for the coder to clone
  // into; a process that serves only the jobs queue finds nothing there and
  // must say so rather than plan against an empty directory.
  const configured = env.worker.REPO_CHECKOUT_PATH;
  const checkout = configured && existsSync(join(configured, ".git")) ? configured : undefined;

  return {
    env,
    workerId,
    logger,
    telemetry: createWorkerTelemetry(telemetry.tracer, telemetry.meter),
    client,
    jobs: createJobsRepository(client),
    runs,
    feedback,
    accounting,
    registry,
    notifications,
    workflow: {
      runs,
      // The same alert sink the learner app's gateway holds: a stage that
      // spends the product past its daily mark is told about just the same.
      gateway: createGateway(client, env.app, logger, { alerts: notifications }),
      models: (context) => createTaskModelLadder({ env: env.app, accounting, logger }, context),
      // The planner reads the checkout this process was given. No checkout,
      // no browser, and the planning stage says so rather than guessing.
      browser: checkout ? createLocalRepositoryBrowser({ root: checkout }) : undefined,
      feedback: feedbackSource(feedback, logger),
      logger,
    },
  };
}
