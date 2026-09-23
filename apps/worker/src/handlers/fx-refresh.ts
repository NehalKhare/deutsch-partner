import type { JobPayload } from "@dp/domain/jobs";
import { createFxRateSnapshots } from "@dp/gateway/repositories/usage-repository";

import { ensureDailyRate } from "../fx/fx-refresh";
import type { JobHandler } from "./types";

type FxRefresh = Extract<JobPayload, { kind: "fx.refresh" }>;

/** Snapshots the euro rate the ledger prices in, at most once a day unless forced. */
export const refreshFxRate: JobHandler<FxRefresh> = async (payload, context, run) => {
  const outcome = await ensureDailyRate(
    { snapshots: createFxRateSnapshots(context.client), logger: run.logger },
    { force: payload.force },
  );

  run.logger.info("fx.refresh_ran", { status: outcome.status, forced: payload.force });

  if (outcome.status === "not_stored") return { status: "retry", errorCode: "store_unavailable" };
  // A source that could not be reached is tried again on the next schedule;
  // the last known rate stands in the meantime.
  return { status: "done", detail: { status: outcome.status } };
};
