import { describe, expect, it } from "vitest";

import { scenarioCitation, sourceTitle } from "@/lib/scenarios/citation";

describe("citing a scenario's source", () => {
  it("names the dialogue document as its own title page does", () => {
    expect(
      scenarioCitation({
        source: "Conversational_German_15_Dialogue_Stories.md",
        itemIndex: 0,
      }),
    ).toBe("Conversational German: 15 Dialogue Stories, item 1");
  });

  it("names the comprehension document as its own title page does", () => {
    expect(
      scenarioCitation({
        source: "German_Listening_and_Comprehension_Practice.md",
        itemIndex: 34,
      }),
    ).toBe("German Listening & Comprehension Practice, item 35");
  });

  it("counts items the way a person does, from one", () => {
    expect(scenarioCitation({ source: "x.md", itemIndex: 4 })).toMatch(/item 5$/);
  });

  it("gives an unknown document a readable name rather than a file path", () => {
    expect(sourceTitle("Some_Future_Corpus.md")).toBe("Some Future Corpus");
  });
});
