import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

/** The one migration set, resolved from this package rather than from cwd. */
export const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../supabase/migrations", import.meta.url),
);

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

export function migrationSql(): string {
  return migrationFiles()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"))
    .join("\n");
}

/**
 * PGlite is real Postgres, but it ships neither pgvector nor pg_cron. The
 * embedding column, its HNSW index, the cron extension and the $cron$-tagged
 * schedule block are therefore substituted here so the rest of the schema —
 * every table, constraint, index, function and RLS policy — runs against a
 * real engine.
 *
 * The substitution can only hide what it strips, so a static test asserts the
 * migrations really do declare pgvector, a cosine HNSW index, pg_cron and the
 * schedules. See packages/security-tests/tests/migration-policy.test.ts.
 */
function withoutUnavailableExtensions(sql: string): string {
  return sql
    .replace(/create extension if not exists vector[^;]*;/gi, "")
    .replace(/\b(?:extensions\.)?vector\(\d+\)/gi, "text")
    .replace(/create index[^;]*using hnsw[^;]*;/gi, "")
    .replace(/create extension if not exists pg_cron[^;]*;/gi, "")
    .replace(/do \$cron\$[\s\S]*?\$cron\$;/gi, "");
}

/**
 * Minimal stand-in for the parts of Supabase the schema depends on: the auth
 * schema, auth.uid(), and the anon / authenticated roles. auth.uid() reads the
 * same request setting PostgREST populates, so policies behave as deployed.
 */
const SUPABASE_SHIM = `
  create schema if not exists auth;

  create table if not exists auth.users (
    id uuid primary key,
    email text
  );

  create or replace function auth.uid()
  returns uuid
  language sql
  stable
  as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin bypassrls;
    end if;
  end $$;

  grant usage on schema public, auth to anon, authenticated, service_role;
`;

export interface TestDatabase {
  readonly db: PGlite;
  /** Runs a callback as the given signed-in learner, then rolls back. */
  asLearner<T>(learnerId: string, fn: () => Promise<T>): Promise<T>;
  /** Runs a callback as an unauthenticated visitor, then rolls back. */
  asAnon<T>(fn: () => Promise<T>): Promise<T>;
  /** Seeds the shared curriculum rows that learner tables reference. */
  seedReferenceData(): Promise<void>;
  /** Seeds a learner and returns their id. Runs with RLS bypassed. */
  seedLearner(learnerId: string): Promise<void>;
  close(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const db = new PGlite();

  await db.exec(SUPABASE_SHIM);
  for (const name of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
    try {
      await db.exec(withoutUnavailableExtensions(sql));
    } catch (error) {
      throw new Error(`migration ${name} failed: ${(error as Error).message}`);
    }
  }

  const withRole = async <T>(
    role: string,
    learnerId: string | null,
    fn: () => Promise<T>,
  ): Promise<T> => {
    await db.exec("begin");
    try {
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
        learnerId ?? "",
      ]);
      await db.exec(`set local role ${role}`);
      return await fn();
    } finally {
      await db.exec("rollback");
    }
  };

  return {
    db,
    asLearner: (learnerId, fn) => withRole("authenticated", learnerId, fn),
    asAnon: (fn) => withRole("anon", null, fn),
    async seedReferenceData() {
      // Mini-levels, vocabulary and grammar are not seeded here: the
      // curriculum migrations write all seventy levels, every target word and
      // every grammar pattern, so anything a test references already resolves.
      await db.exec(`
        insert into public.knowledge_documents
          (source, title, content_type, content_hash)
        values ('seed', 'Seed document', 'grammar', 'seed-hash-1')
        on conflict (content_hash) do nothing;

        insert into public.knowledge_chunks
          (document_id, chunk_index, content, chunk_hash, content_type)
        select id, 0, 'Seed chunk', 'seed-chunk-1', 'grammar'
        from public.knowledge_documents where content_hash = 'seed-hash-1'
        on conflict (document_id, chunk_hash) do nothing;
      `);
    },
    async seedLearner(learnerId: string) {
      await db.query(
        `insert into auth.users (id, email) values ($1, $2)
         on conflict (id) do nothing`,
        [learnerId, `${learnerId}@example.test`],
      );
      await db.query(
        `insert into public.profiles
           (id, learning_goal, selected_level,
            target_topics, interests, input_preference, output_preference,
            correction_preference)
         values ($1, 'Learn German', 'A1',
                 array[]::text[], array[]::text[], 'text', 'text', 'gentle')
         on conflict (id) do nothing`,
        [learnerId],
      );
      await db.query(
        `insert into public.learner_states
           (learner_id, selected_level, estimated_level, effective_cefr,
            effective_plus, mini_level, fluency, comprehension, confidence)
         values ($1, 'A1', null, 'A1', false, 1, 0, 0, 0)
         on conflict (learner_id) do nothing`,
        [learnerId],
      );
    },
    close: () => db.close(),
  };
}

export const ALICE = "11111111-1111-4111-8111-111111111111";
export const BOB = "22222222-2222-4222-8222-222222222222";
