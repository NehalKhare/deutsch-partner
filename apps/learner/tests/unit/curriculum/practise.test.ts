import { describe, expect, it } from "vitest";

import { parseMiniLevelForm } from "@/lib/curriculum/practise";

/**
 * The form value a learner can edit, held to the path.
 *
 * The buttons only ever submit 1 to 70, so everything else here is somebody
 * editing the request — and the answer to an edited request is a refusal,
 * never a clamp to the nearest real level.
 */

function form(value: unknown): FormData {
  const data = new FormData();
  if (value !== undefined) data.set("miniLevel", String(value));
  return data;
}

describe("parsing a picked mini-level", () => {
  it.each([1, 2, 35, 70])("accepts %s", (level) => {
    expect(parseMiniLevelForm(form(level))).toEqual({
      success: true,
      miniLevel: level,
    });
  });

  it.each([
    ["zero", 0],
    ["past the path", 71],
    ["negative", -3],
    ["a fraction", 2.5],
    ["not a number", "zwei"],
    ["empty", ""],
    ["missing", undefined],
  ])("refuses %s", (_label, value) => {
    expect(parseMiniLevelForm(form(value))).toEqual({ success: false });
  });
});
