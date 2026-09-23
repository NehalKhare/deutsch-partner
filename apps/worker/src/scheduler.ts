import { randomUUID } from "node:crypto";

import type { JobKind, JobPayload } from "@dp/domain/jobs";
import { jobPayloadSchema } from "@dp/domain/jobs";

/**
 * The scheduled jobs, as an in-process clock that enqueues.
 *
 * Every worker that serves the "jobs" queue ticks this once a minute and
 * enqueues whatever is due. Two workers ticking at once collide on the queue's
 * per-kind deduplication and one insert wins; a job that finished between two
 * replicas' ticks may run twice, and every scheduled job is idempotent — the
 * rate is asked for at most once a day, a snapshot is a dated row, a purge is
 * a bounded delete, a reconcile deduplicates per run — so the duplicate costs
 * a query and nothing else. A durable scheduler (pg_cron) is the documented
 * next step if the replicas grow.
 */

export interface Schedule {
  readonly kind: JobKind;
  readonly everyMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SCHEDULES: readonly Schedule[] = [
  { kind: "productops.reconcile", everyMs: 5 * MINUTE },
  { kind: "fx.refresh", everyMs: HOUR },
  { kind: "pricing.snapshot", everyMs: DAY },
  { kind: "checkpoints.prune", everyMs: DAY },
  { kind: "ratelimit.purge", everyMs: HOUR },
  // Hourly rather than daily: the calendar is the operator's view of money
  // being spent right now, and a rollup rebuilt once a night means today is
  // blank on the screen that exists to notice today going wrong.
  { kind: "cost.rollup", everyMs: HOUR },
];

/** Which kinds are due, given when each was last enqueued. Pure. */
export function dueKinds(
  lastEnqueuedAt: ReadonlyMap<JobKind, number>,
  now: number,
  schedules: readonly Schedule[] = SCHEDULES,
): readonly JobKind[] {
  return schedules
    .filter((schedule) => {
      const last = lastEnqueuedAt.get(schedule.kind);
      return last === undefined || now - last >= schedule.everyMs;
    })
    .map((schedule) => schedule.kind);
}

/** The payload a scheduled kind runs with. Defaults, nothing else. */
export function scheduledPayload(kind: JobKind): JobPayload {
  return jobPayloadSchema.parse({ kind, correlationId: randomUUID(), source: "scheduler" });
}

export interface SchedulerDeps {
  readonly enqueue: (payload: JobPayload) => Promise<unknown>;
  readonly now?: () => number;
  readonly schedules?: readonly Schedule[];
}

export function createScheduler(deps: SchedulerDeps) {
  const now = deps.now ?? (() => Date.now());
  const lastEnqueuedAt = new Map<JobKind, number>();

  return {
    async tick(): Promise<readonly JobKind[]> {
      const at = now();
      const due = dueKinds(lastEnqueuedAt, at, deps.schedules);
      for (const kind of due) {
        await deps.enqueue(scheduledPayload(kind));
        lastEnqueuedAt.set(kind, at);
      }
      return due;
    },
  };
}
