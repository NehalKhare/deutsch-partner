import { z } from "zod";

import { reviewActionSchema } from "./product-ops";

/**
 * The work the worker does, as the rows that ask for it.
 *
 * A job is a request recorded in Postgres by whoever wants the work done — an
 * operator's action, the scheduler, the reconciler, a command line — and
 * claimed by a worker that has nothing else to go on. The envelope is closed
 * and strict: a row the worker cannot parse is archived as invalid rather than
 * guessed at, because a queue is a boundary and what crosses it is untrusted
 * until validated.
 *
 * Every job carries a correlation id. For a run it is the run's own request
 * id, so a log line in the ops app, the row in the queue and every event the
 * worker writes to the timeline can be read as one story (guardrails S19).
 */

export const JOB_KINDS = [
  /** Drive one product-ops run from where it stands until it parks or ends. */
  "productops.drive",
  /** The coding half: plan, apply, verify and publish one approved proposal. */
  "productops.implement",
  /** Re-enqueue runs the server owns that nothing has touched for a while. */
  "productops.reconcile",
  /** Snapshot the euro rate the ledger prices in. */
  "fx.refresh",
  /** Snapshot the provider's price list for the models the registry names. */
  "pricing.snapshot",
  /** Retire the graph checkpoints of runs that ended a while ago. */
  "checkpoints.prune",
  /** Embed and store the knowledge corpus. */
  "ingest.knowledge",
  /** Drop rate-limit windows that ended long ago. */
  "ratelimit.purge",
  /** Rebuild the daily cost rollup the spend calendar reads. */
  "cost.rollup",
] as const;

export const jobKindSchema = z.enum(JOB_KINDS);
export type JobKind = z.infer<typeof jobKindSchema>;

export const JOB_SOURCES = ["ops", "scheduler", "reconciler", "cli"] as const;
export const jobSourceSchema = z.enum(JOB_SOURCES);
export type JobSource = z.infer<typeof jobSourceSchema>;

const envelopeBase = {
  correlationId: z.uuid(),
  source: jobSourceSchema,
};

export const jobPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("productops.drive"),
    runId: z.uuid(),
    /** The decision that woke a parked run, when one did. */
    review: reviewActionSchema.nullable().default(null),
    ...envelopeBase,
  }),
  z.strictObject({
    kind: z.literal("productops.implement"),
    proposalId: z.uuid(),
    ...envelopeBase,
  }),
  z.strictObject({ kind: z.literal("productops.reconcile"), ...envelopeBase }),
  z.strictObject({
    kind: z.literal("fx.refresh"),
    force: z.boolean().default(false),
    ...envelopeBase,
  }),
  z.strictObject({ kind: z.literal("pricing.snapshot"), ...envelopeBase }),
  z.strictObject({
    kind: z.literal("checkpoints.prune"),
    olderThanDays: z.number().int().min(7).max(365).default(30),
    ...envelopeBase,
  }),
  z.strictObject({
    kind: z.literal("ingest.knowledge"),
    only: z.enum(["derived", "files"]).nullable().default(null),
    force: z.boolean().default(false),
    ...envelopeBase,
  }),
  z.strictObject({ kind: z.literal("ratelimit.purge"), ...envelopeBase }),
  z.strictObject({
    kind: z.literal("cost.rollup"),
    /**
     * How many days back to rebuild, ending today. Null lets the database
     * decide, which is the scheduled case: it redoes the newest day it has
     * plus the one before, and backfills the whole ledger when the rollup is
     * empty. A number is for an operator who knows a window needs redoing.
     */
    sinceDays: z.number().int().min(1).max(3650).nullable().default(null),
    ...envelopeBase,
  }),
]);

export type JobPayload = z.infer<typeof jobPayloadSchema>;

export const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/**
 * The implementation job needs a checkout, a git identity and a great deal of
 * memory; everything else needs a database and a model key. Two queues, so a
 * `next build` inside a worktree never starves a research pass.
 */
export const JOB_QUEUES = ["jobs", "coder"] as const;
export const jobQueueSchema = z.enum(JOB_QUEUES);
export type JobQueue = z.infer<typeof jobQueueSchema>;

export function queueFor(kind: JobKind): JobQueue {
  return kind === "productops.implement" ? "coder" : "jobs";
}

/**
 * One job per run in flight. A second press of "nudge" while the first is
 * still queued or running is a no-op, and the reconciler can never pile up
 * behind an operator.
 */
export function dedupeKeyFor(payload: JobPayload): string | null {
  switch (payload.kind) {
    case "productops.drive":
      return `productops.drive:${payload.runId}`;
    case "productops.implement":
      return `productops.implement:${payload.proposalId}`;
    case "productops.reconcile":
    case "fx.refresh":
    case "pricing.snapshot":
    case "checkpoints.prune":
    case "ingest.knowledge":
    case "ratelimit.purge":
    case "cost.rollup":
      return payload.kind;
  }
}

/** How many times a job is tried before it is marked failed for good. */
export const JOB_MAX_ATTEMPTS = 5;

/** Exponential backoff, capped: 15s, 30s, 60s, 120s, 240s. */
export function retryDelaySeconds(attempt: number): number {
  return Math.min(15 * 2 ** Math.max(0, attempt - 1), 600);
}
