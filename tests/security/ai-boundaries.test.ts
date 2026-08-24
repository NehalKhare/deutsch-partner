import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCANNED_DIRS = ["app", "components", "domain", "learning", "lib", "repositories"];

/**
 * The boundaries around anything that talks to a model.
 *
 * The rules from build-spec.md 16.5 and system-prompt-catalogue.md S1, all of
 * which are only worth stating if something enforces them: the first module
 * that reaches for a provider SDK, names a model, writes down a price, or
 * pastes a prompt at its call site fails in CI rather than in review.
 *
 * The gateway itself is held to a narrower version of the same rules. Being
 * the one place allowed to reach a provider is only useful if, inside it,
 * there is still exactly one file that does.
 */

const AI_DIR = join("lib", "ai");
const GATEWAY_DIR = join("lib", "ai", "gateway");
const VOICE_DIR = join("lib", "ai", "voice");
const PROMPTS_DIR = join("lib", "ai", "prompts");

function sourceFiles(): Array<{ path: string; source: string }> {
  const found: Array<{ path: string; source: string }> = [];

  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) {
        found.push({ path: relative(ROOT, full), source: readFileSync(full, "utf8") });
      }
    }
  };

  for (const dir of SCANNED_DIRS) walk(join(ROOT, dir));
  return found;
}

const files = sourceFiles();

describe("only the gateway may reach a model", () => {
  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each([
    ["the OpenAI SDK", /from\s+["']openai["']/],
    ["the Vercel AI SDK", /from\s+["']@ai-sdk\//],
    ["the Anthropic SDK", /from\s+["']@anthropic-ai\//],
    ["a LangChain model package", /from\s+["']@langchain\/(openai|anthropic|google)/],
  ])("keeps %s out of every module outside the gateway", (_label, pattern) => {
    const offenders = files
      .filter((file) => !file.path.startsWith(GATEWAY_DIR))
      .filter((file) => pattern.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("lets nothing outside the gateway call a provider endpoint directly", () => {
    const offenders = files
      .filter((file) => !file.path.startsWith(GATEWAY_DIR))
      .filter((file) => !file.path.startsWith(VOICE_DIR))
      .filter((file) =>
        /https:\/\/(openrouter\.ai|api\.openai\.com|api\.anthropic\.com)/.test(file.source),
      )
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("keeps the transport contract between the gateway and its callers", () => {
    // A caller holding a ModelTransport can dispatch without a spec, a budget
    // check or a ledger row — every guarantee the gateway exists to make.
    const offenders = files
      .filter((file) => !file.path.startsWith(GATEWAY_DIR))
      .filter((file) => /gateway\/(transport|openrouter)["']/.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("keeps the voice doubles out of the product", () => {
    // The mocks live under lib/ so the boundary rules in this file apply to
    // them too. The other half of that bargain is this: a test double that a
    // composition root can reach is a way to ship fabricated transcriptions
    // and silence, so only tests may import it.
    const mock = join(VOICE_DIR, "mock.ts");
    // Both spellings: the alias from anywhere, and the relative one that only
    // a sibling inside lib/ai/voice could write. A gate that one import style
    // walks past is not a gate.
    const reaches = /["'][^"']*(?:voice\/mock|\.\/mock)(?:\.js|\.ts)?["']/;
    const offenders = files
      .filter((file) => file.path !== mock)
      .filter((file) => reaches.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("hardcodes no model id outside the registry", () => {
    // Model ids look like provider/model. A tier is what application code is
    // allowed to name; which model serves a tier is registry and environment.
    const modelId = /["'](openai|anthropic|google|meta-llama|mistralai|deepseek|qwen)\/[\w.:-]+["']/;
    const offenders = files
      .filter((file) => !file.path.startsWith(GATEWAY_DIR))
      .filter((file) => modelId.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("names no per-token price constant anywhere", () => {
    // Prices come from the provider's model list with a fetched_at stamp.
    // A constant named for a unit price is one nobody will remember to refresh.
    const priceConstant = /(pricePer|costPer|_PER_MILLION|perMillionTokens|unitPrice)/i;
    const offenders = files
      .filter((file) => priceConstant.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("hardcodes no price or rate literal anywhere", () => {
    // The gate that matters: a fractional number written next to a name that
    // means money. Reading one out of a snapshot is fine; writing one down is
    // a figure that goes quietly stale with nothing failing.
    const priceLiteral = /\b[A-Za-z_]*(price|rate)[A-Za-z_]*\s*[:=]\s*-?\d+\.\d+/i;
    const offenders = files
      .filter((file) => priceLiteral.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });
});

describe("inside the gateway", () => {
  const gatewayFiles = files.filter((file) => file.path.startsWith(GATEWAY_DIR));

  it("finds the gateway", () => {
    expect(gatewayFiles.length).toBeGreaterThan(0);
  });

  it("opens a connection from exactly the named transport files", () => {
    // One per provider surface the application actually talks to: OpenRouter
    // for chat, completion and embeddings; OpenAI directly for speech, which
    // OpenRouter does not serve. A fourth needs a deliberate edit here.
    const transports = [
      join(GATEWAY_DIR, "openrouter.ts"),
      join(GATEWAY_DIR, "openrouter-embeddings.ts"),
      join(VOICE_DIR, "openai.ts"),
    ];
    const offenders = files
      .filter((file) => file.path.startsWith(AI_DIR))
      .filter((file) => !transports.includes(file.path))
      .filter((file) => /https:\/\/(?!\S*\.md)|\bfetch\(/.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("names a model in exactly one file", () => {
    const registryFile = join(GATEWAY_DIR, "registry.ts");
    const modelId = /["'](openai|anthropic|google|meta-llama|mistralai|deepseek|qwen)\/[\w.:-]+["']/;
    const offenders = gatewayFiles
      .filter((file) => file.path !== registryFile)
      .filter((file) => modelId.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("writes no conversation content into the ledger's row shape", () => {
    const ledger = gatewayFiles.find(
      (file) => file.path === join(GATEWAY_DIR, "ledger.ts"),
    );

    expect(ledger).toBeDefined();
    // The row shape is strict, so a content field would be a runtime failure
    // too. This catches it at the point somebody types it.
    expect(ledger?.source).not.toMatch(/^\s*(content|userMessage|transcript):/m);
  });
});

describe("prompts live in the catalogue, not at call sites", () => {
  it("puts no prompt-shaped string literal outside the prompt layer", () => {
    // The giveaway is a long literal that addresses a model in the second
    // person. One of those at a call site is one nobody can version or budget.
    const promptShaped = /["'`][^"'`]{80,}?\b(You are|Du bist|Your task is|Respond only)\b/;
    const offenders = files
      .filter((file) => !file.path.startsWith(PROMPTS_DIR))
      .filter((file) => promptShaped.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("keeps the prompt layer free of I/O", () => {
    // Assembling a prompt is a pure function of its inputs. A builder that can
    // read a database or the clock is a builder whose output is not reproducible
    // from a trace.
    const promptFiles = files.filter((file) => file.path.startsWith(PROMPTS_DIR));

    expect(promptFiles.length).toBeGreaterThan(0);

    for (const file of promptFiles) {
      expect(file.source, file.path).not.toMatch(/from\s+["']@supabase\//);
      expect(file.source, file.path).not.toMatch(/from\s+["']node:/);
      expect(file.source, file.path).not.toMatch(/process\.env/);
      expect(file.source, file.path).not.toMatch(/Date\.now\(\)|new Date\(\)/);
    }
  });
});
