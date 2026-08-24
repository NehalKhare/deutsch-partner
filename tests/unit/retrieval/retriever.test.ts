import { describe, expect, it, vi } from "vitest";

import { retrievalContextSchema } from "@/domain/retrieval";
import type { EmbeddingService } from "@/lib/ai/gateway/embedding-service";
import { gatewayFail, gatewayOk } from "@/lib/ai/gateway/errors";
import { contentHash } from "@/lib/content/hash";
import { MINI_LEVEL_LOOKAHEAD, candidateFilter, eligibleBands } from "@/lib/retrieval/filters";
import {
  DEFAULT_TOP_K,
  MAX_CHUNK_TOKENS,
  MAX_TOP_K,
  createRetriever,
  lexicalQuery,
} from "@/lib/retrieval/retriever";
import type { RetrievalCandidate } from "@/lib/retrieval/scoring";
import type { KnowledgeSearch, SearchFilter } from "@/lib/retrieval/search";
import { estimateTokens } from "@/lib/ai/prompts/tokens";

const learner = (over: Record<string, unknown> = {}) =>
  retrievalContextSchema.parse({
    intent: "grammar",
    cefr: "A2",
    miniLevel: 26,
    ...over,
  });

let nextId = 1;

const candidate = (over: Partial<RetrievalCandidate> = {}): RetrievalCandidate => ({
  id: nextId++,
  documentId: 1,
  content: "Nach mit, nach, bei, seit, von, zu steht immer der Dativ.",
  cefr: "A2",
  miniLevel: 26,
  topic: null,
  skill: "grammar",
  grammarTarget: "dative_prepositions",
  contentType: "grammar",
  difficulty: 3,
  tokenCount: 30,
  similarity: 0.7,
  ...over,
});

/** Deterministic, so a test can say exactly which vector a query produces. */
const embeddings: EmbeddingService = {
  async embed(texts) {
    return gatewayOk({
      embedded: texts.map((text) => ({
        text,
        contentHash: contentHash(text),
        embedding: [text.length, 1, 2, 3],
        cached: false,
      })),
      cacheHits: 0,
      embeddedCount: texts.length,
      costEur: 0.0000005,
    });
  },
};

function searchReturning(
  vector: readonly RetrievalCandidate[],
  lexical: readonly RetrievalCandidate[] = [],
) {
  const calls: { arm: string; query: unknown; filter: SearchFilter }[] = [];
  const search: KnowledgeSearch = {
    async byVector(embedding, filter) {
      calls.push({ arm: "vector", query: embedding, filter });
      return vector;
    },
    async byText(query, filter) {
      calls.push({ arm: "lexical", query, filter });
      return lexical;
    },
  };
  return { search, calls };
}

describe("the candidate filter", () => {
  it("allows every band up to the learner's and exactly one above", () => {
    // Two bands above is not a stretch, it is a different course.
    expect(eligibleBands("A1")).toEqual(["A1", "A2"]);
    expect(eligibleBands("A2")).toEqual(["A1", "A2", "B1"]);
    expect(eligibleBands("B1")).toEqual(["A1", "A2", "B1"]);
  });

  it("looks a little way ahead of the current mini-level", () => {
    expect(candidateFilter(learner()).maxMiniLevel).toBe(26 + MINI_LEVEL_LOOKAHEAD);
  });

  it("narrows nothing by content type, leaving that to the score", () => {
    expect(candidateFilter(learner()).contentTypes).toBeNull();
  });
});

describe("the lexical query", () => {
  it("is the message plus what the learner is working on", () => {
    const query = lexicalQuery(
      "Warum sagt man mit dem Zug?",
      learner({
        weakGrammarKeys: ["dative_prepositions"],
        currentLessonTarget: "two_way_prepositions",
        targetVocabularyLemmas: ["Bahnhof"],
      }),
    );

    expect(query).toContain("Warum sagt man mit dem Zug?");
    expect(query).toContain("dative prepositions");
    expect(query).toContain("two_way_prepositions");
    expect(query).toContain("Bahnhof");
  });

  it("is just the message when there is nothing to add", () => {
    expect(lexicalQuery("Guten Tag", learner())).toBe("Guten Tag");
  });

  it("does not let a long word list swamp the question", () => {
    const query = lexicalQuery(
      "Frage",
      learner({
        targetVocabularyLemmas: Array.from({ length: 40 }, (_v, i) => `wort${i}`),
      }),
    );

    expect(query.split(" ")).toHaveLength(7);
  });
});

