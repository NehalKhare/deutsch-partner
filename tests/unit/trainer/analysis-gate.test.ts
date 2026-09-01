import { describe, expect, it } from "vitest";

import { shouldAnalyze } from "@/lib/trainer/analysis-gate";

/**
 * The gate is deterministic and cheap-side biased: everything that plainly
 * carries no German to check is refused with a reason, and anything that
 * might is let through — a wrongly analysed English sentence costs a fraction
 * of a cent, a wrongly skipped German answer costs the learner a correction.
 */

describe("what gets analyzed", () => {
  it.each([
    ["a plain German sentence", "Ich fahre mit dem Zug."],
    ["a German sentence with a mistake", "Ich fahre mit der Zug."],
    ["umlauts with no function words", "Schöne Grüße aus München!"],
    ["mixed English carrying a German attempt", "Is it richtig to say ich bin kalt today?"],
  ])("passes %s", (_label, message) => {
    expect(shouldAnalyze(message)).toEqual({ analyze: true });
  });

  it.each([
    ["an empty message", "   ", "empty"],
    ["an emoji-only message", "👍👍", "no_letters"],
    ["a one-word answer", "fahren", "too_short"],
    ["a formulaic greeting", "Guten Morgen", "formulaic"],
    ["an English question", "What exactly is the Perfekt tense?", "not_german"],
  ])("skips %s", (_label, message, reason) => {
    expect(shouldAnalyze(message)).toEqual({ analyze: false, reason });
  });
});
