import { describe, expect, it } from "vitest";
import {
  RepositoryError,
  isRepositoryError,
  mapDatabaseError,
} from "../src/errors";

const raw = (code: string, message: string) => ({
  code,
  message,
  details: "relation learner_states_internal_v2",
  hint: null,
});

describe("mapDatabaseError", () => {
  it.each([
    ["PGRST116", "not_found"],
    ["23505", "conflict"],
    ["23503", "invalid_reference"],
    ["23514", "invalid_input"],
    ["23502", "invalid_input"],
    ["42501", "forbidden"],
    ["42P01", "unavailable"],
    ["08006", "unavailable"],
  ])("maps %s to %s", (code, kind) => {
    expect(mapDatabaseError(raw(code, "boom")).kind).toBe(kind);
  });

  it("treats an unrecognised code as unavailable rather than guessing", () => {
    expect(mapDatabaseError(raw("XX999", "boom")).kind).toBe("unavailable");
  });

  it("treats a row-level security violation as forbidden", () => {
    const error = mapDatabaseError(
      raw("42501", 'new row violates row-level security policy for table "x"'),
    );

    expect(error.kind).toBe("forbidden");
  });

  it("produces a message safe to show a learner", () => {
    const error = mapDatabaseError(
      raw("42P01", 'relation "learner_state_internal_v2" does not exist'),
    );

    expect(error.message).not.toContain("learner_state_internal_v2");
    expect(error.message).not.toContain("relation");
    expect(error.message.length).toBeGreaterThan(0);
  });

  it("keeps the original error for internal logging without serialising it", () => {
    const original = raw("42P01", 'relation "secret_table" does not exist');
    const error = mapDatabaseError(original);

    // Available deliberately...
    expect(error.cause).toBe(original);
    // ...but never carried into a response body or a log line by accident.
    expect(JSON.stringify(error)).not.toContain("secret_table");
  });

  it("is an Error, so it survives normal error handling", () => {
    const error = mapDatabaseError(raw("23505", "duplicate"));

    expect(error).toBeInstanceOf(Error);
    expect(isRepositoryError(error)).toBe(true);
  });

  it("handles a null error defensively", () => {
    expect(mapDatabaseError(null).kind).toBe("unavailable");
  });
});

describe("RepositoryError", () => {
  it("does not leak its cause through toString", () => {
    const error = new RepositoryError("conflict", "Already exists", {
      code: "23505",
      message: "duplicate key value violates unique constraint",
    });

    expect(String(error)).not.toContain("unique constraint");
  });

  it("rejects a non-repository error", () => {
    expect(isRepositoryError(new Error("nope"))).toBe(false);
  });
});
