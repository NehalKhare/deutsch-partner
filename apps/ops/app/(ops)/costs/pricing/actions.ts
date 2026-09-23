"use server";

import { randomUUID } from "node:crypto";

import { refresh } from "next/cache";
import { z } from "zod";

import { createCostAdmin } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import { operatorForAction } from "@/lib/auth/require-operator";

/**
 * Asking the worker for fresh figures.
 *
 * This process has no egress to the provider or the rate source, and no model
 * key; the worker does the asking, on its schedule and on these buttons. Each
 * job is deduplicated by kind, so a held-down button queues once. The euro
 * rate's own button lives on the spend page and is reused here.
 */

async function admitOperator(route: string): Promise<string | null> {
  const operator = await operatorForAction(route);
  if (operator === null) return null;

  const decision = await limiterFor("ops_cost_admin").check(operator.hash);
  return decision.allowed ? operator.hash : null;
}

/** Fetches the provider's price list now, instead of at 04:13 tomorrow. */
export async function refreshPricingAction(): Promise<void> {
  const operator = await admitOperator("/costs/pricing/refresh");
  if (operator === null) return;

  const { jobs, logger } = createCostAdmin();
  const enqueued = await jobs.enqueue({
    payload: { kind: "pricing.snapshot", correlationId: randomUUID(), source: "ops" },
    requestedByHash: operator,
  });

  logger.info("pricing.snapshot_requested", {
    audit: true,
    userIdHash: operator,
    queued: enqueued.ok,
  });

  refresh();
}

/** The same bounds the job's own envelope sets. */
const sinceDaysSchema = z.coerce.number().int().min(1).max(3650);

/**
 * Rebuilds the daily rollup over the last N days.
 *
 * For a window the hourly schedule would not redo on its own — a backfill
 * after an outage, or a day the ledger gained rows for late. Idempotent per
 * day, so asking twice costs a rebuild and nothing else.
 */
export async function rebuildCostRollupAction(formData: FormData): Promise<void> {
  const operator = await admitOperator("/costs/pricing/rollup");
  if (operator === null) return;

  const sinceDays = sinceDaysSchema.safeParse(formData.get("sinceDays"));
  if (!sinceDays.success) return;

  const { jobs, logger } = createCostAdmin();
  const enqueued = await jobs.enqueue({
    payload: {
      kind: "cost.rollup",
      sinceDays: sinceDays.data,
      correlationId: randomUUID(),
      source: "ops",
    },
    requestedByHash: operator,
  });

  logger.info("cost.rollup_requested", {
    audit: true,
    userIdHash: operator,
    sinceDays: sinceDays.data,
    queued: enqueued.ok,
  });

  refresh();
}
