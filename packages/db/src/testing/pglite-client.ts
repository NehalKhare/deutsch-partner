import type { PGlite } from "@electric-sql/pglite";

import type { DatabaseClient, QueryBuilder, QueryResponse } from "../types";

/**
 * A DatabaseClient over PGlite, speaking the slice of PostgREST the
 * repositories use.
 *
 * The fake in @dp/test-support records a chain and returns what it was told
 * to; this one runs the chain. A repository test against it meets the real
 * columns, constraints, conflict targets, defaults and — inside
 * `asLearner` — the real RLS policies, and parses rows the way the wire
 * delivers them: timestamps as ISO strings, not Date objects.
 *
 * It is a test double, not a PostgREST: one table per query, no embedding,
 * no renames, and only the filters in `types.ts`. A repository that needs
 * more has outgrown it, and should say so here rather than work around it.
 */

type Row = Record<string, unknown>;

interface Filter {
  readonly column: string;
  readonly op: "=" | "<>" | "<" | "<=" | ">" | ">=" | "in";
  readonly value: unknown;
}

interface Plan {
  table: string;
  action: "select" | "insert" | "update" | "upsert" | "delete";
  values: Row[];
  upsert: { onConflict?: string; ignoreDuplicates?: boolean };
  /** Columns to return. Null on a write means PostgREST's "return=minimal". */
  returning: string | null;
  filters: Filter[];
  order: Array<{ column: string; ascending: boolean }>;
  limit: number | null;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`pglite-client: unsupported identifier ${name}`);
  return name;
}

function columns(list: string): string {
  const trimmed = list.trim();
  if (trimmed === "*" || trimmed === "") return "*";
  return trimmed
    .split(",")
    .map((column) => identifier(column.trim()))
    .join(", ");
}

/** Dates as the wire spells them; everything else as PGlite serialises it. */
function param(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

/** Rows as PostgREST would send them: a timestamptz is a string. */
function wire(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  );
}

function failure(caught: unknown): QueryResponse {
  const code = (caught as { code?: unknown } | null)?.code;
  return { data: null, error: { code: typeof code === "string" ? code : null, message: "query failed" } };
}

function compile(plan: Plan): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(param(value));
    return `$${params.length}`;
  };
  const table = `public.${identifier(plan.table)}`;

  // A function, not a string: placeholders are numbered as they are bound, so
  // an update binds its SET list first and its filters after.
  const where = () =>
    plan.filters.length
      ? ` where ${plan.filters
          .map((filter) =>
            filter.op === "in"
              ? `${identifier(filter.column)} = any(${bind(filter.value)})`
              : `${identifier(filter.column)} ${filter.op} ${bind(filter.value)}`,
          )
          .join(" and ")}`
      : "";
  const returning = plan.returning === null ? "" : ` returning ${columns(plan.returning)}`;

  switch (plan.action) {
    case "select": {
      const order = plan.order.length
        ? ` order by ${plan.order.map((o) => `${identifier(o.column)} ${o.ascending ? "asc" : "desc"}`).join(", ")}`
        : "";
      const limit = plan.limit === null ? "" : ` limit ${Math.max(0, Math.trunc(plan.limit))}`;
      return { sql: `select ${columns(plan.returning ?? "*")} from ${table}${where()}${order}${limit}`, params };
    }
    case "update": {
      const [values] = plan.values;
      const set = Object.entries(values ?? {})
        .map(([column, value]) => `${identifier(column)} = ${bind(value)}`)
        .join(", ");
      return { sql: `update ${table} set ${set}${where()}${returning}`, params };
    }
    case "delete":
      return { sql: `delete from ${table}${where()}${returning}`, params };
    case "insert":
    case "upsert": {
      const names = [...new Set(plan.values.flatMap((row) => Object.keys(row)))].map(identifier);
      const tuples = plan.values
        .map((row) => `(${names.map((name) => (name in row ? bind(row[name]) : "default")).join(", ")})`)
        .join(", ");
      let conflict = "";
      if (plan.action === "upsert") {
        if (!plan.upsert.onConflict) throw new Error("pglite-client: upsert needs onConflict");
        const target = plan.upsert.onConflict.split(",").map((c) => identifier(c.trim()));
        conflict = plan.upsert.ignoreDuplicates
          ? ` on conflict (${target.join(", ")}) do nothing`
          : ` on conflict (${target.join(", ")}) do update set ${names
              .filter((name) => !target.includes(name))
              .map((name) => `${name} = excluded.${name}`)
              .join(", ")}`;
      }
      return { sql: `insert into ${table} (${names.join(", ")}) values ${tuples}${conflict}${returning}`, params };
    }
  }
}

