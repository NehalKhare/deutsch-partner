import { describe, expect, it } from "vitest";

import { RRF_K, fuse } from "@/lib/retrieval/fusion";
import type { RetrievalCandidate } from "@/lib/retrieval/scoring";

const candidate = (id: number, similarity = 0): RetrievalCandidate => ({
  id,
  documentId: 1,
  content: `chunk ${id}`,
  cefr: "A2",
  miniLevel: 20,
  topic: null,
  skill: null,
  grammarTarget: null,
  contentType: "grammar",
  difficulty: null,
  tokenCount: null,
  similarity,
});

const ids = (results: readonly RetrievalCandidate[]) => results.map((r) => r.id);

describe("reciprocal rank fusion", () => {
  it("returns nothing for two empty arms", () => {
    expect(fuse([{ results: [], weight: 1 }, { results: [], weight: 1 }])).toEqual([]);
  });

  it("passes a single arm through in its own order", () => {
    const fused = fuse([
      { results: [candidate(3), candidate(1), candidate(2)], weight: 1 },
      { results: [], weight: 1 },
    ]);

    expect(ids(fused)).toEqual([3, 1, 2]);
  });

  it("puts a chunk both arms found above one only a single arm found", () => {
    // Agreement between two independent searches is the strongest signal
    // hybrid retrieval has.
    const fused = fuse([
      { results: [candidate(1), candidate(2)], weight: 1 },
      { results: [candidate(3), candidate(2)], weight: 1 },
    ]);

    expect(ids(fused)[0]).toBe(2);
  });

  it("compares positions rather than scores", () => {
    // ts_rank and cosine similarity are not on the same scale and never will
    // be; normalising them against each other would be inventing a comparison.
    const fused = fuse([
      { results: [candidate(1, 0.99)], weight: 1 },
      { results: [candidate(2, 0.0001)], weight: 1 },
    ]);

    expect(fused[0].similarity).toBe(fused[1].similarity);
  });

  it("honours an arm's weight", () => {
    const fused = fuse([
      { results: [candidate(1)], weight: 0.1 },
      { results: [candidate(2)], weight: 1 },
    ]);

    expect(ids(fused)).toEqual([2, 1]);
  });

  it("ignores an arm weighted to nothing", () => {
    const fused = fuse([
      { results: [candidate(1)], weight: 1 },
      { results: [candidate(2)], weight: 0 },
    ]);

    expect(fused[0].id).toBe(1);
    expect(fused[1].similarity).toBe(0);
  });

  it("rescales the best candidate to one", () => {
    const fused = fuse([{ results: [candidate(1), candidate(2)], weight: 1 }]);

    expect(fused[0].similarity).toBe(1);
    expect(fused[1].similarity).toBeLessThan(1);
  });

  it("damps the gap between the first two positions", () => {
    // Without the constant, rank 1 would be twice rank 2 and appearing in both
    // arms would count for almost nothing.
    const fused = fuse([{ results: [candidate(1), candidate(2)], weight: 1 }]);

    expect(fused[1].similarity).toBeCloseTo((RRF_K + 1) / (RRF_K + 2), 6);
  });

  it("keeps one row per chunk", () => {
    const fused = fuse([
      { results: [candidate(1), candidate(2)], weight: 1 },
      { results: [candidate(2), candidate(1)], weight: 1 },
    ]);

    expect(fused).toHaveLength(2);
  });

  it("breaks a tie the same way every time", () => {
    const fused = fuse([
      { results: [candidate(9)], weight: 1 },
      { results: [candidate(4)], weight: 1 },
    ]);

    expect(ids(fused)).toEqual([4, 9]);
  });

  it("keeps the row's own fields", () => {
    const fused = fuse([{ results: [candidate(1)], weight: 1 }]);

    expect(fused[0]).toMatchObject({ content: "chunk 1", contentType: "grammar" });
  });
});
