import { createFxRateService } from "@/lib/ai/gateway/fx";
import { createModelGateway, type ModelGateway } from "@/lib/ai/gateway/gateway";
import { createOpenRouterTransport } from "@/lib/ai/gateway/openrouter";
import { createModelRegistry, registryOverridesFromEnv } from "@/lib/ai/gateway/registry";
import { requireEnvValue, type AppEnv } from "@/lib/env/schema";
import { createLogger, type Logger } from "@/lib/observability/logger";
import { createUsageAccounting } from "@/repositories/usage-repository";
import type { DatabaseClient } from "@/repositories/types";

/**
 * The composition root.
 *
 * Assembling the gateway is deliberately one function, so a call site cannot
 * assemble a partial one — a gateway missing its ledger or its budget source
 * would still compile and would still make calls.
 *
 * The database client is a parameter rather than constructed here. The
 * accounting tables have RLS enabled with no policy, so this needs the secret
 * key client (security-observability-guardrails.md S4), and making that an
 * explicit argument keeps the privileged decision visible at the call site
 * instead of buried in a factory.
 */
export function createGateway(
  client: DatabaseClient,
  env: AppEnv,
  logger?: Logger,
): ModelGateway {
  // Asserted at the point of use rather than at boot: development and test
  // boot without it, and only this path actually needs it.
  const apiKey = requireEnvValue(env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY");

  const accounting = createUsageAccounting(client, logger);
  const resolved =
    logger ??
    createLogger({
      base: { service: "model-gateway", environment: env.NODE_ENV },
    });

  return createModelGateway({
    registry: createModelRegistry(registryOverridesFromEnv(env)),
    transport: createOpenRouterTransport({
      apiKey,
      appUrl: env.APP_URL,
      appName: env.APP_NAME,
    }),
    ledger: accounting,
    budgets: accounting,
    fx: createFxRateService(accounting, {
      logger: resolved,
      bootstrap: env.FX_EUR_PER_USD_BOOTSTRAP
        ? { eurPerUsd: env.FX_EUR_PER_USD_BOOTSTRAP, source: "configured" }
        : undefined,
    }),
    pricing: accounting,
    logger: resolved,
  });
}
