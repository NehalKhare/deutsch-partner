import type { JobPayload } from "@dp/domain/jobs";
import { TIERS } from "@dp/domain/tasks";
import { fetchOpenRouterModelPricing } from "@dp/gateway/openrouter-models";
import { createPricingSnapshots } from "@dp/gateway/repositories/usage-repository";

import type { JobHandler } from "./types";

type PricingSnapshot = Extract<JobPayload, { kind: "pricing.snapshot" }>;

/**
 * Snapshots the provider's price list for every model the registry names.
 *
 * The fallback the budget gate estimates from, and the price a provider that
 * went quiet about cost would be recorded at. Prices are read, dated and
 * stored; never written into code.
 */
export const snapshotPricing: JobHandler<PricingSnapshot> = async (_payload, context, run) => {
  const modelIds = new Set<string>();
  for (const tier of TIERS) {
    const entry = context.registry.forTier(tier);
    modelIds.add(entry.modelId);
    for (const fallback of entry.fallbacks) modelIds.add(fallback);
  }

  const fetched = await fetchOpenRouterModelPricing({
    modelIds: [...modelIds],
    appUrl: context.env.app.APP_URL,
    appName: context.env.app.APP_NAME,
  });

  if (!fetched.ok) {
    run.logger.warn("pricing.snapshot_unavailable", { reason: fetched.reason, status: fetched.status });
    return { status: "retry", errorCode: `provider_${fetched.reason}` };
  }

  const written = await createPricingSnapshots(context.client).save(fetched.rates);
  if (!written.ok) return { status: "retry", errorCode: "store_unavailable" };

  run.logger.info("pricing.snapshot_stored", {
    written: written.written,
    missing: fetched.missing,
  });

  return { status: "done", detail: { written: written.written, missing: fetched.missing } };
};
