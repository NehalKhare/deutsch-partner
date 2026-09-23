import { describe, expect, it, vi } from "vitest";

import {
  createEmbeddingService,
  type EmbeddingCache,
} from "../src/embedding-service";
import {
  embeddingSpecFor,
  type EmbeddingCallSpec,
  type EmbeddingGateway,
} from "../src/embeddings";
import { gatewayFail, gatewayOk } from "../src/errors";
import { contentHash } from "../src/content-hash";

const CONTEXT = { requestId: null };
const MODEL = "openai/text-embedding-3-small";

function spec(over: Partial<EmbeddingCallSpec> = {}): EmbeddingCallSpec {
  const built = embeddingSpecFor("ingestion.embedding", {
    timeoutMs: 20_000,
    dimensions: 4,
  });
  if (!built.ok) throw new Error("fixture spec did not build");
  return { ...built.data, ...over };
}

/** Deterministic, so a test can say which vector belongs to which text. */
const fakeVector = (text: string) => [text.length, 0, 0, 1];

function countingGateway() {
  const batches: string[][] = [];
  const gateway: EmbeddingGateway = {
    async embed(_spec, texts) {
      batches.push([...texts]);
      return gatewayOk({
        vectors: texts.map(fakeVector),
        modelIdResolved: MODEL,
        inputTokens: texts.length * 4,
        costUsd: 0.000001 * texts.length,
        costEur: 0.0000009 * texts.length,
      });
    },
  };
  return { gateway, batches };
}

function memoryCache(): EmbeddingCache & { stored: Map<string, readonly number[]> } {
  const stored = new Map<string, readonly number[]>();
  return {
    stored,
    async lookup(_modelId, hashes) {
      const hits = new Map<string, readonly number[]>();
      for (const hash of hashes) {
        const value = stored.get(hash);
        if (value) hits.set(hash, value);
      }
      return hits;
    },
    async store(_modelId, _dimensions, entries) {
      for (const entry of entries) stored.set(entry.contentHash, entry.embedding);
    },
  };
}

describe("embedding service", () => {
  it("returns one embedding per text, aligned with the input", async () => {
    const { gateway } = countingGateway();
    const service = createEmbeddingService({ gateway, spec: spec(), modelId: MODEL });

    const outcome = await service.embed(["eins", "dreizehn"], CONTEXT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.embedded.map((item) => item.text)).toEqual(["eins", "dreizehn"]);
    expect(outcome.data.embedded[1].embedding).toEqual(fakeVector("dreizehn"));
  });

  it("stamps each text with the hash of its own content", async () => {
    const { gateway } = countingGateway();
    const service = createEmbeddingService({ gateway, spec: spec(), modelId: MODEL });

    const outcome = await service.embed(["eins"], CONTEXT);

    expect(outcome.ok && outcome.data.embedded[0].contentHash).toBe(contentHash("eins"));
  });

  it("embeds a repeated text once", async () => {
    const { gateway, batches } = countingGateway();
    const service = createEmbeddingService({ gateway, spec: spec(), modelId: MODEL });

    const outcome = await service.embed(["gleich", "gleich", "anders"], CONTEXT);

    expect(batches[0]).toEqual(["gleich", "anders"]);
    expect(outcome.ok && outcome.data.embedded[1].embedding).toEqual(fakeVector("gleich"));
  });

  it("re-embeds nothing on a second run over the same text", async () => {
    const { gateway, batches } = countingGateway();
    const cache = memoryCache();
    const service = createEmbeddingService({ gateway, spec: spec(), cache, modelId: MODEL });

    await service.embed(["eins", "zwei"], CONTEXT);
    const second = await service.embed(["eins", "zwei"], CONTEXT);

    expect(batches).toHaveLength(1);
    expect(second.ok && second.data.cacheHits).toBe(2);
    expect(second.ok && second.data.embeddedCount).toBe(0);
    expect(second.ok && second.data.costEur).toBe(0);
  });

  it("embeds only what changed when one text in a set is edited", async () => {
    const { gateway, batches } = countingGateway();
    const cache = memoryCache();
    const service = createEmbeddingService({ gateway, spec: spec(), cache, modelId: MODEL });

    await service.embed(["absatz eins", "absatz zwei", "absatz drei"], CONTEXT);
    await service.embed(["absatz eins", "absatz zwei bearbeitet", "absatz drei"], CONTEXT);

    expect(batches[1]).toEqual(["absatz zwei bearbeitet"]);
  });

  it("treats a different model as a miss, never a stale hit", async () => {
    const cache = memoryCache();
    const first = countingGateway();
    await createEmbeddingService({
      gateway: first.gateway,
      spec: spec(),
      cache,
      modelId: MODEL,
    }).embed(["eins"], CONTEXT);

    // A real cache keys on the model; this one is asked with a different id
    // and must be given no reason to answer.
    const lookup = vi.spyOn(cache, "lookup");
    const second = countingGateway();
    await createEmbeddingService({
      gateway: second.gateway,
      spec: spec(),
      cache,
      modelId: "vendor/other-embedder",
    }).embed(["eins"], CONTEXT);

    expect(lookup).toHaveBeenCalledWith("vendor/other-embedder", [contentHash("eins")]);
  });

  it("splits a large set into batches the spec allows", async () => {
    const { gateway, batches } = countingGateway();
    const service = createEmbeddingService({
      gateway,
      spec: spec({ maxBatchSize: 2 }),
      modelId: MODEL,
    });

    await service.embed(["a", "b", "c", "d", "e"], CONTEXT);

    expect(batches.map((batch) => batch.length)).toEqual([2, 2, 1]);
  });

  it("fails the whole run when one batch fails", async () => {
    // Partial vectors would let a caller store some chunks embedded and some
    // not, and a chunk with no vector is invisible to retrieval without being
    // visibly missing.
    let call = 0;
    const gateway: EmbeddingGateway = {
      async embed(_spec, texts) {
        call += 1;
        if (call === 2) return gatewayFail("provider_error", "upstream 503");
        return gatewayOk({
          vectors: texts.map(fakeVector),
          modelIdResolved: MODEL,
          inputTokens: 1,
          costUsd: 0,
          costEur: 0,
        });
      },
    };
    const cache = memoryCache();
    const service = createEmbeddingService({
      gateway,
      spec: spec({ maxBatchSize: 1 }),
      cache,
      modelId: MODEL,
    });

    const outcome = await service.embed(["a", "b", "c"], CONTEXT);

    expect(outcome).toMatchObject({ ok: false, failure: "provider_error" });
    expect(cache.stored.size).toBe(0);
  });

  it("does nothing at all for no texts", async () => {
    const { gateway, batches } = countingGateway();
    const service = createEmbeddingService({ gateway, spec: spec(), modelId: MODEL });

    const outcome = await service.embed([], CONTEXT);

    expect(batches).toHaveLength(0);
    expect(outcome.ok && outcome.data.embedded).toEqual([]);
  });

  it("works without a cache at all", async () => {
    const { gateway, batches } = countingGateway();
    const service = createEmbeddingService({ gateway, spec: spec(), modelId: MODEL });

    await service.embed(["eins"], CONTEXT);
    await service.embed(["eins"], CONTEXT);

    expect(batches).toHaveLength(2);
  });

  it("reports what the run actually cost", async () => {
    const { gateway } = countingGateway();
    const service = createEmbeddingService({ gateway, spec: spec(), modelId: MODEL });

    const outcome = await service.embed(["a", "b"], CONTEXT);

    expect(outcome.ok && outcome.data.costEur).toBeCloseTo(0.0000018, 12);
  });
});
