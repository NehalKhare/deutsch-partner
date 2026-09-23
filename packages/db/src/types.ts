/**
 * The narrow slice of supabase-js a repository is allowed to use.
 *
 * Repositories depend on this rather than on the full client, so a test can
 * substitute a builder without pulling in the SDK, and so the surface a
 * repository can reach stays small and reviewable.
 */
export interface QueryResponse {
  data: unknown;
  error: {
    code?: string | null;
    message?: string | null;
    details?: string | null;
    hint?: string | null;
  } | null;
}

export interface QueryBuilder extends PromiseLike<QueryResponse> {
  select(columns?: string): QueryBuilder;
  insert(values: unknown): QueryBuilder;
  update(values: unknown): QueryBuilder;
  upsert(values: unknown, options?: unknown): QueryBuilder;
  delete(): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  neq(column: string, value: unknown): QueryBuilder;
  in(column: string, values: readonly unknown[]): QueryBuilder;
  lte(column: string, value: unknown): QueryBuilder;
  gte(column: string, value: unknown): QueryBuilder;
  lt(column: string, value: unknown): QueryBuilder;
  gt(column: string, value: unknown): QueryBuilder;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder;
  limit(count: number): QueryBuilder;
  single(): PromiseLike<QueryResponse>;
  maybeSingle(): PromiseLike<QueryResponse>;
}

export interface DatabaseClient {
  from(table: string): QueryBuilder;
  /**
   * Calls a database function. Used where an operation must be atomic, which
   * separate PostgREST round trips cannot be.
   */
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<QueryResponse>;
}
