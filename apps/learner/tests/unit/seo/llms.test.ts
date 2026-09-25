import { describe, expect, it } from "vitest";

import { FAQ } from "@/lib/landing/faq";
import { ROOMS } from "@/lib/landing/rooms";
import { timelinePhrase } from "@/lib/landing/timeline";
import { llmsText } from "@/lib/seo/llms";
import { PRIVATE_PATHS, PUBLIC_PAGES, SITE } from "@/lib/seo/site";

/**
 * /llms.txt: what a language model is handed when it asks what the product
 * is. The convention is checked, and so is the honesty: every figure is the
 * one the page computes, and nothing behind sign-in is mentioned.
 */

const ORIGIN = "https://deutschpartner.example";
const text = llmsText(ORIGIN);

describe("the convention", () => {
  it("opens with the name as a top-level heading and the summary as a blockquote", () => {
    const [title, blank, summary] = text.split("\n");
    expect(title).toBe(`# ${SITE.name}`);
    expect(blank).toBe("");
    expect(summary).toBe(`> ${SITE.description}`);
  });

  it("is sectioned with second-level headings", () => {
    expect(text).toMatch(/^## What a learner does$/m);
    expect(text).toMatch(/^## How long it takes$/m);
    expect(text).toMatch(/^## What it does not do$/m);
    expect(text).toMatch(/^## Questions$/m);
    expect(text).toMatch(/^## Pages$/m);
  });

  it("ends with a newline, as a text file should", () => {
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("what it says", () => {
  it("lists every room in the page's own words", () => {
    for (const room of ROOMS) {
      expect(text).toContain(`- **${room.name}.** ${room.what}`);
    }
  });

  it("gives the timeline the page computes, at both paces", () => {
    expect(text).toContain(`- B1: ${timelinePhrase("B1", 30)} at 30 minutes a day, ${timelinePhrase("B1", 60)} at 60 minutes a day.`);
  });

  it("answers every question the page answers", () => {
    for (const entry of FAQ) {
      expect(text).toContain(`### ${entry.question}\n\n${entry.answer}`);
    }
  });

  it("states the limits, not only the features", () => {
    expect(text).toMatch(/does not issue certificates/);
  });

  it("links every public page by its absolute address", () => {
    for (const page of PUBLIC_PAGES) {
      expect(text).toContain(`](${new URL(page.path, ORIGIN).toString()})`);
    }
  });

  it("mentions nothing behind sign-in", () => {
    for (const path of PRIVATE_PATHS) {
      expect(text).not.toContain(`${ORIGIN}${path}`);
    }
  });

  it("describes the product and does not instruct the reader", () => {
    // This is a description for a model, not a prompt to one. The rule the
    // security tests apply to prompt-shaped strings applies here in spirit.
    expect(text).not.toMatch(/\b(You are|Your task is|Respond only)\b/);
  });
});
