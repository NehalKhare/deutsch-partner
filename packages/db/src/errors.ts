/**
 * Repository errors.
 *
 * A repository never lets a database error reach a caller intact. Callers get
 * a small closed set of kinds plus a message safe to show a learner; the
 * original stays attached for internal logging but is deliberately
 * non-enumerable so it cannot be serialised into a response or a log line by
 * accident (security-observability-guardrails.md S25).
 */

export type RepositoryErrorKind =
  | "not_found"
  | "conflict"
  | "forbidden"
  | "invalid_input"
  | "invalid_reference"
  | "invalid_data"
  | "unavailable";

const SAFE_MESSAGES: Readonly<Record<RepositoryErrorKind, string>> = {
  not_found: "We could not find what you were looking for.",
  conflict: "That already exists.",
  forbidden: "You do not have access to that.",
  invalid_input: "Some of the information provided was not valid.",
  invalid_reference: "That refers to something which no longer exists.",
  invalid_data: "We could not load your data correctly.",
  unavailable: "Something went wrong. Please try again.",
};

export class RepositoryError extends Error {
  readonly kind: RepositoryErrorKind;

  constructor(kind: RepositoryErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "RepositoryError";
    this.kind = kind;

    // Non-enumerable: JSON.stringify and structured loggers skip it, while
    // deliberate internal logging can still read error.cause.
    Object.defineProperty(this, "cause", {
      value: cause,
      enumerable: false,
      writable: false,
      configurable: true,
    });
  }

  toJSON() {
    return { kind: this.kind, message: this.message };
  }
}

export function isRepositoryError(value: unknown): value is RepositoryError {
  return value instanceof RepositoryError;
}

export interface DatabaseErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * Postgres SQLSTATE and PostgREST codes we translate deliberately. Anything
 * unlisted becomes "unavailable": guessing at an unknown failure risks telling
 * a learner their data is missing when the database was merely unreachable.
 */
const KIND_BY_CODE: Readonly<Record<string, RepositoryErrorKind>> = {
  PGRST116: "not_found", // no rows returned where exactly one was required
  "23505": "conflict", // unique_violation
  "23503": "invalid_reference", // foreign_key_violation
  "23502": "invalid_input", // not_null_violation
  "23514": "invalid_input", // check_violation
  "22P02": "invalid_input", // invalid_text_representation
  "42501": "forbidden", // insufficient_privilege, including RLS denial
};

export function mapDatabaseError(error: DatabaseErrorLike | null | undefined) {
  const kind = (error?.code && KIND_BY_CODE[error.code]) || "unavailable";

  return new RepositoryError(kind, SAFE_MESSAGES[kind], error ?? undefined);
}

export function repositoryError(
  kind: RepositoryErrorKind,
  cause?: unknown,
): RepositoryError {
  return new RepositoryError(kind, SAFE_MESSAGES[kind], cause);
}

export type RepositoryResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: RepositoryError };

export const ok = <T>(data: T): RepositoryResult<T> => ({ ok: true, data });

export const fail = <T = never>(
  error: RepositoryError,
): RepositoryResult<T> => ({ ok: false, error });
