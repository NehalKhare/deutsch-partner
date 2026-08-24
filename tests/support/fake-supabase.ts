import { vi } from "vitest";

/**
 * A minimal stand-in for the supabase-js query builder.
 *
 * It records the chain a repository builds and resolves to a configured
 * result, so tests can assert which table was queried and which filters were
 * applied without reaching a database.
 */

export interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

export interface PostgrestLikeError {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

export interface FakeResult {
  data?: unknown;
  error?: PostgrestLikeError | null;
}

const TERMINAL_METHODS = new Set(["single", "maybeSingle"]);

export interface RecordedRpc {
  readonly fn: string;
  readonly args: Record<string, unknown> | undefined;
}

export function createFakeSupabase(resultsByTable: Record<string, FakeResult>) {
  const calls: Array<{ table: string; chain: RecordedCall[] }> = [];
  const rpcCalls: RecordedRpc[] = [];
  let rpcResult: FakeResult = { data: null, error: null };

  const from = vi.fn((table: string) => {
    const chain: RecordedCall[] = [];
    calls.push({ table, chain });

    const result = resultsByTable[table] ?? { data: null, error: null };
    const settled = Promise.resolve({
      data: result.data ?? null,
      error: result.error ?? null,
    });

    const builder: Record<string, unknown> = {
      then: (...args: unknown[]) =>
        (settled.then as (...a: unknown[]) => unknown)(...args),
      catch: (...args: unknown[]) =>
        (settled.catch as (...a: unknown[]) => unknown)(...args),
    };

    const record =
      (method: string) =>
      (...args: unknown[]) => {
        chain.push({ method, args });
        return TERMINAL_METHODS.has(method) ? settled : builder;
      };

    for (const method of [
      "select",
      "insert",
      "update",
      "upsert",
      "delete",
      "eq",
      "in",
      "lte",
      "gte",
      "lt",
      "neq",
      "order",
      "limit",
      "range",
      "single",
      "maybeSingle",
    ]) {
      builder[method] = record(method);
    }

    return builder;
  });

  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    return { data: rpcResult.data ?? null, error: rpcResult.error ?? null };
  });

  return {
    client: { from, rpc } as never,
    calls,
    rpcCalls,
    /** What the next rpc call resolves to. */
    setRpcResult(result: FakeResult) {
      rpcResult = result;
    },
    /** The chain recorded for the most recent query against a table. */
    chainFor(table: string): RecordedCall[] {
      const match = [...calls].reverse().find((call) => call.table === table);
      if (!match) throw new Error(`no query was made against "${table}"`);
      return match.chain;
    },
    methodArgs(table: string, method: string): readonly unknown[][] {
      return this.chainFor(table)
        .filter((call) => call.method === method)
        .map((call) => call.args as unknown[]);
    },
  };
}
