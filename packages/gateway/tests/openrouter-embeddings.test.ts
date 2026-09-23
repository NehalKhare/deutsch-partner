import { describe, expect, it, vi } from "vitest";

import { createOpenRouterEmbeddingTransport } from "../src/openrouter-embeddings";

const request = (over: Record<string, unknown> = {}) => ({
  modelId: "openai/text-embedding-3-small",
  texts: ["eins", "zwei"],
  dimensions: 1536,
  signal: new AbortController().signal,
  ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const BODY = {
  model: "text-embedding-3-small",
  data: [
    { index: 1, embedding: [0.2, 0.3] },
    { index: 0, embedding: [0.1, 0.4] },
  ],
  usage: { prompt_tokens: 12, cost: 0.00000024 },
};

const transportWith = (fetchImpl: typeof fetch) =>
  createOpenRouterEmbeddingTransport({ apiKey: "sk-embed-test-key", fetchImpl });

describe("openrouter embeddings transport", () => {
  it("calls OpenRouter's embeddings endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(BODY));
    await transportWith(fetchImpl).embed(request());

    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe(
      "https://openrouter.ai/api/v1/embeddings",
    );
  });

  it("returns vectors in the order the inputs were given", async () => {
    // The API does not promise ordered results, and the caller pairs vectors
    // with its own inputs positionally.
    const response = await transportWith(vi.fn().mockResolvedValue(json(BODY))).embed(
      request(),
    );

    expect(response.vectors).toEqual([
      [0.1, 0.4],
      [0.2, 0.3],
    ]);
  });

  it("reports the provider's own cost when it states one", async () => {
    // OpenRouter prices the call itself; a stated cost beats a snapshot.
    const response = await transportWith(vi.fn().mockResolvedValue(json(BODY))).embed(
      request(),
    );

    expect(response.usage).toEqual({
      inputTokens: 12,
      costUsd: 0.00000024,
      modelIdResolved: "text-embedding-3-small",
    });
  });

  it("leaves cost to the pricing snapshot when the provider is silent", async () => {
    const silent = { ...BODY, usage: { prompt_tokens: 12 } };
    const response = await transportWith(vi.fn().mockResolvedValue(json(silent))).embed(
      request(),
    );

    expect(response.usage.costUsd).toBeNull();
  });

  it("sends the registry's vendor-qualified model id as OpenRouter states it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(BODY));
    await transportWith(fetchImpl).embed(request());

    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));

    expect(body.model).toBe("openai/text-embedding-3-small");
    expect(body.input).toEqual(["eins", "zwei"]);
  });

  it("asks for the width explicitly rather than trusting a default", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(BODY));
    await transportWith(fetchImpl).embed(request({ dimensions: 1536 }));

    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));

    expect(body.dimensions).toBe(1536);
  });

  it("attributes traffic when the app says who it is", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(BODY));
    await createOpenRouterEmbeddingTransport({
      apiKey: "sk-embed-test-key",
      appUrl: "https://deutsch-partner.example",
      appName: "Deutsch Partner",
      fetchImpl,
    }).embed(request());

    const headers = new Headers((fetchImpl.mock.calls[0] as [string, RequestInit])[1].headers);

    expect(headers.get("HTTP-Referer")).toBe("https://deutsch-partner.example");
    expect(headers.get("X-Title")).toBe("Deutsch Partner");
  });

  it("sends no attribution headers it cannot fill", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(BODY));
    await transportWith(fetchImpl).embed(request());

    const headers = new Headers((fetchImpl.mock.calls[0] as [string, RequestInit])[1].headers);

    expect(headers.get("HTTP-Referer")).toBeNull();
    expect(headers.get("X-Title")).toBeNull();
  });

  it("sends the key as a bearer token and nowhere else", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(BODY));
    await transportWith(fetchImpl).embed(request());

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];

    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-embed-test-key");
    expect(url).not.toContain("sk-embed-test-key");
    expect(String(init.body)).not.toContain("sk-embed-test-key");
  });

  it("never puts the key into the error it throws", async () => {
    const transport = transportWith(
      vi.fn().mockResolvedValue(json({ error: { message: "quota" } }, 429)),
    );

    await expect(transport.embed(request())).rejects.toThrow(/429/);
    await expect(transport.embed(request())).rejects.not.toThrow(/sk-embed-test-key/);
  });

  it("refuses a malformed response", async () => {
    const transport = transportWith(vi.fn().mockResolvedValue(json({ data: [] })));

    await expect(transport.embed(request())).rejects.toThrow(/malformed/i);
  });

  it("passes the abort signal down", async () => {
    const abort = new AbortController();
    const fetchImpl = vi.fn().mockResolvedValue(json(BODY));

    await transportWith(fetchImpl).embed(request({ signal: abort.signal }));

    expect((fetchImpl.mock.calls[0] as [string, RequestInit])[1].signal).toBe(abort.signal);
  });
});
