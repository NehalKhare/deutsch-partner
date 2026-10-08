import { createFxRateService } from "./fx";
import { createModelGateway, type ModelGateway } from "./gateway";
import { createOpenRouterTransport } from "./openrouter";
import { createModelRegistry, registryOverridesFromEnv } from "./registry";
import { requireEnvValue, type AppEnv } from "@dp/env/schema";
import { createLogger, type Logger } from "@dp/observability/logger";
import { createUsageAccounting } from "./repositories/usage-repository";
import type { DatabaseClient } from "@dp/db/types";
import type { OpsNotificationSink } from "@dp/domain/notifications";

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
export interface GatewayOptions {
  /** Where the global daily budget's thresholds are reported. Optional. */
  readonly alerts?: OpsNotificationSink;
}

export function createGateway(
  client: DatabaseClient,
  env: AppEnv,
  logger?: Logger,
  options: GatewayOptions = {},
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
    ...(options.alerts ? { alerts: options.alerts } : {}),
  });
}
