import { describe, expect, it } from "vitest";

import { createKnowledgeSearch } from "@/repositories/retrieval-repository";
import type { SearchFilter } from "@/lib/retrieval/search";
import { createLogger } from "@/lib/observability/logger";
import { createFakeSupabase } from "../../support/fake-supabase";

const FILTER: SearchFilter = {
  cefr: ["A1", "A2"],
  maxMiniLevel: 32,
  contentTypes: null,
  limit: 24,
};

const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  document_id: 7,
  content: "Der Dativ folgt auf mit.",
  cefr: "A2",
  mini_level: 26,
  topic: "travel",
  skill: "grammar",
  grammar_target: "dative_prepositions",
  content_type: "grammar",
  difficulty: 3,
  token_count: 20,
  similarity: 0.82,
  rank: 0.14,
  ...over,
});

describe("vector search", () => {
  it("sends the embedding in the form pgvector accepts", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: [row()] });

    await createKnowledgeSearch(fake.client).byVector([0.1, 0.2, 0.3], FILTER);

    expect(fake.rpcCalls[0].fn).toBe("search_knowledge_vector");
    expect(fake.rpcCalls[0].args?.p_embedding).toBe("[0.1,0.2,0.3]");
  });

  it("passes the learner filter down to the query", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: [] });

    await createKnowledgeSearch(fake.client).byVector([0.1], FILTER);

    expect(fake.rpcCalls[0].args).toMatchObject({
      p_cefr: ["A1", "A2"],
      p_max_mini_level: 32,
      p_content_types: null,
      p_limit: 24,
    });
  });

  it("maps a row onto a candidate", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: [row()] });

    const [candidate] = await createKnowledgeSearch(fake.client).byVector([0.1], FILTER);

    expect(candidate).toEqual({
      id: 1,
      documentId: 7,
      content: "Der Dativ folgt auf mit.",
      cefr: "A2",
      miniLevel: 26,
      topic: "travel",
      skill: "grammar",
      grammarTarget: "dative_prepositions",
      contentType: "grammar",
      difficulty: 3,
      tokenCount: 20,
      similarity: 0.82,
    });
  });

  it("coerces a numeric that arrived as a string", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: [row({ similarity: "0.5", mini_level: "26" })] });

    const [candidate] = await createKnowledgeSearch(fake.client).byVector([0.1], FILTER);

    expect(candidate.similarity).toBe(0.5);
    expect(candidate.miniLevel).toBe(26);
  });
});

describe("lexical search", () => {
  it("sends the query text", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: [row()] });

    await createKnowledgeSearch(fake.client).byText("Warum mit dem Zug?", FILTER);

    expect(fake.rpcCalls[0].fn).toBe("search_knowledge_lexical");
    expect(fake.rpcCalls[0].args?.p_query).toBe("Warum mit dem Zug?");
  });

  it("carries the rank through as the arm's own score", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: [row({ rank: 0.31 })] });

    const [candidate] = await createKnowledgeSearch(fake.client).byText("Dativ", FILTER);

    expect(candidate.similarity).toBe(0.31);
  });
});

describe("when an arm fails", () => {
  it("returns nothing rather than failing the retrieval", async () => {
    // Hybrid search has two arms so one of them going down degrades the answer
    // rather than removing it.
    const lines: string[] = [];
    const fake = createFakeSupabase({});
    fake.setRpcResult({ error: { code: "57014", message: "canceled" } });

    const search = createKnowledgeSearch(
      fake.client,
      createLogger({ sink: (line) => lines.push(line) }),
    );

    expect(await search.byVector([0.1], FILTER)).toEqual([]);
    expect(lines.join("\n")).toContain("retrieval.arm_failed");
  });

  it("drops a malformed result set rather than ranking it", async () => {
    const lines: string[] = [];
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: [row({ content_type: "poetry" })] });

    const search = createKnowledgeSearch(
      fake.client,
      createLogger({ sink: (line) => lines.push(line) }),
    );

    // A content type the domain does not know cannot be scored: the intent
    // weighting has no entry for it, and it would sit at the bottom of every
    // list pretending to be a result.
    expect(await search.byVector([0.1], FILTER)).toEqual([]);
    expect(lines.join("\n")).toContain("retrieval.arm_malformed");
  });

  it("returns nothing for no rows", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: null });

    expect(await createKnowledgeSearch(fake.client).byText("x", FILTER)).toEqual([]);
  });

  it("puts no chunk content into the log line", async () => {
    const lines: string[] = [];
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: [row({ content_type: "poetry" })] });

    await createKnowledgeSearch(
      fake.client,
      createLogger({ sink: (line) => lines.push(line) }),
    ).byVector([0.1], FILTER);

    expect(lines.join("\n")).not.toContain("Dativ");
  });
});
