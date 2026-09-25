import { describe, expect, it } from "vitest";

import { ANSWER_ENGINE_AGENTS, CONTENT_SIGNAL, crawlPolicy } from "@/lib/seo/crawlers";
import { PRIVATE_PATHS } from "@/lib/seo/site";

/**
 * Who may crawl, and where. Two deployments: one nobody may index, one
 * everybody may — on the public pages only.
 */

type Rule = {
  userAgent?: string | string[];
  allow?: string | string[];
  disallow?: string | string[];
  other?: Record<string, unknown>;
};

function rulesOf(indexing: boolean): Rule[] {
  const rules = crawlPolicy(indexing);
  return Array.isArray(rules) ? rules : [rules];
}

function agentsOf(rule: Rule): string[] {
  return Array.isArray(rule.userAgent) ? rule.userAgent : rule.userAgent ? [rule.userAgent] : [];
}

const asList = (value: string | string[] | undefined) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

describe("a deployment that may not be indexed", () => {
  it("turns every agent away from everything, with the one directive every crawler honours", () => {
    expect(rulesOf(false)).toEqual([{ userAgent: "*", disallow: "/" }]);
  });
});

describe("a deployment that may be indexed", () => {
  const rules = rulesOf(true);

  it("allows the public pages to everyone", () => {
    for (const rule of rules) {
      expect(asList(rule.allow)).toContain("/");
      expect(asList(rule.disallow)).not.toContain("/");
    }
  });

  it("keeps every agent out of every private path", () => {
    for (const rule of rules) {
      for (const path of PRIVATE_PATHS) {
        expect(asList(rule.disallow), `${agentsOf(rule).join(",")} ${path}`).toContain(path);
      }
    }
  });

  it("names each answer engine, so letting it in is a decision and not a default", () => {
    const named = rules.flatMap(agentsOf);
    for (const agent of ANSWER_ENGINE_AGENTS) {
      expect(named).toContain(agent);
    }
  });

  it("says the site may be searched and quoted, and stays silent on training", () => {
    const general = rules.find((rule) => agentsOf(rule).includes("*"));
    expect(general?.other).toEqual({ "Content-Signal": CONTENT_SIGNAL });
    expect(CONTENT_SIGNAL).toMatch(/search=yes/);
    expect(CONTENT_SIGNAL).toMatch(/ai-input=yes/);
    expect(CONTENT_SIGNAL).not.toMatch(/ai-train/);
  });
});

describe("the answer engines", () => {
  it("include the ones that quote, not only the ones that train", () => {
    // A user asking ChatGPT, Claude or Perplexity about the product is served
    // by these agents, fetched live; a policy that only knew GPTBot would
    // shape training and leave the answer to whoever else wrote about it.
    for (const agent of ["ChatGPT-User", "Claude-User", "Perplexity-User", "OAI-SearchBot", "Claude-SearchBot"]) {
      expect(ANSWER_ENGINE_AGENTS).toContain(agent);
    }
  });

  it("names each agent once", () => {
    expect(new Set(ANSWER_ENGINE_AGENTS).size).toBe(ANSWER_ENGINE_AGENTS.length);
  });
});
