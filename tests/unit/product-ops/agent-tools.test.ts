import { describe, expect, it } from "vitest";

import type { MarketFinding } from "@/domain/product-ops";
import { gatewayOk } from "@/lib/ai/gateway/errors";
import type {
  Citation,
  CompletionOutcome,
  ModelGateway,
} from "@/lib/ai/gateway/gateway";
import type { Applier, ApplyOutcome } from "@/lib/product-ops/apply";
import {
  TOOL_FENCES,
  coderTools,
  cpoTools,
  plannerTools,
  researchTools,
  type RepositoryBrowser,
} from "@/lib/product-ops/agents/tools";
import {
  PRODUCT_OPS_AGENT_TOOLS,
  PRODUCT_OPS_TOOL_NAMES,
} from "@/lib/ai/prompts/product-ops-agents";

/**
 * The agents' tools, called directly.
 *
 * Every tool is a narrow door, and what is asserted here is what each door
 * refuses: an uncited address, a denied path, a prefix that climbs out, a
 * write the validation layer will not take. The tools are invoked the way the
 * framework invokes them, with parsed arguments, and answer JSON strings.
 */

const CONTEXT = {
  requestId: "11111111-1111-4111-8111-111111111111",
  userIdHash: "hash-operator",
};

const FINDING: MarketFinding = {
  title: "Nurses cannot certify in German",
  sourceType: "forum",
  sourceUrl: "https://example.test/thread/1",
  summary: "Recurring complaint about medical vocabulary gaps.",
  painPoints: ["no medical vocabulary"],
  trends: ["healthcare recruitment"],
  evidence: [
    { url: "https://example.test/thread/1", finding: "Twelve replies agree." },
    { url: "https://invented.test/nowhere", finding: "Nobody said this." },
  ],
  relevanceScore: 0.8,
};

const invoke = async (
  tools: readonly { name: string; invoke(input: unknown): Promise<unknown> }[],
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const found = tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  const result = await found.invoke(args);
  return JSON.parse(typeof result === "string" ? result : JSON.stringify(result)) as Record<
    string,
    unknown
  >;
};

function gatewayReturning(text: string, citations: readonly Citation[]) {
  const gateway: ModelGateway = {
    async complete() {
      return gatewayOk<CompletionOutcome>({
        text,
        truncated: false,
        degraded: false,
        tier: "cheap",
        modelIdResolved: "vendor/model",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
        costEur: 0,
        attempts: 1,
        ledgerId: 1,
        citations,
      });
    },
    async stream() {
      throw new Error("product ops does not stream");
    },
  };
  return gateway;
}

describe("the tool catalogue", () => {
  it("gives every tool a fence and a description", () => {
    for (const name of PRODUCT_OPS_TOOL_NAMES) {
      expect(TOOL_FENCES[name], name).toBeDefined();
    }
  });

  it("builds exactly the tools each agent's prompt names", () => {
    const research = researchTools({
      specialist: { gateway: gatewayReturning("{}", []) },
      context: CONTEXT,
      record: async () => true,
    }).tools.map((tool) => tool.name);
    expect(research.sort()).toEqual([...PRODUCT_OPS_AGENT_TOOLS.research].sort());

    const cpo = cpoTools({ findings: [], prior: [] }).map((tool) => tool.name);
    expect(cpo.sort()).toEqual([...PRODUCT_OPS_AGENT_TOOLS.cpo].sort());

    const planner = plannerTools({ prd: "", browser: fakeBrowser() }).map((tool) => tool.name);
    expect(planner.sort()).toEqual([...PRODUCT_OPS_AGENT_TOOLS.planner].sort());

    const coder = coderTools({ applier: fakeApplier(), onChange: () => undefined }).tools.map(
      (tool) => tool.name,
    );
    expect(coder.sort()).toEqual([...PRODUCT_OPS_AGENT_TOOLS.coder].sort());
  });
});

