import "server-only";

import { after } from "next/server";

import { createEvaluator } from "@/lib/ai/evaluation";
import {
  createEmbeddingService,
  type EmbeddingService,
} from "@/lib/ai/gateway/embedding-service";
import {
  createEmbeddingGateway,
  embeddingSpecFor,
} from "@/lib/ai/gateway/embeddings";
import { createFxRateService } from "@/lib/ai/gateway/fx";
import { createGateway } from "@/lib/ai/gateway/factory";
import { createOpenRouterEmbeddingTransport } from "@/lib/ai/gateway/openrouter-embeddings";
import {
  createOpenRouterSpeechToText,
  createOpenRouterTextToSpeech,
} from "@/lib/ai/voice/openrouter";
import type {
  SpeechToTextProvider,
  TextToSpeechProvider,
} from "@/lib/ai/voice/providers";
import {
  createModelRegistry,
  registryOverridesFromEnv,
} from "@/lib/ai/gateway/registry";
import type { GraphDeps } from "@/lib/graph/nodes";
import { requireEnvValue, type AppEnv } from "@/lib/env/schema";
import { serverEnv } from "@/lib/env/server";
import { createLogger, type Logger } from "@/lib/observability/logger";
import { hashUserId } from "@/lib/observability/pseudonym";
import { gatewayFail } from "@/lib/ai/gateway/errors";
import {
  createRetriever,
  type GermanLearningRetriever,
} from "@/lib/retrieval/retriever";
import {
  createSecretKeySupabaseClient,
  createServerSupabaseClient,
} from "@/lib/supabase/server-client";
import { createTrainerModelLadder } from "@/lib/ai/gateway/langchain-model";
import { loadMcpTools } from "@/lib/trainer/mcp";
import type { TrainerDeps } from "@/lib/api/trainer";
import { createConversationRepository } from "@/repositories/conversation-repository";
import { createEmbeddingCache } from "@/repositories/ingestion-repository";
import { createGrammarRepository } from "@/repositories/grammar-repository";
import { createLearnerErrorRepository } from "@/repositories/learner-error-repository";
import { createMinedSessionRepository } from "@/repositories/mined-session-repository";
import { createLearnerRepository } from "@/repositories/learner-repository";
import { createPerformanceRepository } from "@/repositories/performance-repository";
import { createKnowledgeSearch } from "@/repositories/retrieval-repository";
import {
  createScenarioRepository,
  type ScenarioRepository,
} from "@/repositories/scenario-repository";
import { createUsageAccounting } from "@/repositories/usage-repository";
import type { DatabaseClient } from "@/repositories/types";
import { createVocabularyRepository } from "@/repositories/vocabulary-repository";

/**
 * Wiring one request's dependencies.
 *
 * Two clients, and the split is the point. Everything that touches a learner's
 * own rows runs on the request-scoped client, so Row Level Security decides
 * what is reachable and a bug here cannot reach another learner's thread. The
 * gateway runs on the secret-key client because the accounting tables have RLS
 * enabled with no policy and are reachable by nobody else.
 *
 * Nothing here is memoised across requests: the learner client carries a
 * session, and a cached one would serve the previous learner.
 */

/** The pseudonymous id used in logs and the ledger. Never the learner's id. */
export function pseudonymFor(learnerId: string): string {
  return hashUserId({
    userId: learnerId,
    salt: requireEnvValue(serverEnv().LOG_PSEUDONYM_SALT, "LOG_PSEUDONYM_SALT"),
  });
}

/** What a log line carries when the salt is not configured. */
export const PSEUDONYM_UNAVAILABLE = "unavailable";

/**
 * The pseudonym, or a marker saying there is not one.
 *
 * Used where the log line is a side effect of something the learner asked for
 * rather than the point of it. Refusing to delete a conversation because the
 * observability salt is unset would be an outage caused by the audit trail,
 * which is the wrong way round; the event is still written, without an
 * identity and saying as much.
 *
 * The gateway keeps the strict version: a ledger row with no learner on it
 * cannot be attributed later, so there it is worth failing for.
 */
export function pseudonymOrUnavailable(learnerId: string): string {
  try {
    return pseudonymFor(learnerId);
  } catch {
    return PSEUDONYM_UNAVAILABLE;
  }
}

/**
 * A logger for a Server Action.
 *
 * Actions have no request graph to hang one off, and a "use server" module may
 * not export anything but async functions, so the construction lives here with
 * the other composition.
 */
export function actionLogger(): Logger {
  return createLogger({
    base: { service: "actions", environment: serverEnv().NODE_ENV },
  });
}

