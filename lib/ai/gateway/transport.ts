/**
 * What a provider looks like from inside the gateway.
 *
 * Narrow on purpose. The gateway's guarantees — ceilings, budgets, accounting,
 * redaction, retries — hold because there is exactly one shape a provider can
 * present and exactly one module that implements it per provider. A transport
 * knows how to make a request and report usage; it does not decide whether the
 * request should happen.
 */

export interface ModelRequest {
  readonly modelId: string;
  readonly system: string;
  /**
   * The leading part of `system` that is byte-identical across requests for
   * the same task, or null when the caller makes no such promise. A transport
   * whose provider supports prefix caching may mark it; it never alters what
   * the model reads.
   */
  readonly systemStablePrefix: string | null;
  readonly user: string;
  /** Always sent to the provider. Layer 2 of the ceiling enforcement. */
  readonly maxOutputTokens: number;
  readonly signal: AbortSignal;
  /** The task expects a schema-validated object rather than free text. */
  readonly structured: boolean;
}

export interface ProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number | null;
  readonly cachedInputTokens: number | null;
  /** What the provider says the generation cost. Null when it does not say. */
  readonly costUsd: number | null;
  /** What the provider actually routed to, which is not always what was asked. */
  readonly modelIdResolved: string;
}

export interface CompletionResponse {
  readonly text: string;
  readonly usage: ProviderUsage;
  readonly firstTokenMs: number | null;
}

export interface StreamResponse {
  readonly chunks: AsyncIterable<string>;
  /** Available once the stream is exhausted; null before that. */
  usage(): ProviderUsage | null;
  firstTokenMs(): number | null;
}

export interface ModelTransport {
  complete(request: ModelRequest): Promise<CompletionResponse>;
  stream(request: ModelRequest): Promise<StreamResponse>;
}