describe("research tools", () => {
  it("searches through the gateway and records what it found, grounded", async () => {
    const stored: MarketFinding[][] = [];
    const gateway = gatewayReturning(JSON.stringify({ findings: [FINDING] }), [
      { url: "https://example.test/thread/1", title: null },
    ]);
    const toolset = researchTools({
      specialist: { gateway },
      context: CONTEXT,
      record: async (findings) => {
        stored.push([...findings]);
        return true;
      },
    });

    const result = await invoke(toolset.tools, "search_market", { query: "nurses German" });

    expect(result.recorded).toBe(1);
    expect(result.sources).toEqual(["https://example.test/thread/1"]);
    expect(toolset.searches()).toBe(1);
    expect(toolset.recorded()).toBe(1);
    // The specialist dropped the invented address before the row was written.
    expect(stored[0][0].evidence.map((item) => item.url)).toEqual([
      "https://example.test/thread/1",
    ]);
  });

  it("hands the model only the finding's title and summary, not the whole row", async () => {
    const gateway = gatewayReturning(JSON.stringify({ findings: [FINDING] }), [
      { url: "https://example.test/thread/1", title: null },
    ]);
    const toolset = researchTools({ specialist: { gateway }, context: CONTEXT, record: async () => true });

    const result = await invoke(toolset.tools, "search_market", { query: "nurses German" });

    expect(result.findings).toEqual([{ title: FINDING.title, summary: FINDING.summary }]);
  });

  it("counts nothing recorded when the store refused", async () => {
    const gateway = gatewayReturning(JSON.stringify({ findings: [FINDING] }), [
      { url: "https://example.test/thread/1", title: null },
    ]);
    const toolset = researchTools({ specialist: { gateway }, context: CONTEXT, record: async () => false });

    const result = await invoke(toolset.tools, "search_market", { query: "nurses German" });

    expect(result.recorded).toBe(0);
    expect(toolset.recorded()).toBe(0);
  });

  it("reports a search that failed by its reason, and records nothing", async () => {
    const stored: unknown[] = [];
    const toolset = researchTools({
      specialist: { gateway: gatewayReturning("not json at all", []) },
      context: CONTEXT,
      record: async (findings) => {
        stored.push(findings);
        return true;
      },
    });

    const result = await invoke(toolset.tools, "search_market", { query: "nurses German" });

    expect(result).toEqual({ error: "invalid_output" });
    expect(stored).toEqual([]);
  });
});

describe("CPO tools", () => {
  it("answers the findings and the prior proposals it was given", async () => {
    const tools = cpoTools({
      findings: [FINDING],
      prior: [{ title: "Old idea", status: "rejected", problemStatement: "x" }],
    });

    expect(await invoke(tools, "read_findings", {})).toEqual({ findings: [FINDING] });
    expect(await invoke(tools, "list_prior_proposals", {})).toEqual({
      proposals: [{ title: "Old idea", status: "rejected", problemStatement: "x" }],
    });
  });

  it("says internal search is unavailable rather than failing, when nothing embeds", async () => {
    const tools = cpoTools({ findings: [], prior: [] });

    expect(await invoke(tools, "search_internal_docs", { query: "dative" })).toEqual({
      error: "unavailable",
    });
  });

  it("bounds what an internal search returns", async () => {
    const tools = cpoTools({
      findings: [],
      prior: [],
      docs: {
        async search() {
          return Array.from({ length: 20 }, (_, index) => ({
            content: `chunk ${index}`,
            source: "corpus",
          }));
        },
      },
    });

    const result = await invoke(tools, "search_internal_docs", { query: "dative" });

    expect((result.chunks as unknown[]).length).toBe(8);
  });
});

function fakeBrowser(over: Partial<RepositoryBrowser> = {}): RepositoryBrowser & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async list(prefix) {
      asked.push(`list:${prefix}`);
      return ["lib/product-ops/apply.ts", ".env.local", "lib/ai/gateway/gateway.ts"];
    },
    async read(path) {
      asked.push(`read:${path}`);
      return `// ${path}\nexport const x = 1;`;
    },
    async search(text) {
      asked.push(`search:${text}`);
      return [
        { path: "lib/product-ops/apply.ts", line: 3, text },
        { path: "lib/ai/gateway/gateway.ts", line: 9, text },
      ];
    },
    ...over,
  };
}

