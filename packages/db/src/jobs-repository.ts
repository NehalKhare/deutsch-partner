import { z } from "zod";

import {
  JOB_MAX_ATTEMPTS,
  dedupeKeyFor,
  jobKindSchema,
  jobPayloadSchema,
  jobQueueSchema,
  jobStatusSchema,
  queueFor,
  retryDelaySeconds,
  type JobPayload,
  type JobQueue,
} from "@dp/domain/jobs";

import { fail, mapDatabaseError, ok, repositoryError, type RepositoryResult } from "./errors";
import { decodeInput } from "./result";
import type { DatabaseClient } from "./types";

/**
 * The job queue, from both sides.
 *
 * The enqueuing side (the ops app, the scheduler, a command line) records a
 * request. The claiming side (the worker) takes the oldest runnable one,
 * keeps its lock alive while it works, and reports how it ended. Every
 * transition is one database function, so two workers never hold one job and
 * a crash never loses one: the lock expires and the row is back in the queue.
 *
 * Operator scope. Only ever constructed with the secret-key client.
 */


const jobRowSchema = z
  .object({
    id: z.coerce.number().int(),
    queue: jobQueueSchema,
    kind: jobKindSchema,
    payload: z.unknown(),
    status: jobStatusSchema,
    attempts: z.coerce.number().int(),
    max_attempts: z.coerce.number().int(),
    correlation_id: z.uuid(),
    requested_by_hash: z.string().nullable(),
    dedupe_key: z.string().nullable(),
    run_after: z.coerce.date(),
    lock_expires_at: z.coerce.date().nullable(),
    created_at: z.coerce.date(),
  })
  .transform((row) => ({
    id: row.id,
    queue: row.queue,
    kind: row.kind,
    /** Unvalidated: the worker parses it with the envelope schema. */
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    correlationId: row.correlation_id,
    requestedByHash: row.requested_by_hash,
    dedupeKey: row.dedupe_key,
    runAfter: row.run_after,
    lockExpiresAt: row.lock_expires_at,
    createdAt: row.created_at,
  }));

export type ClaimedJob = z.infer<typeof jobRowSchema>;

const enqueuedSchema = z.object({
  id: z.coerce.number().int(),
  created: z.boolean(),
});

export interface EnqueueRequest {
  readonly payload: JobPayload;
  /** The operator's pseudonym when a person asked. Never an id. */
  readonly requestedByHash?: string | null;
  /** Do not run before this. The scheduler uses it; an operator does not. */
  readonly runAfter?: Date;
}

export interface Enqueued {
  readonly id: number;
  /** False when an equivalent job was already queued or running. */
  readonly created: boolean;
  readonly queue: JobQueue;
}

export interface JobsRepository {
  enqueue(request: EnqueueRequest): Promise<RepositoryResult<Enqueued>>;
  /** Puts expired running jobs back in the queue. Returns how many. */
  requeueExpired(): Promise<RepositoryResult<number>>;
  claim(queue: JobQueue, worker: string, lockSeconds: number): Promise<RepositoryResult<ClaimedJob | null>>;
  heartbeat(jobId: number, worker: string, lockSeconds: number): Promise<RepositoryResult<boolean>>;
  complete(jobId: number, worker: string): Promise<RepositoryResult<boolean>>;
  /**
   * Records a failure as a code. Retries with backoff while attempts remain;
   * failed for good otherwise. Returns the status the job now has.
   */
  fail(
    jobId: number,
    worker: string,
    errorCode: string,
    attempt: number,
    options?: { readonly final?: boolean },
  ): Promise<RepositoryResult<"queued" | "failed">>;
}

const workerSchema = z.string().min(1).max(120);

/** Parses a payload that came from the envelope side, before it is stored. */
export function validateJobPayload(payload: unknown) {
  return jobPayloadSchema.safeParse(payload);
}

export function createJobsRepository(client: DatabaseClient): JobsRepository {
  return {
    async enqueue(request) {
      const parsed = decodeInput(request.payload, jobPayloadSchema);
      if (!parsed.ok) return parsed;
      const payload = parsed.data;
      const queue = queueFor(payload.kind);

      const outcome = await client.rpc("enqueue_job", {
        p_queue: queue,
        p_kind: payload.kind,
        p_payload: payload,
        p_correlation_id: payload.correlationId,
        p_requested_by_hash: request.requestedByHash ?? null,
        p_dedupe_key: dedupeKeyFor(payload),
        p_run_after: (request.runAfter ?? new Date()).toISOString(),
        p_max_attempts: JOB_MAX_ATTEMPTS,
      });
      if (outcome.error) return fail(mapDatabaseError(outcome.error));

      const row = enqueuedSchema.safeParse(outcome.data);
      if (!row.success) return fail(repositoryError("invalid_data"));

      return ok({ id: row.data.id, created: row.data.created, queue });
    },

    async requeueExpired() {
      const outcome = await client.rpc("requeue_expired_jobs");
      if (outcome.error) return fail(mapDatabaseError(outcome.error));
      const count = z.coerce.number().int().safeParse(outcome.data);
      return count.success ? ok(count.data) : fail(repositoryError("invalid_data"));
    },

    async claim(queue, worker, lockSeconds) {
      const who = decodeInput(worker, workerSchema);
      if (!who.ok) return who;

      const outcome = await client.rpc("claim_job", {
        p_queue: queue,
        p_worker: who.data,
        p_lock_seconds: lockSeconds,
      });
      if (outcome.error) return fail(mapDatabaseError(outcome.error));

      const rows = z.array(jobRowSchema).safeParse(outcome.data ?? []);
      if (!rows.success) return fail(repositoryError("invalid_data"));

      return ok(rows.data[0] ?? null);
    },

    async heartbeat(jobId, worker, lockSeconds) {
      const outcome = await client.rpc("heartbeat_job", {
        p_job_id: jobId,
        p_worker: worker,
        p_lock_seconds: lockSeconds,
      });
      if (outcome.error) return fail(mapDatabaseError(outcome.error));
      return ok(outcome.data === true);
    },

    async complete(jobId, worker) {
      const outcome = await client.rpc("complete_job", { p_job_id: jobId, p_worker: worker });
      if (outcome.error) return fail(mapDatabaseError(outcome.error));
      return ok(outcome.data === true);
    },

    async fail(jobId, worker, errorCode, attempt, options = {}) {
      const outcome = await client.rpc("fail_job", {
        p_job_id: jobId,
        p_worker: worker,
        p_error: errorCode,
        p_retry_in_seconds: retryDelaySeconds(attempt),
        p_final: options.final === true,
      });
      if (outcome.error) return fail(mapDatabaseError(outcome.error));
      const status = z.enum(["queued", "failed"]).safeParse(outcome.data);
      return status.success ? ok(status.data) : fail(repositoryError("invalid_data"));
    },
  };
}
