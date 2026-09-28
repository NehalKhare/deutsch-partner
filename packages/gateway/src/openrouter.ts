import { z } from "zod";

import type {
  Citation,
  CompletionResponse,
  ModelRequest,
  ModelTransport,
  ProviderUsage,
  StreamResponse,
} from "./transport";

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

/**
 * A source the web plugin says it read.
 *
 * Parsed leniently and per-item: a shape change in a citation must not lose
 * the reply that came with it, because the text is the expensive part. The url
 * is narrowed to http and https here rather than wherever it is eventually
 * rendered — these end up as links on an operator's page.
 */
const annotationSchema = z
  .object({
    type: z.string(),
    url_citation: z
      .object({
        url: z.string(),
        title: z.string().nullish(),
      })
      .loose()
      .optional(),
  })
  .loose();

const messageSchema = z
  .object({
    content: z.string().nullish(),
    annotations: z.array(z.unknown()).optional(),
  })
  .loose();

const completionSchema = z
  .object({
    model: z.string().optional(),
    choices: z.array(z.object({ message: messageSchema.optional() }).loose()).optional(),
    usage: usageSchema.optional(),
  })
  .loose();

function toCitations(annotations: readonly unknown[] | undefined): readonly Citation[] {
  if (annotations === undefined) return [];

  const citations: Citation[] = [];
  for (const raw of annotations) {
    const parsed = annotationSchema.safeParse(raw);
    if (!parsed.success) continue;
    if (parsed.data.type !== "url_citation") continue;

    const cited = parsed.data.url_citation;
    if (!cited || !/^https?:\/\//i.test(cited.url)) continue;

    citations.push({ url: cited.url, title: cited.title ?? null });
  }

  return citations;
}

const streamEventSchema = z
  .object({
    model: z.string().optional(),
    choices: z
      .array(
        z
          .object({
            delta: z.object({ content: z.string().nullish() }).optional(),
            finish_reason: z.string().nullish(),
          })
          .loose(),
      )
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

/**
 * A 200 with no text in it.
 *
 * A reasoning model that spends its whole output ceiling thinking returns a
 * null content and finish_reason "length". That is not a provider outage and
 * it is not a malformed reply; it is a ceiling met before any answer, and it
 * gets its own name so the log says so.
 */
class EmptyCompletionError extends Error {
  constructor(readonly finishReason: string | null) {
    super("OpenRouter returned a completion with no text");
    this.name =
      finishReason === "length" ? "ReasoningExhaustedCeiling" : "EmptyCompletion";
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
      // Returns the charged cost for this generation on the response, which
      // for a searching call includes what the results cost. Nothing new has
      // to be priced: it arrives on the figure the ledger already records.
      usage: { include: true },
      ...(request.structured ? { response_format: { type: "json_object" } } : {}),
      ...(request.webSearch
        ? { plugins: [{ id: "web", max_results: request.webSearch.maxResults }] }
        : {}),
      // The tier's, from the registry. Never omitted when the tier sets one:
      // a small-ceiling tier on a reasoning model otherwise thinks its whole
      // ceiling away and answers nothing.
      ...(request.reasoningEffort
        ? { reasoning: { effort: request.reasoningEffort } }
        : {}),
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
      const choice = parsed.success ? parsed.data.choices?.[0] : undefined;
      const message = choice?.message;
      const content = message?.content;

      // No message at all is a shape this transport does not recognise. A
      // message with no text is a reply the model ran out of room to write.
      if (!parsed.success || message === undefined) {
        throw new Error("OpenRouter returned a malformed completion");
      }
      const finish = (choice as { finish_reason?: unknown } | undefined)?.finish_reason;
      if (typeof content !== "string") {
        throw new EmptyCompletionError(typeof finish === "string" ? finish : null);
      }

      return {
        text: content,
        usage: toUsage(parsed.data.usage, parsed.data.model ?? request.modelId),
        firstTokenMs: null,
        // The provider's word for "the ceiling stopped me". The ledger and a
        // structured caller both need to know that this text is a fragment.
        truncated: finish === "length",
        citations: toCitations(message?.annotations),
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
      let finishReason: string | null = null;
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

                const finish = parsed.data.choices?.[0]?.finish_reason;
                if (typeof finish === "string") finishReason = finish;

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
        finishReason: () => finishReason,
      } satisfies StreamResponse;
    },
  };
}