export function createPgliteClient(db: PGlite): DatabaseClient {
  // Parameter types per function, so a JSON argument is sent as JSON the way
  // PostgREST's request body sends it — an empty array included — and
  // everything else as PGlite serialises it.
  const jsonParameters = new Map<string, Promise<Set<string>>>();
  const jsonParametersOf = (fn: string) => {
    let known = jsonParameters.get(fn);
    if (!known) {
      known = db
        .query<{ name: string; type: string }>(
          `select a.name, a.type
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace,
                  unnest(p.proargnames[1:p.pronargs], p.proargtypes::regtype[]::text[]) as a(name, type)
            where n.nspname = 'public' and p.proname = $1`,
          [fn],
        )
        .then((result) => new Set(result.rows.filter((row) => /^jsonb?$/.test(row.type)).map((row) => row.name)));
      jsonParameters.set(fn, known);
    }
    return known;
  };

  const run = async (plan: Plan, cardinality: "many" | "single" | "maybeSingle"): Promise<QueryResponse> => {
    const { sql, params } = compile(plan);
    let rows: Row[];
    try {
      rows = ((await db.query<Row>(sql, params)).rows ?? []).map(wire);
    } catch (caught) {
      return failure(caught);
    }

    const wrote = plan.action !== "select";
    if (wrote && plan.returning === null) return { data: null, error: null };
    if (cardinality === "many") return { data: rows, error: null };
    if (rows.length > 1 || (cardinality === "single" && rows.length === 0)) {
      return { data: null, error: { code: "PGRST116", message: "not exactly one row" } };
    }
    return { data: rows[0] ?? null, error: null };
  };

  const builder = (plan: Plan): QueryBuilder => {
    const next = (change: Partial<Plan>) => builder({ ...plan, ...change });
    const filter = (op: Filter["op"]) => (column: string, value: unknown) =>
      next({ filters: [...plan.filters, { column, op, value }] });

    return {
      select: (list = "*") => next({ returning: list }),
      insert: (values) => next({ action: "insert", values: Array.isArray(values) ? values : [values as Row] }),
      update: (values) => next({ action: "update", values: [values as Row] }),
      upsert: (values, options) =>
        next({
          action: "upsert",
          values: Array.isArray(values) ? values : [values as Row],
          upsert: (options ?? {}) as Plan["upsert"],
        }),
      delete: () => next({ action: "delete" }),
      eq: filter("="),
      neq: filter("<>"),
      in: (column, values) => next({ filters: [...plan.filters, { column, op: "in", value: [...values] }] }),
      lt: filter("<"),
      lte: filter("<="),
      gt: filter(">"),
      gte: filter(">="),
      order: (column, options) =>
        next({ order: [...plan.order, { column, ascending: options?.ascending ?? true }] }),
      limit: (count) => next({ limit: count }),
      single: () => run(plan, "single"),
      maybeSingle: () => run(plan, "maybeSingle"),
      then: (onfulfilled, onrejected) => run(plan, "many").then(onfulfilled, onrejected),
    };
  };

  return {
    from: (table) =>
      builder({
        table,
        action: "select",
        values: [],
        upsert: {},
        returning: null,
        filters: [],
        order: [],
        limit: null,
      }),

    /**
     * Named arguments, as PostgREST binds them. A scalar function comes back
     * as its value and a set-returning one as rows, again as PostgREST does.
     */
    async rpc(fn, args = {}) {
      const names = Object.keys(args).map(identifier);
      const call = names.map((name, index) => `${name} => $${index + 1}`).join(", ");

      try {
        const json = await jsonParametersOf(identifier(fn));
        const values = names.map((name) => {
          const value = args[name];
          if (value instanceof Date) return value.toISOString();
          return json.has(name) && value !== null && value !== undefined ? JSON.stringify(value) : value;
        });
        const result = await db.query<Row>(`select * from public.${identifier(fn)}(${call})`, values);
        const scalar = result.fields.length === 1 && result.fields[0]?.name === fn;
        if (scalar) {
          const value = result.rows[0]?.[fn] ?? null;
          return { data: value instanceof Date ? value.toISOString() : value, error: null };
        }
        return { data: result.rows.map(wire), error: null };
      } catch (caught) {
        return failure(caught);
      }
    },
  };
}
