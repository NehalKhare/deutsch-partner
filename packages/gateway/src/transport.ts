/**
 * What a provider looks like from inside the gateway.
 *
 * Narrow on purpose. The gateway's guarantees — ceilings, budgets, accounting,
 * redaction, retries — hold because there is exactly one shape a provider can
 * present and exactly one module that implements it per provider. A transport
 * knows how to make a request and report usage; it does not decide whether the
 * request should happen.
 */

import type { ReasoningEffort } from "./registry";
import type { WebSearch } from "@dp/domain/tasks";

/**
 * One source a provider says it actually consulted.
 *
 * Read from the provider's own annotations rather than from anything the model
 * wrote into its reply. A model asked to cite a source can invent one, and on
 * a product proposal the citations are the part a reviewer trusts most.
 */
export interface Citation {
  readonly url: string;
  readonly title: string | null;
}

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
  /**
   * The web search this task is permitted, or null for the great majority that
   * is none.
   *
   * Required rather than optional, and null rather than absent, because search
   * results are billed per result: a transport that could silently default
   * this would be a transport that could spend money the routing table never
   * granted. The gateway reads it from the table; nothing else may set it.
   */
  readonly webSearch: WebSearch | null;
  /**
   * The tier's reasoning effort, from the registry, or null to let the model
   * decide. Optional so that a request built without a registry in hand is
   * still a request.
   */
  readonly reasoningEffort?: ReasoningEffort | null;
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
  /**
   * Whether the provider stopped the reply at the output ceiling rather than
   * at the model's own end. Optional on the way in; the gateway treats absence
   * as "finished", and a structured caller treats true as "no object", because
   * a JSON object cut off mid-array is not one.
   */
  readonly truncated?: boolean;
  /**
   * What the provider says it consulted. Optional on the way in — most
   * transports and most calls have nothing to report — and normalised to an
   * array by the gateway, so a caller never has to tell "no citations" from "a
   * transport that does not do citations".
   */
  readonly citations?: readonly Citation[];
}

export interface StreamResponse {
  readonly chunks: AsyncIterable<string>;
  /** Available once the stream is exhausted; null before that. */
  usage(): ProviderUsage | null;
  firstTokenMs(): number | null;
  /**
   * The provider's own word for why it stopped, once the stream is done —
   * "length" when its ceiling cut the reply, which the guard cannot see
   * when the ceiling was spent on reasoning rather than on text. Optional
   * so a transport that does not report one is still a transport.
   */
  finishReason?(): string | null;
}

export interface ModelTransport {
  complete(request: ModelRequest): Promise<CompletionResponse>;
  stream(request: ModelRequest): Promise<StreamResponse>;
}
