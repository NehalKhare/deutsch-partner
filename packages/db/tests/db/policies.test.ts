import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../src/testing/harness";

/**
 * Policy invariants, checked by introspecting what Postgres actually stored
 * rather than by reading the migration text. Anything the SQL failed to
 * express is invisible to a grep but visible here.
 */

let database: TestDatabase;

interface PolicyRow {
  tablename: string;
  policyname: string;
  cmd: string;
  roles: string;
  qual: string | null;
  with_check: string | null;
}

let policies: PolicyRow[];

const OWNED_TABLES = [
  "profiles",
  "learner_states",
  "learner_vocabulary",
  "learner_errors",
  "learner_memories",
  "recommendations",
  "assessments",
  "conversation_threads",
  "level_performances",
  "trainer_coaching_profiles",
];

const OPERATOR_TABLES = [
  "model_invocations",
  "fx_rates",
  "model_pricing_snapshots",
  "budget_limits",
  "budget_counters",
  "cost_rollup_daily",
  "embedding_cache",
  "ops_jobs",
  "rate_limit_buckets",
];

beforeAll(async () => {
  database = await createTestDatabase();
  policies = (
    await database.db.query(
      `select tablename, policyname, cmd, roles::text as roles, qual, with_check
       from pg_policies where schemaname = 'public'
       order by tablename, cmd`,
    )
  ).rows as PolicyRow[];
});

afterAll(async () => {
  await database?.close();
});

describe("policy hygiene", () => {
  it("names an explicit role on every policy, never PUBLIC", () => {
    const unscoped = policies
      .filter((policy) => policy.roles.includes("public"))
      .map((policy) => policy.policyname);

    expect(unscoped).toEqual([]);
  });

  it("never grants a policy to anon", () => {
    const anonPolicies = policies
      .filter((policy) => policy.roles.includes("anon"))
      .map((policy) => policy.policyname);

    expect(anonPolicies).toEqual([]);
  });

  it("wraps auth.uid() in a subselect so it evaluates once per statement", () => {
    const perRow = policies
      .filter((policy) => {
        const expressions = `${policy.qual ?? ""} ${policy.with_check ?? ""}`;
        // A bare call appears without the SELECT wrapper Postgres records.
        return (
          expressions.includes("auth.uid()") &&
          !expressions.includes("SELECT auth.uid()")
        );
      })
      .map((policy) => policy.policyname);

    expect(perRow).toEqual([]);
  });

  it("never uses the deprecated auth.role()", () => {
    const deprecated = policies
      .filter((policy) =>
        `${policy.qual ?? ""} ${policy.with_check ?? ""}`.includes("auth.role()"),
      )
      .map((policy) => policy.policyname);

    expect(deprecated).toEqual([]);
  });

  it("gives every UPDATE policy both USING and WITH CHECK", () => {
    // Without WITH CHECK a learner can reassign a row to somebody else.
    const incomplete = policies
      .filter((policy) => policy.cmd === "UPDATE")
      .filter((policy) => policy.qual === null || policy.with_check === null)
      .map((policy) => policy.policyname);

    expect(incomplete).toEqual([]);
  });
});

describe.each(OWNED_TABLES)("%s policies", (table) => {
  it("covers all four verbs", () => {
    const verbs = policies
      .filter((policy) => policy.tablename === table)
      .map((policy) => policy.cmd)
      .sort();

    expect(verbs).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  });

  it("carries an ownership predicate on every policy, not just a role check", () => {
    const rolesOnly = policies
      .filter((policy) => policy.tablename === table)
      .filter((policy) => {
        const expression = policy.qual ?? policy.with_check ?? "";
        return !expression.includes("auth.uid()");
      })
      .map((policy) => policy.policyname);

    expect(rolesOnly).toEqual([]);
  });
});

describe.each(OPERATOR_TABLES)("%s", (table) => {
  it("has row level security enabled", async () => {
    const rows = (
      await database.db.query(
        `select rowsecurity from pg_tables where schemaname='public' and tablename=$1`,
        [table],
      )
    ).rows as Array<{ rowsecurity: boolean }>;

    expect(rows[0]?.rowsecurity).toBe(true);
  });

  it("has no policies at all, so it denies by default", () => {
    const found = policies.filter((policy) => policy.tablename === table);

    expect(found).toEqual([]);
  });

  it("grants no table privileges to anon or authenticated", async () => {
    const grants = (
      await database.db.query(
        `select grantee, privilege_type
         from information_schema.role_table_grants
         where table_schema='public' and table_name=$1
           and grantee in ('anon','authenticated')`,
        [table],
      )
    ).rows;

    expect(grants).toEqual([]);
  });
});

describe("privileges", () => {
  it("gives anon no access to any table", async () => {
    const grants = (
      await database.db.query(
        `select table_name, privilege_type
         from information_schema.role_table_grants
         where table_schema='public' and grantee='anon'
         order by table_name`,
      )
    ).rows;

    expect(grants).toEqual([]);
  });

  it("gives authenticated read-only access to shared content", async () => {
    const writes = (
      await database.db.query(
        `select table_name, privilege_type
         from information_schema.role_table_grants
         where table_schema='public' and grantee='authenticated'
           and table_name in ('mini_levels','vocabulary_items','grammar_patterns',
                              'knowledge_documents','knowledge_chunks')
           and privilege_type <> 'SELECT'
         order by table_name`,
      )
    ).rows;

    expect(writes).toEqual([]);
  });
});

describe("functions", () => {
  it("declares no SECURITY DEFINER function in the exposed schema", async () => {
    // A SECURITY DEFINER function in public is callable by anon and
    // authenticated by default and runs with the creator's privileges.
    const definers = (
      await database.db.query(
        `select proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef`,
      )
    ).rows;

    expect(definers).toEqual([]);
  });

  it("pins search_path on every function it defines", async () => {
    const unpinned = (
      await database.db.query(
        `select proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and (p.proconfig is null
                or not exists (
                  select 1 from unnest(p.proconfig) c where c like 'search_path=%'
                ))`,
      )
    ).rows;

    expect(unpinned).toEqual([]);
  });
});