/**
 * The retriever a deployment without an embedding key gets.
 *
 * Retrieval is the one node in the turn that is allowed to fail — the reply is
 * thinner and it still arrives, which is what the graph is written for. But
 * the transport was built eagerly and demanded its key at composition time, so
 * an unset embedding key took the whole conversation down before the graph
 * that knows how to degrade even existed. A missing optional capability must
 * not be able to do that to a required one.
 */
const RETRIEVAL_UNAVAILABLE: GermanLearningRetriever = {
  async retrieve() {
    return gatewayFail("provider_error", "retrieval is not configured");
  },
};

/**
 * The speech providers, or nothing when no key is configured.
 *
 * Nothing rather than a throw, for the same reason retrieval degrades: an
 * unset optional capability must not be able to take a required one down. The
 * routes turn a null into a plain "speaking is not available right now".
 *
 * Note what these do *not* pass through: the budget gate and the ledger. Voice
 * calls are model calls and by the project's own rule ought to be routed,
 * budgeted and accounted for like any other — this is a deliberate, and
 * temporary, exception. Until it is closed, the rate limits and the audio
 * bounds in lib/api/voice.ts are the only ceiling on voice spend.
 */
export interface VoiceProviders {
  readonly speechToText: SpeechToTextProvider;
  readonly textToSpeech: TextToSpeechProvider;
}

export function createVoiceProviders(): VoiceProviders | null {
  const env = serverEnv();
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const registry = createModelRegistry(registryOverridesFromEnv(env));
  const options = {
    apiKey,
    transcribeModelId: registry.forTier("stt").modelId,
    speechModelId: registry.forTier("tts").modelId,
  };

  return {
    speechToText: createOpenRouterSpeechToText(options),
    textToSpeech: createOpenRouterTextToSpeech(options),
  };
}

export interface RequestGraph {
  readonly deps: GraphDeps;
  readonly logger: Logger;
}

/**
 * The embedding service on its own, for endpoints that embed but never chat.
 *
 * `createRequestGraph` demands an OpenRouter key because a chat turn cannot
 * happen without one; scenario search can. Null when no embedding key is
 * configured, so the page still renders and the endpoint says "unavailable"
 * instead of the deployment failing to compose.
 */
function createEmbeddingServiceOrNull(
  env: AppEnv,
  operatorClient: DatabaseClient,
  logger: Logger,
): EmbeddingService | null {
  // One key, for everything. Embeddings ride OpenRouter like chat, and so
  // does speech now that its models are reachable there.
  const embeddingKey = env.OPENROUTER_API_KEY;
  if (!embeddingKey) return null;

  const registry = createModelRegistry(registryOverridesFromEnv(env));
  const embeddingEntry = registry.forTier("embedding");
  const accounting = createUsageAccounting(operatorClient, logger);

  const spec = embeddingSpecFor("retrieval.embedding", {
    timeoutMs: 15_000,
    dimensions: embeddingEntry.dimensions ?? 1536,
  });
  if (!spec.ok) throw new Error(`retrieval embedding spec: ${spec.detail}`);

  return createEmbeddingService({
    gateway: createEmbeddingGateway({
      registry,
      transport: createOpenRouterEmbeddingTransport({
        apiKey: embeddingKey,
        appUrl: env.APP_URL,
        appName: env.APP_NAME,
      }),
      ledger: accounting,
      budgets: accounting,
      fx: createFxRateService(accounting, {
        logger,
        bootstrap: env.FX_EUR_PER_USD_BOOTSTRAP
          ? { eurPerUsd: env.FX_EUR_PER_USD_BOOTSTRAP, source: "configured" }
          : undefined,
      }),
      pricing: accounting,
      logger,
    }),
    spec: spec.data,
    // The query cache is shared: two learners asking the same question embed
    // it once. It holds vectors of public corpus queries, never learner rows.
    cache: createEmbeddingCache(operatorClient),
    modelId: embeddingEntry.modelId,
  });
}

export interface ScenarioSearchGraph {
  readonly deps: {
    readonly embeddings: EmbeddingService | null;
    readonly scenarios: ScenarioRepository;
    readonly logger: Logger;
  };
  readonly logger: Logger;
}

/** Wiring for /api/scenarios: the embedding gateway and the scenario corpus. */
export async function createScenarioSearch(): Promise<ScenarioSearchGraph> {
  const env = serverEnv();
  const logger = createLogger({
    base: { service: "scenarios", environment: env.NODE_ENV },
  });

  // RLS applies. The corpus is read as the signed-in learner.
  const learnerClient =
    (await createServerSupabaseClient()) as unknown as DatabaseClient;
  // Bypasses RLS. Only the gateway's accounting and the embedding cache.
  const operatorClient =
    createSecretKeySupabaseClient() as unknown as DatabaseClient;

  const embeddings = createEmbeddingServiceOrNull(env, operatorClient, logger);
  if (!embeddings) {
    logger.warn("scenario_search.disabled", {
      reason: "no embedding key configured",
    });
  }

  return {
    logger,
    deps: {
      embeddings,
      scenarios: createScenarioRepository(learnerClient),
      logger,
    },
  };
}

