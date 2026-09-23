import { describe, expect, it } from "vitest";
import { AUTH_ERROR_MESSAGES, mapAuthError } from "../src/errors";

describe("mapAuthError", () => {
  it.each([
    ["invalid_credentials", "invalid_credentials"],
    ["email_not_confirmed", "email_not_confirmed"],
    ["over_email_send_rate_limit", "rate_limited"],
    ["over_request_rate_limit", "rate_limited"],
    ["weak_password", "weak_password"],
    ["signup_disabled", "signup_disabled"],
  ])("maps %s to %s", (code, expected) => {
    expect(mapAuthError({ code, message: "x" }).code).toBe(expected);
  });

  it("maps an unknown code to a generic failure", () => {
    expect(mapAuthError({ code: "something_new", message: "x" }).code).toBe(
      "unknown",
    );
  });

  it("handles a missing code", () => {
    expect(mapAuthError({ message: "x" }).code).toBe("unknown");
  });

  it("gives every code a message written for a learner", () => {
    for (const [code, message] of Object.entries(AUTH_ERROR_MESSAGES)) {
      expect(message.length, code).toBeGreaterThan(10);
      expect(message, code).not.toMatch(/gotrue|postgres|jwt|token|500/i);
    }
  });

  it("never carries the provider message through", () => {
    const mapped = mapAuthError({
      code: "unexpected_failure",
      message: "gotrue: pq: relation auth.users_internal does not exist",
    });

    expect(JSON.stringify(mapped)).not.toContain("users_internal");
  });
});