describe("retrieving", () => {
  it("returns the top chunks for the learner", async () => {
    const { search } = searchReturning([candidate(), candidate(), candidate()]);

    const outcome = await createRetriever({ search, embeddings }).retrieve(
      "Warum mit dem Zug?",
      learner(),
      { topK: 2 },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.chunks).toHaveLength(2);
    expect(outcome.data.considered).toBe(3);
  });

  it("embeds only the message, which is what a chunk is comparable to", async () => {
    const embed = vi.fn(embeddings.embed);
    const { search } = searchReturning([candidate()]);

    await createRetriever({ search, embeddings: { embed } }).retrieve(
      "Warum mit dem Zug?",
      learner({ targetVocabularyLemmas: ["Bahnhof"] }),
    );

    expect(embed.mock.calls[0][0]).toEqual(["Warum mit dem Zug?"]);
  });

  it("gives both arms the same learner filter", async () => {
    const { search, calls } = searchReturning([candidate()]);

    await createRetriever({ search, embeddings }).retrieve("Frage", learner());

    expect(calls).toHaveLength(2);
    expect(calls[0].filter).toEqual(calls[1].filter);
    expect(calls[0].filter.cefr).toEqual(["A1", "A2", "B1"]);
    expect(calls[0].filter.maxMiniLevel).toBe(32);
  });

  it("filters before it ranks, by passing the filter into the search", async () => {
    // A filter applied to a top-N is a filter that has already lost.
    const { search, calls } = searchReturning([candidate()]);

    await createRetriever({ search, embeddings }).retrieve("Frage", learner());

    expect(calls[0].filter.limit).toBeGreaterThan(DEFAULT_TOP_K);
  });

  it("caps each chunk so one long one cannot eat the budget", async () => {
    const { search } = searchReturning([
      candidate({ content: "Wort ".repeat(2000) }),
    ]);

    const outcome = await createRetriever({ search, embeddings }).retrieve(
      "Frage",
      learner(),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(estimateTokens(outcome.data.chunks[0].content)).toBeLessThanOrEqual(
      MAX_CHUNK_TOKENS,
    );
  });

  it("keeps the returned set small", async () => {
    const { search } = searchReturning(
      Array.from({ length: 30 }, () => candidate()),
    );

    const outcome = await createRetriever({ search, embeddings }).retrieve(
      "Frage",
      learner(),
      { topK: 500 },
    );

    expect(outcome.ok && outcome.data.chunks.length).toBe(MAX_TOP_K);
  });

  it("defaults to a handful rather than everything", async () => {
    const { search } = searchReturning(Array.from({ length: 30 }, () => candidate()));

    const outcome = await createRetriever({ search, embeddings }).retrieve(
      "Frage",
      learner(),
    );

    expect(outcome.ok && outcome.data.chunks.length).toBe(DEFAULT_TOP_K);
  });

  it("reports what the query embedding cost", async () => {
    const { search } = searchReturning([candidate()]);

    const outcome = await createRetriever({ search, embeddings }).retrieve(
      "Frage",
      learner(),
    );

    expect(outcome.ok && outcome.data.costEur).toBeCloseTo(0.0000005, 12);
  });

  it("keeps the breakdown, so a retrieval can be explained afterwards", async () => {
    const { search } = searchReturning([candidate()]);

    const outcome = await createRetriever({ search, embeddings }).retrieve(
      "Frage",
      learner(),
    );

    expect(outcome.ok && outcome.data.ranked[0].breakdown.levelFit).toBeGreaterThan(0);
  });
});

describe("what retrieval refuses to do", () => {
  it("rejects a learner context that does not validate", async () => {
    const { search } = searchReturning([]);

    const outcome = await createRetriever({ search, embeddings }).retrieve("Frage", {
      intent: "grammar",
      cefr: "B1",
      miniLevel: 3,
    });

    expect(outcome).toMatchObject({ ok: false, failure: "invalid_spec" });
  });

  it("searches nothing for a question about today", async () => {
    // A pedagogical corpus has no current facts in it, and answering from one
    // is how a tutor states last year's train fare as fact.
    const { search, calls } = searchReturning([candidate()]);

    const outcome = await createRetriever({ search, embeddings }).retrieve(
      "Wie ist das Wetter heute?",
      learner({ intent: "web" }),
    );

    expect(outcome.ok && outcome.data.chunks).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("searches nothing for an empty message", async () => {
    const { search, calls } = searchReturning([candidate()]);

    const outcome = await createRetriever({ search, embeddings }).retrieve(
      "   ",
      learner(),
    );

    expect(outcome.ok && outcome.data.chunks).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("fails the retrieval when the query cannot be embedded", async () => {
    const { search } = searchReturning([candidate()]);
    const failing: EmbeddingService = {
      async embed() {
        return gatewayFail("budget_denied", "over budget");
      },
    };

    expect(
      await createRetriever({ search, embeddings: failing }).retrieve(
        "Frage",
        learner(),
      ),
    ).toMatchObject({ ok: false, failure: "budget_denied" });
  });

  it("returns what the other arm found when one arm returns nothing", async () => {
    // Hybrid search has two arms so one of them going quiet degrades the
    // answer rather than removing it.
    const { search } = searchReturning([], [candidate()]);

    const outcome = await createRetriever({ search, embeddings }).retrieve(
      "Frage",
      learner(),
    );

    expect(outcome.ok && outcome.data.chunks).toHaveLength(1);
  });
});

describe("end to end ranking", () => {
  it("puts A1 material first for an A1 learner", async () => {
    const { search } = searchReturning([
      candidate({ id: 100, cefr: "B1", miniLevel: 48 }),
      candidate({ id: 101, cefr: "A2", miniLevel: 20 }),
      candidate({ id: 102, cefr: "A1", miniLevel: 8 }),
    ]);

    const outcome = await createRetriever({ search, embeddings }).retrieve(
      "Was heißt Bahnhof?",
      learner({ cefr: "A1", miniLevel: 8 }),
      { topK: 1 },
    );

    expect(outcome.ok && outcome.data.chunks[0].cefr).toBe("A1");
  });

  it("puts the dative explanation first for a dative question", async () => {
    const { search } = searchReturning(
      [
        candidate({
          id: 200,
          grammarTarget: "accusative_prepositions",
          content: "Durch, für, gegen, ohne und um stehen mit dem Akkusativ.",
        }),
      ],
      [
        candidate({
          id: 201,
          grammarTarget: "dative_prepositions",
          content: "Nach mit, nach, bei, seit, von, zu steht immer der Dativ.",
        }),
      ],
    );

    const outcome = await createRetriever({ search, embeddings }).retrieve(
      "Warum sagt man mit dem Zug?",
      learner({ cefr: "A2", miniLevel: 26, weakGrammarKeys: ["dative_prepositions"] }),
      { topK: 1 },
    );

    expect(outcome.ok && outcome.data.chunks[0].grammarTarget).toBe(
      "dative_prepositions",
    );
  });
});
