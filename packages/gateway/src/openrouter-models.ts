import { z } from "zod";

import type { ModelRate } from "./pricing";

/**
 * The provider's price list, for the pricing snapshot job.
 *
 * The one call in this package that is not a model call: a GET of the model
 * catalogue, so that `model_pricing_snapshots` holds a dated rate for every
 * model the registry names. OpenRouter reports cost inline on every
 * generation, which is what a ledger row prefers; the snapshot is the
 * fallback the budget gate estimates from before dispatch and the price a
 * provider that went quiet about cost would be recorded at. Without it that
 * provider would be recorded as free.
 *
 * Prices arrive as strings of dollars per token. They are parsed, never
 * written down here: a literal is a figure that stops being true with
 * nothing failing.
 */

const MODELS_URL = "https://openrouter.ai/api/v1/models";

const modelSchema = z.object({
  id: z.string().min(1),
  pricing: z
    .object({
      prompt: z.coerce.number().min(0),
      completion: z.coerce.number().min(0),
    })
    .partial(),
});

const catalogueSchema = z.object({ data: z.array(z.unknown()) });

export interface FetchModelPricingOptions {
  /** The models worth snapshotting: the registry's ids and their fallbacks. */
  readonly modelIds: readonly string[];
  readonly appUrl: string;
  readonly appName: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

export type ModelPricingFetch =
  | { readonly ok: true; readonly rates: readonly ModelRate[]; readonly missing: readonly string[] }
  | { readonly ok: false; readonly reason: "unreachable" | "bad_status" | "malformed"; readonly status?: number };

export async function fetchOpenRouterModelPricing(
  options: FetchModelPricingOptions,
): Promise<ModelPricingFetch> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);

  let response: Response;
  try {
    response = await fetchImpl(MODELS_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "HTTP-Referer": options.appUrl,
        "X-Title": options.appName,
      },
      signal: controller.signal,
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) return { ok: false, reason: "bad_status", status: response.status };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const catalogue = catalogueSchema.safeParse(body);
  if (!catalogue.success) return { ok: false, reason: "malformed" };

  const wanted = new Set(options.modelIds);
  const fetchedAt = (options.now ?? (() => new Date()))();
  const rates: ModelRate[] = [];

  for (const raw of catalogue.data.data) {
    // One malformed entry is the provider's problem with one model, not a
    // reason to record nothing for the others.
    const model = modelSchema.safeParse(raw);
    if (!model.success || !wanted.has(model.data.id)) continue;
    const { prompt, completion } = model.data.pricing;
    if (prompt === undefined || completion === undefined) continue;

    rates.push({
      provider: "openrouter",
      modelId: model.data.id,
      inputRate: prompt,
      outputRate: completion,
      currency: "USD",
      fetchedAt,
    });
  }

  const found = new Set(rates.map((rate) => rate.modelId));
  return { ok: true, rates, missing: options.modelIds.filter((id) => !found.has(id)) };
}
