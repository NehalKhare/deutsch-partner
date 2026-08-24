import { z } from "zod";

import type {
  EmbeddingRequest,
  EmbeddingResponse,
  EmbeddingTransport,
} from "@/lib/ai/gateway/embeddings";

/**
 * The OpenRouter embeddings transport.
 *
 * Embeddings ride the same router as chat, so one key carries every model
 * call the text product makes. (This file's predecessor went direct to
 * OpenAI, from the days when OpenRouter served chat and completion only.)
 * The second and last file in the application that opens a connection to a
 * model provider for text; a CI gate names each transport and fails on an
 * unlisted one.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/embeddings";

export interface OpenRouterEmbeddingOptions {
  readonly apiKey: string;
  /** Sent as the referer OpenRouter attributes traffic to. Not a secret. */
  readonly appUrl?: string;
  readonly appName?: string;
  readonly fetchImpl?: typeof fetch;
}

const responseSchema = z
  .object({
    model: z.string().optional(),
    data: z
      .array(z.object({ index: z.number().int().min(0), embedding: z.array(z.number()) }))
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().min(0).optional(),
        // OpenRouter prices the call itself, in USD. A stated figure goes to
        // the ledger as-is; absence falls back to the pricing snapshot.
        cost: z.number().min(0).optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

class EmbeddingProviderError extends Error {
  constructor(readonly status: number) {
    super(`Embedding request failed with status ${status}`);
    this.name = "EmbeddingProviderError";
  }
}

export function createOpenRouterEmbeddingTransport(
  options: OpenRouterEmbeddingOptions,
): EmbeddingTransport {
  const call = options.fetchImpl ?? fetch;

  return {
    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
      const response = await call(ENDPOINT, {
        method: "POST",
        headers: {
          // The key travels in the header and never in a URL, a body or a log.
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
          ...(options.appUrl ? { "HTTP-Referer": options.appUrl } : {}),
          ...(options.appName ? { "X-Title": options.appName } : {}),
        },
        body: JSON.stringify({
          // The registry's vendor-qualified id, exactly as OpenRouter states it.
          model: request.modelId,
          input: request.texts,
          // Asked for explicitly: the stored column has a fixed width, and a
          // provider default that quietly changes would break every
          // comparison against everything already ingested.
          dimensions: request.dimensions,
        }),
        signal: request.signal,
      });

      if (!response.ok) throw new EmbeddingProviderError(response.status);

      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error("embedding provider returned a malformed response");
      }

      // Ordered by index rather than by arrival: the caller pairs vectors with
      // its own inputs positionally, and the API does not promise an order.
      const ordered = [...parsed.data.data].sort((a, b) => a.index - b.index);

      return {
        vectors: ordered.map((entry) => entry.embedding),
        usage: {
          inputTokens: parsed.data.usage?.prompt_tokens ?? 0,
          costUsd: parsed.data.usage?.cost ?? null,
          modelIdResolved: parsed.data.model ?? request.modelId,
        },
      };
    },
  };
}
