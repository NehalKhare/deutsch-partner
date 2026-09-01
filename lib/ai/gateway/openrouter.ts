import { z } from "zod";

import type {
  CompletionResponse,
  ModelRequest,
  ModelTransport,
  ProviderUsage,
  StreamResponse,
} from "@/lib/ai/gateway/transport";

/**
 * The OpenRouter transport.
 *
 * The only module in the application that opens a connection to a model. It
 * makes the request and reports what came back; it decides nothing about
 * whether the request should have been made, which is the gateway's job.
 *
 * Two things it is careful about. The output ceiling is always sent — omitting
 * it hands the decision to whichever model the router picked. And usage
 * accounting is always requested, so the ledger records what was actually
 * charged for the generation that actually ran rather than an estimate against
 * a model that may have been substituted.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterOptions {
  readonly apiKey: string;
  /** Sent as the referer OpenRouter attributes traffic to. Not a secret. */
  readonly appUrl: string;
  readonly appName: string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Parsed defensively. A provider response is untrusted input like any other,
 * and a shape change should surface as a typed failure rather than as
 * undefined flowing into a ledger row.
 */
const usageSchema = z
  .object({
    prompt_tokens: z.number().int().min(0).optional(),
    completion_tokens: z.number().int().min(0).optional(),
    cost: z.number().min(0).optional(),
    prompt_tokens_details: z
      .object({ cached_tokens: z.number().int().min(0).optional() })
      .optional(),
    completion_tokens_details: z
      .object({ reasoning_tokens: z.number().int().min(0).optional() })
      .optional(),
  })
  .loose();

const completionSchema = z
  .object({
    model: z.string().optional(),
    choices: z
      .array(z.object({ message: z.object({ content: z.string().nullish() }).optional() }).loose())
      .optional(),
    usage: usageSchema.optional(),
  })
  .loose();

const streamEventSchema = z
  .object({
    model: z.string().optional(),
    choices: z
      .array(z.object({ delta: z.object({ content: z.string().nullish() }).optional() }).loose())
      .optional(),
    usage: usageSchema.optional(),
  })
  .loose();

function toUsage(
  usage: z.infer<typeof usageSchema> | undefined,
  modelIdResolved: string,
): ProviderUsage {
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
    cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
    // Null rather than zero when the provider says nothing: unknown is not free,
    // and the gateway prices it from the cached snapshot instead.
    costUsd: usage?.cost ?? null,
    modelIdResolved,
  };
}

/**
 * The failure a caller sees. It carries the status and nothing else from the
 * wire: a provider's message can quote the prompt back, and the prompt is the
 * learner's own words.
 */
class OpenRouterError extends Error {
  constructor(readonly status: number) {
    super(`OpenRouter request failed with status ${status}`);
    this.name = "OpenRouterError";
  }
}

export function createOpenRouterTransport(
  options: OpenRouterOptions,
): ModelTransport {
  const call = options.fetchImpl ?? fetch;

  const headers = (): HeadersInit => ({
    // The key travels in the header and never in a URL, a body or a log line.
    authorization: `Bearer ${options.apiKey}`,
    "content-type": "application/json",
    "HTTP-Referer": options.appUrl,
    "X-Title": options.appName,
  });

  /**
   * The system message: one plain string, or — when the request is bound for
   * an Anthropic model and the caller marked a stable prefix — two text parts
   * with a cache_control breakpoint on the stable one. OpenRouter forwards
   * the marker to Anthropic, whose prompt cache then serves the marked prefix
   * at a tenth of the input price on every request inside the cache TTL; no
   * other provider is sent the marker. Below Anthropic's minimum cacheable
   * length the marker is a documented no-op, so it is never a surcharge.
   */
  const systemContent = (request: ModelRequest) => {
    const prefix = request.systemStablePrefix;
    if (
      prefix === null ||
      prefix.length === 0 ||
      !request.modelId.startsWith("anthropic/") ||
      !request.system.startsWith(prefix)
    ) {
      return request.system;
    }

    const rest = request.system.slice(prefix.length);
    return [
      { type: "text", text: prefix, cache_control: { type: "ephemeral" } },
      ...(rest.length > 0 ? [{ type: "text", text: rest }] : []),
    ];
  };

  const body = (request: ModelRequest, stream: boolean) =>
    JSON.stringify({
      model: request.modelId,
      messages: [
        { role: "system", content: systemContent(request) },
        { role: "user", content: request.user },
      ],
      // Layer 2 of the ceiling enforcement. Never omitted.
      max_tokens: request.maxOutputTokens,
      stream,
      // Returns the charged cost for this generation on the response.
      usage: { include: true },
      ...(request.structured ? { response_format: { type: "json_object" } } : {}),
    });

  return {
    async complete(request) {
      const response = await call(ENDPOINT, {
        method: "POST",
        headers: headers(),
        body: body(request, false),
        signal: request.signal,
      });

      if (!response.ok) throw new OpenRouterError(response.status);

      const parsed = completionSchema.safeParse(await response.json());
      const content = parsed.success
        ? parsed.data.choices?.[0]?.message?.content
        : undefined;

      if (!parsed.success || typeof content !== "string") {
        throw new Error("OpenRouter returned a malformed completion");
      }

      return {
        text: content,
        usage: toUsage(parsed.data.usage, parsed.data.model ?? request.modelId),
        firstTokenMs: null,
      } satisfies CompletionResponse;
    },

    async stream(request) {
      const started = Date.now();
      const response = await call(ENDPOINT, {
        method: "POST",
        headers: headers(),
        body: body(request, true),
        signal: request.signal,
      });

      if (!response.ok) throw new OpenRouterError(response.status);
      if (!response.body) throw new Error("OpenRouter returned no stream");

      let usage: ProviderUsage | null = null;
      let firstTokenMs: number | null = null;
      let resolvedModel = request.modelId;
      const source = response.body;

      async function* chunks(): AsyncGenerator<string, void, undefined> {
        const reader = source.getReader();
        const decoder = new TextDecoder();
        // Server-sent events arrive split at arbitrary byte boundaries, so a
        // partial event is held here until its terminator turns up.
        let buffer = "";
        let seenUsage: z.infer<typeof usageSchema> | undefined;

        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let boundary = buffer.indexOf("\n\n");
            while (boundary !== -1) {
              const event = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              boundary = buffer.indexOf("\n\n");

              for (const line of event.split("\n")) {
                if (!line.startsWith("data:")) continue;

                const payload = line.slice(5).trim();
                if (payload === "" || payload === "[DONE]") continue;

                let json: unknown;
                try {
                  json = JSON.parse(payload);
                } catch {
                  continue;
                }

                const parsed = streamEventSchema.safeParse(json);
                if (!parsed.success) continue;

                if (parsed.data.model) resolvedModel = parsed.data.model;
                if (parsed.data.usage) seenUsage = parsed.data.usage;

                const text = parsed.data.choices?.[0]?.delta?.content;
                if (typeof text === "string" && text.length > 0) {
                  firstTokenMs ??= Date.now() - started;
                  yield text;
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
          usage = toUsage(seenUsage, resolvedModel);
        }
      }

      return {
        chunks: chunks(),
        usage: () => usage,
        firstTokenMs: () => firstTokenMs,
      } satisfies StreamResponse;
    },
  };
}
