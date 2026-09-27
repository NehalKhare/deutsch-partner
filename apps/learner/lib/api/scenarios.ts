import { z } from "zod";

import {
  MAX_SCENARIO_QUERY_LENGTH,
  scenarioLevelSchema,
  scenarioTypeSchema,
  type ScenarioSummary,
} from "@dp/domain/scenario";
import type { PlanCode } from "@dp/domain/plans";
import { nonEmptyTextSchema } from "@dp/domain/primitives";
import type { EmbeddingService } from "@dp/gateway/embedding-service";
import { nullLogger, type Logger } from "@dp/observability/logger";
import type { ScenarioRepository } from "@dp/db/scenario-repository";

/**
 * The scenario search endpoint's logic, with the framework left outside.
 *
 * Same order as every endpoint (guardrails S5): the route authenticates and
 * rate limits, this validates, embeds the query through the gateway — the
 * one model call the endpoint makes, ledgered and cached like every other —
 * searches through the database function, and translates each failure into
 * the closed error set. A natural-language query is learner content, so it
 * is never logged; only counts and outcomes are.
 */

export const scenarioSearchRequestSchema = z.strictObject({
  query: nonEmptyTextSchema(MAX_SCENARIO_QUERY_LENGTH),
  type: scenarioTypeSchema.optional(),
  levels: z.array(scenarioLevelSchema).max(4).optional(),
  limit: z.number().int().min(1).max(24).default(12),
});

export type ScenarioSearchRequest = z.infer<typeof scenarioSearchRequestSchema>;

export const SCENARIO_ERRORS = [
  "unauthenticated",
  "invalid_body",
  "rate_limited",
  "not_found",
  "search_unavailable",
] as const;

export type ScenarioError = (typeof SCENARIO_ERRORS)[number];

/** Never a stack trace, never a provider message (guardrails S25). */
const RESPONSES: Readonly<Record<ScenarioError, { status: number; message: string }>> = {
  unauthenticated: { status: 401, message: "Please sign in to search scenarios." },
  invalid_body: { status: 400, message: "That search could not be run." },
  rate_limited: {
    status: 429,
    message: "You are searching very quickly. Give it a moment.",
  },
  not_found: { status: 404, message: "That scenario could not be found." },
  search_unavailable: {
    status: 503,
    message: "Scenario search is unavailable right now. Please try again shortly.",
  },
};

export const scenarioErrorResponse = (error: ScenarioError) => RESPONSES[error];

export interface ScenarioSearchDeps {
  /** Null when no embedding key is configured; search degrades, the app stands. */
  readonly embeddings: Pick<EmbeddingService, "embed"> | null;
  readonly scenarios: Pick<ScenarioRepository, "searchByVector">;
  readonly logger?: Logger;
}

export type ScenarioSearchResult =
  | { readonly ok: true; readonly results: ScenarioSummary[] }
  | { readonly ok: false; readonly error: ScenarioError; readonly detail?: string };

export async function handleScenarioSearch(
  body: unknown,
  identity: {
    readonly userIdHash: string;
    readonly requestId: string;
    /**
     * Resolved by the route from entitlement rows — required, so no route
     * forgets it. The embedding is charged to the learner's own allowance,
     * which is their plan's unless an operator set one of their own (spec S9).
     */
    readonly plan: PlanCode;
  },
  deps: ScenarioSearchDeps,
): Promise<ScenarioSearchResult> {
  const logger = deps.logger ?? nullLogger;

  const parsed = scenarioSearchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid_body",
      detail: parsed.error.issues.map((issue) => issue.path.join(".")).join(", "),
    };
  }

  if (!deps.embeddings) {
    logger.warn("scenario_search.disabled", {
      requestId: identity.requestId,
      reason: "no embedding key configured",
    });
    return { ok: false, error: "search_unavailable" };
  }

  const embedded = await deps.embeddings.embed([parsed.data.query], {
    requestId: identity.requestId,
    userIdHash: identity.userIdHash,
    plan: identity.plan,
  });

  const vector = embedded.ok ? embedded.data.embedded[0]?.embedding : undefined;
  if (!embedded.ok || !vector) {
    logger.error("scenario_search.embedding_failed", {
      requestId: identity.requestId,
      userIdHash: identity.userIdHash,
      failure: embedded.ok ? "empty_run" : embedded.failure,
    });
    return { ok: false, error: "search_unavailable" };
  }

  const found = await deps.scenarios.searchByVector(vector, {
    types: parsed.data.type ? [parsed.data.type] : null,
    levels: parsed.data.levels ?? null,
    limit: parsed.data.limit,
  });

  if (!found.ok) {
    logger.error("scenario_search.failed", {
      requestId: identity.requestId,
      userIdHash: identity.userIdHash,
      kind: found.error.kind,
    });
    return { ok: false, error: "search_unavailable" };
  }

  logger.info("scenario_search.completed", {
    requestId: identity.requestId,
    userIdHash: identity.userIdHash,
    resultCount: found.data.length,
    typeFilter: parsed.data.type ?? "all",
    cacheHit: embedded.data.cacheHits > 0,
  });

  return { ok: true, results: found.data };
}
