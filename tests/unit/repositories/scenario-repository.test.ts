import { beforeEach, describe, expect, it } from "vitest";

import { createScenarioRepository } from "@/repositories/scenario-repository";
import { createFakeSupabase } from "../../support/fake-supabase";

/**
 * The scenario repository.
 *
 * Like every repository: typed in, typed out, rows validated on the way out,
 * and no Postgres detail escaping. The vector search goes through the
 * database function so filtering happens before ranking, and the embedding
 * travels in pgvector's literal string form.
 */

const SUMMARY_ROW = {
  id: 1,
  slug: "dialogue-a1-im-restaurant",
  type: "dialogue",
  kind: "dialogue",
  title: "Im Restaurant",
  title_english: "At the Restaurant",
  description: "A customer orders lunch.",
  target_level: "A1",
  source: "Conversational_German_15_Dialogue_Stories.md",
  item_index: 0,
};

const FULL_ROW = {
  ...SUMMARY_ROW,
  content: {
    setting: "A small restaurant.",
    lines: [{ speaker: "Anna", german: "Guten Tag!", english: "Hello!" }],
  },
  vocabulary: [{ term: "die Suppe", meaning: "soup" }],
};

describe("listing scenarios", () => {
  it("returns validated summaries in corpus order", async () => {
    const fake = createFakeSupabase({ scenarios: { data: [SUMMARY_ROW] } });
    const repository = createScenarioRepository(fake.client);

    const outcome = await repository.list();

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.data).toHaveLength(1);
      expect(outcome.data[0].titleEnglish).toBe("At the Restaurant");
      expect(outcome.data[0].similarity).toBeUndefined();
      // The citation travels with every card.
      expect(outcome.data[0].source).toBe(
        "Conversational_German_15_Dialogue_Stories.md",
      );
      expect(outcome.data[0].itemIndex).toBe(0);
    }
    expect(fake.methodArgs("scenarios", "order").length).toBeGreaterThan(0);
    const selected = fake.methodArgs("scenarios", "select")[0]?.[0];
    expect(selected).toContain("source");
    expect(selected).toContain("item_index");
  });

  it("fails the read when a row arrives without its citation", async () => {
    const { source: _source, ...uncited } = SUMMARY_ROW;
    const fake = createFakeSupabase({ scenarios: { data: [uncited] } });

    const outcome = await createScenarioRepository(fake.client).list();

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("invalid_data");
  });

  it("fails the read when a row is malformed rather than passing it on", async () => {
    const fake = createFakeSupabase({
      scenarios: { data: [{ ...SUMMARY_ROW, type: "quiz" }] },
    });

    const outcome = await createScenarioRepository(fake.client).list();

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("invalid_data");
  });
});

describe("reading one scenario", () => {
  it("returns the full body by slug", async () => {
    const fake = createFakeSupabase({ scenarios: { data: FULL_ROW } });
    const repository = createScenarioRepository(fake.client);

    const outcome = await repository.getBySlug("dialogue-a1-im-restaurant");

    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.data.type === "dialogue") {
      expect(outcome.data.content.lines[0].german).toBe("Guten Tag!");
    }
    expect(fake.methodArgs("scenarios", "eq")).toEqual([
      ["slug", "dialogue-a1-im-restaurant"],
    ]);
  });

  it("rejects a slug that is not a slug before any query is made", async () => {
    const fake = createFakeSupabase({});
    const repository = createScenarioRepository(fake.client);

    const outcome = await repository.getBySlug("not a slug!!");

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("invalid_input");
    expect(fake.calls).toHaveLength(0);
  });

  it("reports a missing scenario as not found", async () => {
    const fake = createFakeSupabase({
      scenarios: { data: null, error: { code: "PGRST116", message: "0 rows" } },
    });

    const outcome = await createScenarioRepository(fake.client).getBySlug(
      "dialogue-a1-im-restaurant",
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("not_found");
  });
});

describe("vector search", () => {
  beforeEach(() => {});

  it("calls the search function with the embedding as a pgvector literal", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: [{ ...SUMMARY_ROW, similarity: 0.91 }] });
    const repository = createScenarioRepository(fake.client);

    const outcome = await repository.searchByVector([0.25, -0.5], {
      types: ["dialogue"],
      levels: null,
      limit: 12,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.data[0].similarity).toBeCloseTo(0.91);
    }
    expect(fake.rpcCalls).toEqual([
      {
        fn: "search_scenarios",
        args: {
          p_embedding: "[0.25,-0.5]",
          p_types: ["dialogue"],
          p_levels: null,
          p_limit: 12,
        },
      },
    ]);
  });

  it("clamps similarity into the unit interval rather than failing the row", async () => {
    // Float drift can put an identical vector a hair above 1; the domain
    // schema would reject it, and a perfect match must not be an error.
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: [{ ...SUMMARY_ROW, similarity: 1.0000001 }] });

    const outcome = await createScenarioRepository(fake.client).searchByVector(
      [0.1],
      { types: null, levels: null, limit: 12 },
    );

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.data[0].similarity).toBe(1);
  });

  it("maps a database failure to a closed error kind", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({
      data: null,
      error: { code: "42883", message: "operator does not exist" },
    });

    const outcome = await createScenarioRepository(fake.client).searchByVector(
      [0.1],
      { types: null, levels: null, limit: 12 },
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).not.toMatch(/operator/);
  });
});
