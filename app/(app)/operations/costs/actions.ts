"use server";

import { refresh } from "next/cache";

import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { isOperator } from "@/lib/auth/operator";
import { actionLogger } from "@/lib/api/composition";
import { ensureDailyRate } from "@/lib/ops/fx-refresh";
import { createSecretKeySupabaseClient } from "@/lib/supabase/server-client";
import { createFxRateSnapshots } from "@/repositories/usage-repository";
import type { DatabaseClient } from "@/repositories/types";

/**
 * Asks the exchange rate source again, now.
 *
 * The page already reads it once a day on its own; this is the control for the
 * rest of the day — the source publishes in the afternoon, and an operator
 * looking at a figure converted at yesterday's rate should be able to get
 * today's without waiting for a cron.
 *
 * It reaches the rate table through the secret key, which bypasses row level
 * security, so the operator check here is the only thing standing in front of
 * it. It is repeated rather than inherited from the page: an action is its own
 * entry point and is reachable without ever rendering the page.
 *
 * Nothing is corrected retrospectively. A newer rate changes what the
 * dashboard converts unpriced rows at from here on; every stored euro figure
 * stays exactly as it was written.
 */
export async function refreshFxRateAction(): Promise<void> {
  const learnerId = await requireAuthenticatedUserId();
  // Silently, and without saying whether there was anything to refuse.
  if (!isOperator(learnerId)) return;

  const client = createSecretKeySupabaseClient() as unknown as DatabaseClient;

  const outcome = await ensureDailyRate(
    { snapshots: createFxRateSnapshots(client), logger: actionLogger() },
    { force: true },
  );

  actionLogger().info("fx.refresh_requested", { status: outcome.status });

  refresh();
}
