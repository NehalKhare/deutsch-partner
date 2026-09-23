import { z } from "zod";

import { jobQueueSchema } from "@dp/domain/jobs";
import { parseEnv, type AppEnv } from "@dp/env/schema";

/**
 * The worker's environment: the shared schema plus what only a worker needs.
 *
 * This is the one file in the worker that reads process.env. Everything else
 * receives a validated object.
 */

const workerSchema = z.object({
  /** Comma-separated. A process that drains "coder" needs a checkout and a token. */
  WORKER_QUEUES: z
    .string()
    .default("jobs")
    .transform((value) => value.split(",").map((part) => part.trim()).filter(Boolean))
    .pipe(z.array(jobQueueSchema).min(1)),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  /**
   * How many of the slow kinds (a run being driven, a build, the corpus
   * ingest) this process holds at once. The fast kinds are never counted
   * against it; capped by WORKER_CONCURRENCY where the loop reads it.
   */
  WORKER_SLOW_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  WORKER_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  /** How long a claim holds before another worker may take the job over. */
  WORKER_LOCK_SECONDS: z.coerce.number().int().min(15).max(3_600).default(90),
  WORKER_ID: z.string().min(1).max(120).optional(),
  /** A checkout of GITHUB_REPOSITORY, for planning and for cutting worktrees. */
  REPO_CHECKOUT_PATH: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
});

export type WorkerSettings = z.infer<typeof workerSchema>;

export interface WorkerEnv {
  readonly app: AppEnv;
  readonly worker: WorkerSettings;
}

export function workerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  const populated = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  // No publishable key: the worker serves no browser. A model key, because
  // running stages is what it is for.
  const app = parseEnv(populated, {
    productionRequired: [
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SECRET_KEY",
      "OPENROUTER_API_KEY",
      "LOG_PSEUDONYM_SALT",
    ],
  });
  const worker = workerSchema.parse(populated);

  if (worker.WORKER_QUEUES.includes("coder")) {
    for (const key of ["GITHUB_TOKEN", "GITHUB_REPOSITORY"] as const) {
      if (app[key] === undefined) {
        throw new Error(`${key} is required when WORKER_QUEUES includes "coder"`);
      }
    }
    if (worker.REPO_CHECKOUT_PATH === undefined) {
      throw new Error('REPO_CHECKOUT_PATH is required when WORKER_QUEUES includes "coder"');
    }
  }

  return { app, worker };
}
