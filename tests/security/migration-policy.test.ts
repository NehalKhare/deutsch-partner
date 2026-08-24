import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { existsSync, readdirSync } from "node:fs";

import { migrationFiles, migrationSql } from "../db/harness";

/**
 * Static checks on the migration text.
 *
 * Most schema invariants are verified by introspecting a real database in
 * tests/db. These are the ones that cannot be: PGlite has no pgvector, so the
 * test harness substitutes the embedding column and drops the HNSW index. That
 * substitution could hide their absence, so their presence is asserted here.
 */

const sql = migrationSql();

/**
 * The same text with line comments removed.
 *
 * Hygiene rules are about what the migrations declare, not about what they
 * explain. A comment saying why a function is deliberately SECURITY INVOKER
 * cannot itself create a SECURITY DEFINER function, and a gate that cannot
 * tell the difference is a gate that punishes documentation.
 */
const statements = sql.replace(/--[^\n]*/g, "");

describe("migration files", () => {
  it("exist", () => {
    expect(migrationFiles().length).toBeGreaterThan(0);
  });

  it("are named with a sortable timestamp prefix", () => {
    for (const name of migrationFiles()) {
      expect(name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    }
  });

  it("have unique timestamps, so ordering is unambiguous", () => {
    const stamps = migrationFiles().map((name) => name.slice(0, 14));

    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it("enable row level security on every table they create", () => {
    // Order-independent on purpose: RLS may be enabled in the migration that
    // creates the table or in a later one, but a table that never gets it is
    // a hole no runtime test of the current schema would describe as new.
    const created = [
      ...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi),
    ].map((match) => match[1]);

    expect(created.length).toBeGreaterThan(0);

    const unprotected = created.filter(
      (table) =>
        !new RegExp(
          `alter table public\\.${table}\\s+enable row level security`,
          "i",
        ).test(sql),
    );

    expect(unprotected).toEqual([]);
  });
});

describe("pgvector", () => {
  // Not observable at runtime: the harness strips these for PGlite.
  it("enables the vector extension", () => {
    expect(sql).toMatch(/create extension if not exists vector/i);
  });

  it("stores embeddings in a fixed-dimension vector column", () => {
    expect(sql).toMatch(/embedding\s+vector\(\d+\)/i);
  });

  it("indexes embeddings with HNSW using cosine distance", () => {
    expect(sql).toMatch(/using hnsw \(embedding vector_cosine_ops\)/i);
  });
});

describe("migration hygiene", () => {
  it("declares no SECURITY DEFINER function", () => {
    expect(statements).not.toMatch(/security\s+definer/i);
  });

  it("uses no quoted mixed-case identifiers", () => {
    const quoted = statements.match(/"[A-Za-z_][A-Za-z0-9_]*"/g) ?? [];
    const mixedCase = quoted.filter(
      (identifier) => identifier !== identifier.toLowerCase(),
    );

    expect(mixedCase).toEqual([]);
  });

  it("uses timestamptz, never a naive timestamp", () => {
    expect(statements).not.toMatch(/\btimestamp\b(?!tz)/i);
  });

  it("never grants a table privilege to anon", () => {
    const anonGrants = (statements.match(/grant [^;]*? to [^;]*?anon[^;]*;/gi) ?? [])
      .map((statement) => statement.replace(/\s+/g, " ").trim());

    expect(anonGrants).toEqual([]);
  });

  it("revokes default privileges before granting them back", () => {
    // Supabase's default privileges can expose a new table automatically, so
    // every grant is preceded by an explicit revoke.
    expect(sql).toMatch(/revoke all on[\s\S]*?from anon, authenticated/i);
  });
});

describe("request guard", () => {
  const root = process.cwd();

  it("uses the proxy convention, not the deprecated middleware one", () => {
    // Next.js 16 renamed middleware.ts to proxy.ts. Both present, or only the
    // old one, means the guard silently does not run.
    expect(existsSync(join(root, "proxy.ts"))).toBe(true);
    expect(existsSync(join(root, "middleware.ts"))).toBe(false);
    expect(existsSync(join(root, "src", "middleware.ts"))).toBe(false);
  });

  it("exports a function named proxy", () => {
    const source = readFileSync(join(root, "proxy.ts"), "utf8");

    expect(source).toMatch(/export\s+(async\s+)?function\s+proxy\s*\(/);
  });

  it("excludes static assets from the matcher", () => {
    // Without this the guard intercepts CSS, JS and images.
    const source = readFileSync(join(root, "proxy.ts"), "utf8");

    expect(source).toMatch(/_next\/static/);
    expect(source).toMatch(/_next\/image/);
  });
});

describe("server actions", () => {
  const actionFiles = (() => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const source = readFileSync(full, "utf8");
          if (/^\s*["']use server["']/m.test(source)) found.push(full);
        }
      }
    };
    for (const dir of ["app", "lib", "components"]) {
      const path = join(process.cwd(), dir);
      if (existsSync(path)) walk(path);
    }
    return found;
  })();

  it("finds the server action modules", () => {
    expect(actionFiles.length).toBeGreaterThan(0);
  });

  it.each(actionFiles)("%s exports only async functions", (file) => {
    // A "use server" module may export nothing else. A constant or a class
    // there throws at module evaluation, which no unit test and no build will
    // catch — it surfaces as a blank page in the browser.
    const source = readFileSync(file, "utf8");

    const valueExports = [...source.matchAll(/^export\s+(?!type\b)(\w+)/gm)]
      .map((match) => match[1])
      .filter((keyword) => keyword !== "async");

    expect(valueExports).toEqual([]);
  });
});
