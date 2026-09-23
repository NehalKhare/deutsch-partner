import type { JobPayload } from "@dp/domain/jobs";
import type { Logger } from "@dp/observability/logger";

import type { WorkerContext } from "../composition";

/**
 * How a handler reports. A code, never a message: the queue stores it and an
 * operator reads it, and a provider's message can quote a prompt back.
 */
export type HandlerOutcome =
  | { readonly status: "done"; readonly detail?: Record<string, unknown> }
  /** Worth trying again later: the store or the provider was unavailable. */
  | { readonly status: "retry"; readonly errorCode: string }
  /** Never going to work as asked. */
  | { readonly status: "failed"; readonly errorCode: string };

export interface JobRun {
  readonly jobId: number;
  readonly attempt: number;
  /** A logger already carrying the job's ids. */
  readonly logger: Logger;
}

export type JobHandler<P extends JobPayload = JobPayload> = (
  payload: P,
  context: WorkerContext,
  run: JobRun,
) => Promise<HandlerOutcome>;
