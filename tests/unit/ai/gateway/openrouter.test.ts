import { describe, expect, it, vi } from "vitest";

import { createOpenRouterTransport } from "@/lib/ai/gateway/openrouter";
import type { ModelRequest } from "@/lib/ai/gateway/transport";

const request = (over: Partial<ModelRequest> = {}): ModelRequest => ({
  modelId: "vendor/model",
  system: "Du bist eine Deutschlehrerin.",
  systemStablePrefix: null,
  user: "Guten Tag!",
  maxOutputTokens: 300,
  signal: new AbortController().signal,
  structured: false,
  ...over,
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const COMPLETION = {
  choices: [{ message: { content: "Guten Tag! Wie geht es dir?" } }],
  model: "vendor/model-2026-01",
  usage: {
    prompt_tokens: 900,
    completion_tokens: 120,
    cost: 0.0021,
    prompt_tokens_details: { cached_tokens: 400 },
    completion_tokens_details: { reasoning_tokens: 40 },
  },
};

function transportWith(fetchImpl: typeof fetch) {
  return createOpenRouterTransport({
    apiKey: "sk-or-test-key",
    appUrl: "https://deutsch-partner.example",
    appName: "Deutsch Partner",
    fetchImpl,
  });
}

describe("openrouter transport", () => {
  it("returns the reply and the usage the provider reported", async () => {
    const transport = transportWith(vi.fn().mockResolvedValue(jsonResponse(COMPLETION)));

    const response = await transport.complete(request());

    expect(response.text).toBe("Guten Tag! Wie geht es dir?");
    expect(response.usage).toMatchObject({
      inputTokens: 900,
      outputTokens: 120,
      cachedInputTokens: 400,
      reasoningTokens: 40,
      costUsd: 0.0021,
      modelIdResolved: "vendor/model-2026-01",
    });
  });

  it("always sends the output ceiling and asks for cost accounting", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(COMPLETION));
    await transportWith(fetchImpl).complete(request({ maxOutputTokens: 42 }));

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(body.max_tokens).toBe(42);
    expect(body.usage).toEqual({ include: true });
    expect(body.model).toBe("vendor/model");
  });

  it("sends the key as a bearer token and nowhere else", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(COMPLETION));
    await transportWith(fetchImpl).complete(request());

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);

    expect(headers.get("authorization")).toBe("Bearer sk-or-test-key");
    expect(url).not.toContain("sk-or-test-key");
    expect(String(init.body)).not.toContain("sk-or-test-key");
  });

  it("never puts the key into the error it throws", async () => {
    const transport = transportWith(
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: "no credit" } }, 402)),
    );

    await expect(transport.complete(request())).rejects.toThrow(/402/);
    await expect(transport.complete(request())).rejects.not.toThrow(/sk-or-test-key/);
  });

  it("refuses a response that does not carry a message", async () => {
    const transport = transportWith(
      vi.fn().mockResolvedValue(jsonResponse({ choices: [], model: "vendor/model" })),
    );

    await expect(transport.complete(request())).rejects.toThrow(/malformed/i);
  });

  it("reports no cost rather than zero when the provider omits one", async () => {
    const transport = transportWith(
      vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: "ja" } }],
          model: "vendor/model",
          usage: { prompt_tokens: 5, completion_tokens: 1 },
        }),
      ),
    );

    expect((await transport.complete(request())).usage.costUsd).toBeNull();
  });

  it("passes the abort signal down to the request", async () => {
    const abort = new AbortController();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(COMPLETION));

    await transportWith(fetchImpl).complete(request({ signal: abort.signal }));

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(abort.signal);
  });

  it("asks for a JSON object when the task is schema-bound", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(COMPLETION));
    await transportWith(fetchImpl).complete(request({ structured: true }));

    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));

    expect(body.response_format).toEqual({ type: "json_object" });
  });
});

