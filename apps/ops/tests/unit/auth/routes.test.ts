import { describe, expect, it } from "vitest";

import { opsRouteDecision } from "@/lib/auth/routes";

/**
 * The step-up table. A password alone is worth nothing here: it reaches the
 * second-factor page and no further.
 */
const none = { signedIn: false, aal: "aal1" as const };
const password = { signedIn: true, aal: "aal1" as const };
const both = { signedIn: true, aal: "aal2" as const };

describe("a visitor with no session", () => {
  it("may see the sign-in page and nothing else", () => {
    expect(opsRouteDecision("/login", none)).toBeNull();
    expect(opsRouteDecision("/product", none)).toBe("/login");
    expect(opsRouteDecision("/costs", none)).toBe("/login");
    expect(opsRouteDecision("/login/mfa", none)).toBe("/login");
    expect(opsRouteDecision("/mfa/enrol", none)).toBe("/login");
  });
});

describe("a session with a password only", () => {
  it("is sent to the second factor from everywhere but the step-up pages", () => {
    expect(opsRouteDecision("/product", password)).toBe("/login/mfa");
    expect(opsRouteDecision("/product/runs/", password)).toBe("/login/mfa");
    expect(opsRouteDecision("/login", password)).toBe("/login/mfa");
    expect(opsRouteDecision("/login/mfa", password)).toBeNull();
    expect(opsRouteDecision("/mfa/enrol", password)).toBeNull();
  });
});

describe("a session with the second factor", () => {
  it("passes everywhere and is sent home from the sign-in pages", () => {
    expect(opsRouteDecision("/product", both)).toBeNull();
    expect(opsRouteDecision("/costs", both)).toBeNull();
    expect(opsRouteDecision("/login", both)).toBe("/costs");
    expect(opsRouteDecision("/login/mfa", both)).toBe("/costs");
    expect(opsRouteDecision("/mfa/enrol", both)).toBe("/costs");
  });
});

describe("route handlers", () => {
  it("are never redirected; they authenticate themselves", () => {
    expect(opsRouteDecision("/api/runs/x/events", none)).toBeNull();
    expect(opsRouteDecision("/api/health", none)).toBeNull();
  });
});
