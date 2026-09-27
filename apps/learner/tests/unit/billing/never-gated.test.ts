// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * What no plan ever gates (billing-and-plans-spec.md S4), held structurally.
 *
 * Catch up and its reviews, the curriculum, the dashboard and the scenarios
 * cost nothing in model spend, and blocking spaced repetition breaks the
 * ladder a learner has already climbed. So nothing that serves them may
 * count a quota or read a plan to decide what to serve — and the daily quotas
 * are counted in exactly the four routes that spend on a model per request.
 */

const APP_ROOT = join(__dirname, "..", "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const rel = (path: string) => relative(APP_ROOT, path).split(sep).join("/");

const QUOTA_IMPORT = /from\s+["']@\/lib\/api\/quota["']/;
const PLAN_GATE = /planForRequest|consumeQuota|@\/lib\/billing\/refusal/;
/** A plan read to charge the learner's own allowance is not a gate; a quota or a plan refusal is. */
const QUOTA_OR_REFUSAL = /consumeQuota|consumeTrainerQuota|@\/lib\/api\/quota|@\/lib\/billing\/refusal|plan_required/;

describe("the daily quotas", () => {
  it("are counted in the four routes that spend on a model per request, and nowhere else", () => {
    const callers = [...sourceFiles(join(APP_ROOT, "app")), ...sourceFiles(join(APP_ROOT, "components"))]
      .filter((path) => QUOTA_IMPORT.test(readFileSync(path, "utf8")))
      .map(rel)
      .sort();

    expect(callers).toEqual([
      "app/api/chat/route.ts",
      "app/api/speak/route.ts",
      "app/api/trainer/route.ts",
      "app/api/transcribe/route.ts",
    ]);
  });
});

describe("what is free on every plan", () => {
  it.each([
    "app/(app)/review",
    "app/(app)/curriculum",
    "app/(app)/dashboard",
    "app/(app)/scenarios",
    "components/review",
    "components/curriculum",
    "components/dashboard",
    "components/scenarios",
  ])("%s reads no plan and counts no quota", (dir) => {
    const gated = sourceFiles(join(APP_ROOT, dir))
      .filter((path) => PLAN_GATE.test(readFileSync(path, "utf8")))
      .map(rel);

    expect(gated).toEqual([]);
  });

  it("lets scenario search read the plan only to charge the learner's own allowance", () => {
    // The search embeds the query on the learner's pseudonym, so its euro is
    // theirs and read against their plan's limit (spec S9). That is billing,
    // not a gate: it counts no quota and refuses nothing for a plan.
    const gated = sourceFiles(join(APP_ROOT, "app/api/scenarios"))
      .filter((path) => QUOTA_OR_REFUSAL.test(readFileSync(path, "utf8")))
      .map(rel);

    expect(gated).toEqual([]);
  });

  it("keeps the device's own voice outside the server, so no plan can reach it", () => {
    // Browser voice is unlimited on every plan: it never makes a request.
    const speech = readFileSync(join(APP_ROOT, "components/voice/speech.ts"), "utf8");

    expect(speech).not.toMatch(/fetch\(|\/api\//);
  });
});