describe("planner tools", () => {
  it("lists paths under a prefix, minus anything the deny-list covers", async () => {
    const browser = fakeBrowser();
    const tools = plannerTools({ prd: "The PRD", browser });

    const result = await invoke(tools, "list_files", { prefix: "lib/" });

    expect(result.paths).toEqual(["lib/product-ops/apply.ts"]);
    expect(browser.asked).toEqual(["list:lib"]);
  });

  it("refuses a prefix that climbs out of the repository", async () => {
    const browser = fakeBrowser();
    const tools = plannerTools({ prd: "The PRD", browser });

    await expect(invoke(tools, "list_files", { prefix: "../secrets" })).rejects.toThrow();
    await expect(invoke(tools, "list_files", { prefix: "/etc" })).rejects.toThrow();
    expect(browser.asked).toEqual([]);
  });

  it("refuses to read a denied path before asking the workspace", async () => {
    const browser = fakeBrowser();
    const tools = plannerTools({ prd: "The PRD", browser });

    const result = await invoke(tools, "read_file", { path: ".env.local" });

    expect(result).toEqual({ error: "denied_path" });
    expect(browser.asked).toEqual([]);
  });

  it("refuses a path shaped like an escape before asking the workspace", async () => {
    const browser = fakeBrowser();
    const tools = plannerTools({ prd: "The PRD", browser });

    await expect(invoke(tools, "read_file", { path: "../package.json" })).rejects.toThrow();
    expect(browser.asked).toEqual([]);
  });

  it("reads a permitted file and says when it was cut", async () => {
    const browser = fakeBrowser({ async read() { return "x".repeat(30_000); } });
    const tools = plannerTools({ prd: "The PRD", browser });

    const result = await invoke(tools, "read_file", { path: "lib/product-ops/apply.ts" });

    expect(result.truncated).toBe(true);
    expect((result.content as string).length).toBe(24_000);
  });

  it("drops search hits inside denied paths", async () => {
    const tools = plannerTools({ prd: "The PRD", browser: fakeBrowser() });

    const result = await invoke(tools, "search_code", { text: "createApplier" });

    expect(result.hits).toEqual([{ path: "lib/product-ops/apply.ts", line: 3, text: "createApplier" }]);
  });

  it("refuses a search text carrying a control character", async () => {
    const tools = plannerTools({ prd: "The PRD", browser: fakeBrowser() });

    await expect(invoke(tools, "search_code", { text: "a b" })).rejects.toThrow();
  });

  it("hands over the PRD it was built with", async () => {
    const tools = plannerTools({ prd: "The PRD", browser: fakeBrowser() });

    expect(await invoke(tools, "read_prd", {})).toEqual({ prd: "The PRD" });
  });
});

function fakeApplier(over: Partial<Applier> = {}): Applier & { applied: string[] } {
  const applied: string[] = [];
  return {
    applied,
    async read(path) {
      return path.startsWith("lib/") ? `// ${path}` : null;
    },
    async apply(edit) {
      applied.push(edit.path);
      const refused = edit.path.startsWith("secret");
      return {
        path: edit.path,
        applied: !refused,
        editCount: refused ? 0 : 1,
        bytesBefore: refused ? null : 10,
        bytesAfter: refused ? null : 20,
        rejectedReason: refused ? "not_in_plan" : null,
      };
    },
    writtenBytes: () => 0,
    ...over,
  };
}

const EDIT = {
  kind: "modify" as const,
  path: "lib/product-ops/apply.ts",
  rationale: "Adds the thing.",
  edits: [{ anchor: "export const x = 1;", replacement: "export const x = 2;" }],
};

describe("coder tools", () => {
  it("reads through the applier, which is behind the plan's allowlist", async () => {
    const tools = coderTools({ applier: fakeApplier(), onChange: () => undefined }).tools;

    expect(await invoke(tools, "read_file", { path: "lib/product-ops/apply.ts" })).toMatchObject({
      path: "lib/product-ops/apply.ts",
      truncated: false,
    });
    expect(await invoke(tools, "read_file", { path: "docs/other.md" })).toEqual({
      error: "not_readable",
    });
  });

  it("applies an edit through the validation layer and records it", async () => {
    const changes: ApplyOutcome[] = [];
    const toolset = coderTools({
      applier: fakeApplier(),
      onChange: (outcome) => void changes.push(outcome),
    });

    const result = await invoke(toolset.tools, "propose_edit", { edit: EDIT });

    expect(result).toEqual({ applied: true, path: EDIT.path, edits: 1 });
    expect(changes).toHaveLength(1);
    expect(toolset.changes()).toEqual(changes);
  });

  it("tells the model exactly why a write was refused, and records the refusal too", async () => {
    const changes: ApplyOutcome[] = [];
    const toolset = coderTools({
      applier: fakeApplier(),
      onChange: (outcome) => void changes.push(outcome),
    });

    const result = await invoke(toolset.tools, "propose_edit", {
      edit: { ...EDIT, path: "secret/thing.ts" },
    });

    expect(result).toMatchObject({ applied: false, refused: true, error: "not_in_plan" });
    expect(changes[0].rejectedReason).toBe("not_in_plan");
  });

  it("refuses an edit the schema will not accept before it reaches the applier", async () => {
    const applier = fakeApplier();
    const tools = coderTools({ applier, onChange: () => undefined }).tools;

    await expect(
      invoke(tools, "propose_edit", { edit: { ...EDIT, edits: [{ anchor: "", replacement: "x" }] } }),
    ).rejects.toThrow();
    expect(applier.applied).toEqual([]);
  });
});