export async function createRequestGraph(): Promise<RequestGraph> {
  const env = serverEnv();
  const logger = createLogger({
    base: { service: "chat", environment: env.NODE_ENV },
  });

  // RLS applies. Everything a learner owns is read and written through this.
  const learnerClient =
    (await createServerSupabaseClient()) as unknown as DatabaseClient;
  // Bypasses RLS. Only the gateway's accounting and the embedding cache.
  const operatorClient =
    createSecretKeySupabaseClient() as unknown as DatabaseClient;

  const gateway = createGateway(operatorClient, env, logger);
  const embeddings = createEmbeddingServiceOrNull(env, operatorClient, logger);

  if (!embeddings) {
    // Said once per request rather than once per turn-node, and at warn
    // because a deployment answering without its own corpus is a degraded
    // deployment, not a working one.
    logger.warn("retrieval.disabled", {
      reason: "no embedding key configured",
    });
  }

  return {
    logger,
    deps: {
      learners: createLearnerRepository(learnerClient),
      conversations: createConversationRepository(learnerClient),
      errors: createLearnerErrorRepository(learnerClient),
      vocabulary: createVocabularyRepository(learnerClient),
      // The tally rides the learner's own client: recording a turn stamps the
      // row from the verified session, and reading one is RLS-scoped.
      performance: createPerformanceRepository(learnerClient),
      retriever: embeddings
        ? createRetriever({
            search: createKnowledgeSearch(learnerClient, logger),
            embeddings,
            logger,
          })
        : RETRIEVAL_UNAVAILABLE,
      evaluator: createEvaluator({ gateway, logger }),
      gateway,
      logger,
    },
  };
}

/**
 * The Trainer's dependencies.
 *
 * A parallel assembly rather than an extension of createRequestGraph: the
 * chat graph drags an evaluator and a streaming gateway the trainer never
 * uses, and the trainer needs two things the chat graph does not expose —
 * the raw accounting bundle for its model's ledger callback, and the env for
 * the MCP endpoint. The client split is identical: every tool reads and
 * writes as the signed-in learner, and only the accounting rides the secret
 * key.
 */
export async function createTrainerGraph(): Promise<{
  readonly logger: Logger;
  readonly deps: TrainerDeps;
}> {
  const env = serverEnv();
  const logger = createLogger({
    base: { service: "trainer", environment: env.NODE_ENV },
  });

  // RLS applies. Every tool the agent holds is scoped to the signed-in learner.
  const learnerClient =
    (await createServerSupabaseClient()) as unknown as DatabaseClient;
  // Bypasses RLS. Ledger, budgets, pricing and FX — accounting only.
  const operatorClient =
    createSecretKeySupabaseClient() as unknown as DatabaseClient;

  const accounting = createUsageAccounting(operatorClient, logger);
  const embeddings = createEmbeddingServiceOrNull(env, operatorClient, logger);
  if (!embeddings) {
    logger.warn("trainer.retrieval_disabled", {
      reason: "no embedding key configured",
    });
  }

  return {
    logger,
    deps: {
      learners: createLearnerRepository(learnerClient),
      errors: createLearnerErrorRepository(learnerClient),
      vocabulary: createVocabularyRepository(learnerClient),
      performance: createPerformanceRepository(learnerClient),
      grammar: createGrammarRepository(learnerClient),
      retriever: embeddings
        ? createRetriever({
            search: createKnowledgeSearch(learnerClient, logger),
            embeddings,
            logger,
          })
        : RETRIEVAL_UNAVAILABLE,
      budgets: accounting,
      // The chat gateway's own transport, reused for the answer analyzer's
      // structured call — no new connection-opener, same ledger discipline.
      gateway: createGateway(operatorClient, env, logger),
      createModels: (context) =>
        createTrainerModelLadder({ env, accounting, logger }, context),
      loadMcp: (identity) => loadMcpTools(env, identity, logger),
      // The learner's own client again: the guard row is theirs, RLS applies.
      mined: createMinedSessionRepository(learnerClient),
      // Post-response work rides Next's after(). The callback form, so the
      // work does not even start until the response has gone out.
      schedule: (work) => after(work),
      logger,
    },
  };
}