describe("prompt caching", () => {
  const STABLE = "Du bist eine Deutschlehrerin.";
  const VOLATILE = "\n\nDer Lernende steht bei A2, Mini-Level 3.";
  const SYSTEM = `${STABLE}${VOLATILE}`;

  const sentSystem = (fetchImpl: ReturnType<typeof vi.fn>) => {
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));
    return body.messages[0] as { role: string; content: unknown };
  };

  it("marks the stable prefix for an anthropic model, keeping the text whole", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(COMPLETION));
    await transportWith(fetchImpl).complete(
      request({
        modelId: "anthropic/claude-sonnet-5",
        system: SYSTEM,
        systemStablePrefix: STABLE,
      }),
    );

    const system = sentSystem(fetchImpl);
    expect(system.role).toBe("system");
    expect(system.content).toEqual([
      { type: "text", text: STABLE, cache_control: { type: "ephemeral" } },
      { type: "text", text: VOLATILE },
    ]);
  });

  it("marks a system prompt that is stable in its entirety as one part", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(COMPLETION));
    await transportWith(fetchImpl).complete(
      request({
        modelId: "anthropic/claude-sonnet-5",
        system: STABLE,
        systemStablePrefix: STABLE,
      }),
    );

    expect(sentSystem(fetchImpl).content).toEqual([
      { type: "text", text: STABLE, cache_control: { type: "ephemeral" } },
    ]);
  });

  it("sends any other vendor the plain string, marker-free", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(COMPLETION));
    await transportWith(fetchImpl).complete(
      request({
        modelId: "openai/gpt-5.4",
        system: SYSTEM,
        systemStablePrefix: STABLE,
      }),
    );

    expect(sentSystem(fetchImpl).content).toBe(SYSTEM);
  });

  it("sends the plain string when no stable prefix was promised", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(COMPLETION));
    await transportWith(fetchImpl).complete(
      request({ modelId: "anthropic/claude-sonnet-5", system: SYSTEM }),
    );

    expect(sentSystem(fetchImpl).content).toBe(SYSTEM);
  });

  it("refuses to mark text that is not actually a prefix of the system", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(COMPLETION));
    await transportWith(fetchImpl).complete(
      request({
        modelId: "anthropic/claude-sonnet-5",
        system: SYSTEM,
        systemStablePrefix: "Etwas ganz anderes.",
      }),
    );

    expect(sentSystem(fetchImpl).content).toBe(SYSTEM);
  });

  it("marks a streaming request the same way", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(["data: [DONE]\n\n"]));
    await transportWith(fetchImpl).stream(
      request({
        modelId: "anthropic/claude-sonnet-5",
        system: SYSTEM,
        systemStablePrefix: STABLE,
      }),
    );

    const [first] = sentSystem(fetchImpl).content as { cache_control?: unknown }[];
    expect(first.cache_control).toEqual({ type: "ephemeral" });
  });
});

function sseResponse(lines: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

const delta = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

describe("openrouter streaming", () => {
  it("yields the text deltas in order", async () => {
    const transport = transportWith(
      vi.fn().mockResolvedValue(
        sseResponse([delta("Guten "), delta("Tag"), delta("!"), "data: [DONE]\n\n"]),
      ),
    );

    const opened = await transport.stream(request());
    const chunks: string[] = [];
    for await (const chunk of opened.chunks) chunks.push(chunk);

    expect(chunks.join("")).toBe("Guten Tag!");
  });

  it("survives an event split across two network reads", async () => {
    const payload = delta("Hallo");
    const transport = transportWith(
      vi.fn().mockResolvedValue(
        sseResponse([payload.slice(0, 12), payload.slice(12), "data: [DONE]\n\n"]),
      ),
    );

    const opened = await transport.stream(request());
    const chunks: string[] = [];
    for await (const chunk of opened.chunks) chunks.push(chunk);

    expect(chunks.join("")).toBe("Hallo");
  });

  it("ignores keep-alive comments", async () => {
    const transport = transportWith(
      vi
        .fn()
        .mockResolvedValue(sseResponse([": ping\n\n", delta("ja"), "data: [DONE]\n\n"])),
    );

    const opened = await transport.stream(request());
    const chunks: string[] = [];
    for await (const chunk of opened.chunks) chunks.push(chunk);

    expect(chunks.join("")).toBe("ja");
  });

  it("reports usage only once the stream has finished", async () => {
    const usageEvent = `data: ${JSON.stringify({
      choices: [],
      model: "vendor/model-2026-01",
      usage: { prompt_tokens: 10, completion_tokens: 3, cost: 0.00004 },
    })}\n\n`;
    const transport = transportWith(
      vi.fn().mockResolvedValue(sseResponse([delta("ja"), usageEvent, "data: [DONE]\n\n"])),
    );

    const opened = await transport.stream(request());
    expect(opened.usage()).toBeNull();

    for await (const chunk of opened.chunks) void chunk;

    expect(opened.usage()).toMatchObject({
      inputTokens: 10,
      outputTokens: 3,
      costUsd: 0.00004,
      modelIdResolved: "vendor/model-2026-01",
    });
  });

  it("times the first token", async () => {
    const transport = transportWith(
      vi.fn().mockResolvedValue(sseResponse([delta("ja"), "data: [DONE]\n\n"])),
    );

    const opened = await transport.stream(request());
    expect(opened.firstTokenMs()).toBeNull();

    for await (const chunk of opened.chunks) void chunk;

    expect(opened.firstTokenMs()).toBeGreaterThanOrEqual(0);
  });

  it("throws before streaming when the provider refuses the request", async () => {
    const transport = transportWith(
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: "rate limited" } }, 429)),
    );

    await expect(transport.stream(request())).rejects.toThrow(/429/);
  });
});
