import { describe, expect, it } from "vitest";

import { ERROR_TYPES } from "@/domain/learner-error";
import { ERROR_TYPE_LABELS } from "@/learning/error-labels";

/**
 * Every mistake category the evaluator can emit has a name a learner can
 * read. A missing one would put a slug on the dashboard, which is the exact
 * thing this map exists to prevent.
 */
describe("mistake labels", () => {
  it.each(ERROR_TYPES)("names %s in plain English", (errorType) => {
    const label = ERROR_TYPE_LABELS[errorType];

    expect(label.length).toBeGreaterThan(2);
    expect(label).not.toMatch(/_/);
    // Reads as a phrase, not a slug: starts with a capital letter.
    expect(label[0]).toBe(label[0]?.toUpperCase());
  });

  it("has no label for a category the domain does not define", () => {
    expect(Object.keys(ERROR_TYPE_LABELS).sort()).toEqual([...ERROR_TYPES].sort());
  });
});
