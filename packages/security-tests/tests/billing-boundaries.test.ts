import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, ROOTS, sourceFiles, under } from "../src/roots";

/**
 * The boundaries around taking money.
 *
 * billing-and-plans-spec.md S6, S8 and S12, stated as the model-access rules
 * are: one package may reach Stripe, so that a signature check, the event
 * inbox and the closed error vocabulary cannot be walked around by a module
 * that opens its own client; nothing a browser loads can import it; and the
 * payment methods a learner is offered are the Dashboard's decision, never a
 * list in code.
 */

const files = sourceFiles();
const inBilling = (path: string) => under(path, ROOTS.billing);
const isDouble = (path: string) => ROOTS.billingDoubles.some((root) => under(path, root));

function isClientComponent(source: string) {
  return /^\s*["']use client["']/m.test(source);
}

function dependenciesOf(pkgDir: string): string[] {
  const json = JSON.parse(readFileSync(join(REPO_ROOT, pkgDir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return Object.keys({ ...json.dependencies, ...json.devDependencies });
}

/** Every workspace, apps and packages alike. */
function workspaces(): string[] {
  return ["apps", "packages"].flatMap((group) =>
    readdirSync(join(REPO_ROOT, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${group}/${entry.name}`)
      .filter((dir) => {
        try {
          readFileSync(join(REPO_ROOT, dir, "package.json"));
          return true;
        } catch {
          return false;
        }
      }),
  );
}

describe("only the billing package may reach Stripe", () => {
  it("finds the billing package", () => {
    expect(files.some((file) => inBilling(file.path))).toBe(true);
  });

  it("keeps the Stripe SDK out of every module outside it", () => {
    const offenders = files
      .filter((file) => !inBilling(file.path))
      .filter((file) => /from\s+["']stripe(\/[^"']*)?["']|require\(\s*["']stripe["']\s*\)/.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("lets nothing outside it call Stripe's API directly", () => {
    const offenders = files
      .filter((file) => !inBilling(file.path))
      .filter((file) => /https:\/\/(api|files|connect)\.stripe\.com/.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("is the only workspace that depends on the SDK", () => {
    const holders = workspaces().filter((dir) => dependenciesOf(dir).includes("stripe"));

    expect(holders).toEqual(["packages/billing"]);
  });
});

describe("the browser cannot reach it", () => {
  it("keeps the billing package out of every Client Component", () => {
    // A Client Component is shown what the server read, as a view model; it
    // never imports the module that holds the secret key.
    const offenders = files
      .filter((file) => isClientComponent(file.source))
      .filter((file) => /from\s+["']@dp\/billing(\/[^"']*)?["']/.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });
});

describe("the doubles stay in the tests", () => {
  it("lets no product module import the mock provider or the memory store", () => {
    // A composition root that could reach the mock would be a way to grant
    // a plan nobody paid for. Both spellings, as for the voice doubles.
    const reaches = /["'](?:@dp\/billing\/(?:mock|testing\/[^"']*)|\.{1,2}\/(?:[^"']*\/)?(?:mock|testing\/[^"']*))(?:\.js|\.ts)?["']/;
    const offenders = files
      .filter((file) => inBilling(file.path) || /@dp\/billing/.test(file.source))
      .filter((file) => !isDouble(file.path))
      .filter((file) => reaches.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });
});

describe("payment methods are the Dashboard's", () => {
  it("never names a list of payment method types in code", () => {
    // Dynamic payment methods are how cards, Apple Pay, Google Pay, Klarna,
    // SEPA Direct Debit and PayPal are switched on and off without a deploy,
    // and how each learner sees only what works where they are (spec S6).
    const offenders = files
      .filter((file) => /payment_method_types/.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });
});
