import type { JobPayload } from "@dp/domain/jobs";

import type { JobHandler } from "./types";

type Purge = Extract<JobPayload, { kind: "ratelimit.purge" }>;

/** Drops rate-limit windows that ended long ago. Just rows, otherwise. */
export const purgeRateLimits: JobHandler<Purge> = async (_payload, context, run) => {
  const outcome = await context.client.rpc("purge_rate_limit_buckets", { p_older_than: "1 day" });
  if (outcome.error) return { status: "retry", errorCode: "store_unavailable" };

  run.logger.info("ratelimit.purged", { purged: Number(outcome.data ?? 0) });
  return { status: "done", detail: { purged: Number(outcome.data ?? 0) } };
};
