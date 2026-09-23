import { describe, expect, it } from "vitest";

import { cursorFor, learnerListQuery, learnerParams, learnersHref } from "@/lib/learner-query";

const ID = "22222222-2222-4222-8222-222222222222";

describe("the learner list's search params", () => {
  it("keeps what parses and drops what does not", () => {
    expect(
      learnerParams({ cefr: "A2", onboarded: "no", inactive: "14", deleted: "fedcba98", before: "garbage" }),
    ).toEqual({ cefr: "A2", onboarded: "no", inactive: 14, deleted: "fedcba98" });
    expect(learnerParams({ cefr: "C2", inactive: "0", onboarded: "maybe" })).toEqual({});
  });

  it("becomes the repository's query, cursor and all", () => {
    const cursor = cursorFor({ createdAt: new Date("2026-09-10T00:00:00Z"), id: ID });

    expect(learnerListQuery(learnerParams({ onboarded: "yes", before: cursor }))).toEqual({
      cefr: undefined,
      onboarded: true,
      inactiveDays: undefined,
      before: { createdAt: new Date("2026-09-10T00:00:00Z"), id: ID },
    });
  });

  it("links back without the deletion notice, which is for one view only", () => {
    expect(learnersHref({ cefr: "B1", deleted: "fedcba98" })).toBe("/learners?cefr=B1");
    expect(learnersHref({})).toBe("/learners");
  });
});
