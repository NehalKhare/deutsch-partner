import { describe, expect, it, vi } from "vitest";

import { gatewayFail, gatewayOk } from "@dp/gateway/errors";
import {
  handleScenarioSearch,
  scenarioErrorResponse,
  scenarioSearchRequestSchema,
} from "@/lib/api/scenarios";
import { fail as repositoryFail, ok as repositoryOk, repositoryError } from "@dp/db/errors";

/**
 * The search endpoint's logic, with the framework left outside.
 *
 * The handler owns everything after authentication and rate limiting: parse
 * the body, embed the query through the gateway, search through the database
 * function, and translate every failure into the closed error set.
 */

const IDENTITY = {
  learnerId: "11111111-1111-4111-8111-111111111111",
  userIdHash: "abcd1234",
  requestId: "req-1",
};

const SUMMARY = {
  id: 1,
  slug: "dialogue-a1-im-restaurant",
  type: "dialogue" as const,
  kind: "dialogue" as const,
  title: "Im Restaurant",
  titleEnglish: "At the Restaurant",
  description: "A customer orders lunch.",
  targetLevel: "A1" as const,
  source: "Conversational_German_15_Dialogue_Stories.md",
  itemIndex: 0,
  similarity: 0.9,
};

function embeddingsReturning(vector: readonly number[]) {
  return {
    embed: vi.fn(async () =>
      gatewayOk({
        embedded: [
          { text: "q", contentHash: "h", embedding: vector, cached: false },
        ],
        cacheHits: 0,
        embeddedCount: 1,
        costEur: 0,
      }),
    ),
  };
}

describe("the request body", () => {
  it("accepts a query with an optional type filter", () => {
    const parsed = scenarioSearchRequestSchema.safeParse({
      query: "I want to practice ordering food at a restaurant",
      type: "dialogue",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(12);
  });

  it("rejects an unknown filter type", () => {
    expect(
      scenarioSearchRequestSchema.safeParse({ query: "x", type: "quiz" }).success,
    ).toBe(false);
  });

  it("rejects an over-long query rather than truncating it", () => {
    expect(
      scenarioSearchRequestSchema.safeParse({ query: "x".repeat(201) }).success,
    ).toBe(false);
  });

  it("rejects unexpected properties", () => {
    expect(
      scenarioSearchRequestSchema.safeParse({ query: "x", learnerId: "someone" })
        .success,
    ).toBe(false);
  });
});

describe("handling a search", () => {
  it("embeds the query and returns the matching cards", async () => {
    const embeddings = embeddingsReturning([0.1, 0.2]);
    const searchByVector = vi.fn(async () => repositoryOk([SUMMARY]));

    const result = await handleScenarioSearch(
      { query: "ordering food", type: "dialogue" },
      IDENTITY,
      { embeddings, scenarios: { searchByVector } },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.results).toEqual([SUMMARY]);
      // The response cites its sources: every hit says where it came from.
      expect(result.results[0].source).toBe(
        "Conversational_German_15_Dialogue_Stories.md",
      );
      expect(result.results[0].itemIndex).toBe(0);
    }

    expect(embeddings.embed).toHaveBeenCalledWith(["ordering food"], {
      requestId: "req-1",
      userIdHash: "abcd1234",
    });
    expect(searchByVector).toHaveBeenCalledWith([0.1, 0.2], {
      types: ["dialogue"],
      levels: null,
      limit: 12,
    });
  });

  it("passes no type filter when none was asked for", async () => {
    const searchByVector = vi.fn(async () => repositoryOk([]));

    await handleScenarioSearch(
      { query: "daily routines" },
      IDENTITY,
      { embeddings: embeddingsReturning([0.3]), scenarios: { searchByVector } },
    );

    expect(searchByVector).toHaveBeenCalledWith([0.3], {
      types: null,
      levels: null,
      limit: 12,
    });
  });

  it("refuses a malformed body before touching a model", async () => {
    const embeddings = embeddingsReturning([0.1]);

    const result = await handleScenarioSearch(
      { query: "" },
      IDENTITY,
      { embeddings, scenarios: { searchByVector: vi.fn() } },
    );

    expect(result).toMatchObject({ ok: false, error: "invalid_body" });
    expect(embeddings.embed).not.toHaveBeenCalled();
  });

  it("degrades to unavailable when no embedding key is configured", async () => {
    const result = await handleScenarioSearch(
      { query: "ordering food" },
      IDENTITY,
      { embeddings: null, scenarios: { searchByVector: vi.fn() } },
    );

    expect(result).toMatchObject({ ok: false, error: "search_unavailable" });
  });

  it("degrades to unavailable when the embedding call fails", async () => {
    const embeddings = {
      embed: vi.fn(async () => gatewayFail("provider_error", "boom")),
    };
    const searchByVector = vi.fn();

    const result = await handleScenarioSearch(
      { query: "ordering food" },
      IDENTITY,
      { embeddings, scenarios: { searchByVector } },
    );

    expect(result).toMatchObject({ ok: false, error: "search_unavailable" });
    expect(searchByVector).not.toHaveBeenCalled();
  });

  it("degrades to unavailable when the database search fails", async () => {
    const result = await handleScenarioSearch(
      { query: "ordering food" },
      IDENTITY,
      {
        embeddings: embeddingsReturning([0.1]),
        scenarios: {
          searchByVector: vi.fn(async () =>
            repositoryFail(repositoryError("unavailable")),
          ),
        },
      },
    );

    expect(result).toMatchObject({ ok: false, error: "search_unavailable" });
  });
});

describe("what a learner is told", () => {
  it("maps every error to a status and a safe message", () => {
    expect(scenarioErrorResponse("unauthenticated").status).toBe(401);
    expect(scenarioErrorResponse("invalid_body").status).toBe(400);
    expect(scenarioErrorResponse("rate_limited").status).toBe(429);
    expect(scenarioErrorResponse("search_unavailable").status).toBe(503);
  });

  it("never carries a provider detail", () => {
    for (const error of [
      "unauthenticated",
      "invalid_body",
      "rate_limited",
      "search_unavailable",
    ] as const) {
      expect(scenarioErrorResponse(error).message).not.toMatch(
        /openai|postgres|pgvector|embedding/i,
      );
    }
  });
});
