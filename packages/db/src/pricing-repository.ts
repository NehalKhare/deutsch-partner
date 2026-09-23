import { z } from "zod";

import { decodeRow } from "./result";
import type { RepositoryResult } from "./errors";
import type { DatabaseClient } from "./types";

/**
 * The price list and the euro rate, from the operator's side.
 *
 * Read-only. Both tables are written by the worker's snapshot jobs from what
 * the provider and the rate source published, stamped with when they were
 * asked; an operator can ask for a fresh snapshot but never type a figure in
 * (the no-price-literal rule, AGENTS.md). Prices are for pre-flight
 * estimation only, so nothing on this side restates what a call cost.
 */

const numeric = z.coerce.number();

const perTokenSchema = {
  inputUsdPerToken: numeric.min(0),
  outputUsdPerToken: numeric.min(0),
};

const modelSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
  currency: z.string(),
  ...perTokenSchema,
  fetchedAt: z.coerce.date(),
  snapshots: z.coerce.number().int().min(1),
  /** The newest snapshot whose price differed from this one; null if it never moved. */
  previous: z.object({ ...perTokenSchema, fetchedAt: z.coerce.date() }).nullable(),
});

export type ModelPrice = z.infer<typeof modelSchema>;

const fxSchema = z.object({
  rate: numeric.positive(),
  rateDate: z.string(),
  source: z.string(),
  fetchedAt: z.coerce.date(),
});

export type FxSnapshot = z.infer<typeof fxSchema>;

export const pricingOverviewSchema = z.object({
  models: z.array(modelSchema).max(1_000),
  /** Newest first. */
  fx: z.array(fxSchema).max(366),
  lastFetchedAt: z.coerce.date().nullable(),
});

export type PricingOverview = z.infer<typeof pricingOverviewSchema>;

/** How many days of euro rates the page lists. */
export const FX_DAYS_SHOWN = 30;

export interface PricingRepository {
  overview(): Promise<RepositoryResult<PricingOverview>>;
}

export function createPricingRepository(client: DatabaseClient): PricingRepository {
  return {
    async overview() {
      const outcome = await client.rpc("pricing_overview", { p_fx_days: FX_DAYS_SHOWN });
      return decodeRow(outcome, pricingOverviewSchema);
    },
  };
}
