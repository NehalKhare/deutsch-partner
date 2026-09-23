import type { ZodType } from "zod";

import {
  fail,
  mapDatabaseError,
  ok,
  repositoryError,
  type DatabaseErrorLike,
  type RepositoryResult,
} from "./errors";

export interface QueryOutcome {
  data: unknown;
  error: DatabaseErrorLike | null;
}

/**
 * The single path every read takes out of the database.
 *
 * Rows are validated against the domain schema rather than trusted. Generated
 * database types describe what the schema said at build time; this checks what
 * the database actually returned, which is what the rest of the application
 * will act on.
 */
export function decodeRow<T>(
  outcome: QueryOutcome,
  schema: ZodType<T>,
): RepositoryResult<T> {
  if (outcome.error) return fail(mapDatabaseError(outcome.error));
  if (outcome.data === null || outcome.data === undefined) {
    return fail(repositoryError("not_found"));
  }

  const parsed = schema.safeParse(outcome.data);
  if (!parsed.success) {
    return fail(repositoryError("invalid_data", parsed.error));
  }

  return ok(parsed.data);
}

export function decodeRows<T>(
  outcome: QueryOutcome,
  schema: ZodType<T>,
): RepositoryResult<T[]> {
  if (outcome.error) return fail(mapDatabaseError(outcome.error));

  const rows = Array.isArray(outcome.data) ? outcome.data : [];
  const decoded: T[] = [];

  for (const row of rows) {
    const parsed = schema.safeParse(row);
    // One malformed row invalidates the read. Silently dropping it would show
    // the learner an incomplete list and hide the drift that caused it.
    if (!parsed.success) return fail(repositoryError("invalid_data", parsed.error));
    decoded.push(parsed.data);
  }

  return ok(decoded);
}

/** Validates an input against its domain schema before any query is issued. */
export function decodeInput<T>(
  input: unknown,
  schema: ZodType<T>,
): RepositoryResult<T> {
  const parsed = schema.safeParse(input);

  return parsed.success
    ? ok(parsed.data)
    : fail(repositoryError("invalid_input", parsed.error));
}
