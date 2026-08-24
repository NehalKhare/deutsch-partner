import type { AppEnv } from "@/lib/env/schema";

export interface TracingConfig {
  readonly enabled: boolean;
  readonly project: string;
  readonly endpoint?: string;
  readonly apiKey?: string;
}

/**
 * Resolves LangSmith tracing configuration.
 *
 * The key is withheld unless tracing is actually enabled, so that a key left
 * in the environment of an untraced deployment is never handed to a client
 * that might use it.
 */
export function resolveTracingConfig(env: AppEnv): TracingConfig {
  if (!env.LANGSMITH_TRACING) {
    return { enabled: false, project: env.LANGSMITH_PROJECT };
  }

  return {
    enabled: true,
    project: env.LANGSMITH_PROJECT,
    endpoint: env.LANGSMITH_ENDPOINT,
    apiKey: env.LANGSMITH_API_KEY,
  };
}
