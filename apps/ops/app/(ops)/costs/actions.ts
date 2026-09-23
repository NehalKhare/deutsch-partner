"use server";

import { randomUUID } from "node:crypto";

import { refresh } from "next/cache";

import { createProductOpsReader } from "@/lib/api/composition";
import { operatorForAction } from "@/lib/auth/require-operator";

/**
 * Asks the exchange rate source again, now.
 *
 * The worker reads it once a day on its own; this is the control for the rest
 * of the day — the source publishes in the afternoon, and an operator looking
 * at a figure converted at yesterday's rate should be able to get today's
 * without waiting for the schedule.
 *
 * The operator check is repeated rather than inherited from the page: an
 * action is its own entry point and is reachable without ever rendering the
 * page.
 *
 * Nothing is corrected retrospectively. A newer rate changes what the
 * dashboard converts unpriced rows at from here on; every stored euro figure
 * stays exactly as it was written.
 */
export async function refreshFxRateAction(): Promise<void> {
  // Silently, and without saying whether there was anything to refuse.
  const operator = await operatorForAction("/costs/refresh");
  if (!operator) return;

  // The worker asks the source; this process has no egress of its own. The
  // job is deduplicated, so a held-down button asks once.
  const { jobs, logger } = createProductOpsReader();
  const enqueued = await jobs.enqueue({
    payload: { kind: "fx.refresh", force: true, correlationId: randomUUID(), source: "ops" },
    requestedByHash: operator.hash,
  });

  logger.info("fx.refresh_requested", {
    audit: true,
    userIdHash: operator.hash,
    queued: enqueued.ok,
  });

  refresh();
}
