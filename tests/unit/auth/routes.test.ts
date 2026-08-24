import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNED_IN_PATH,
  LOGIN_PATH,
  isAuthPath,
  isProtectedPath,
  signInRedirectTarget,
} from "@/lib/auth/routes";

describe("isProtectedPath", () => {
  it.each(["/dashboard", "/dashboard/progress", "/review", "/chat", "/settings"])(
    "protects %s",
    (path) => {
      expect(isProtectedPath(path)).toBe(true);
    },
  );

  it.each(["/", "/auth/login", "/auth/sign-up", "/auth/callback", "/about"])(
    "leaves %s public",
    (path) => {
      expect(isProtectedPath(path)).toBe(false);
    },
  );

  it("leaves API routes to authenticate themselves", () => {
    // A redirect is the wrong answer for a fetch. Route handlers return 401.
    expect(isProtectedPath("/api/chat")).toBe(false);
  });

  it("is not fooled by a path that merely starts with a protected word", () => {
    expect(isProtectedPath("/dashboardish")).toBe(false);
  });

  it("treats a trailing slash the same as none", () => {
    expect(isProtectedPath("/dashboard/")).toBe(true);
  });
});

describe("isAuthPath", () => {
  it.each(["/auth/login", "/auth/sign-up"])("recognises %s", (path) => {
    expect(isAuthPath(path)).toBe(true);
  });

  it("does not treat the OAuth callback as a sign-in page", () => {
    // Redirecting an authenticated user away from the callback would break
    // the code exchange that established the session.
    expect(isAuthPath("/auth/callback")).toBe(false);
  });
});

describe("signInRedirectTarget", () => {
  it("remembers where the learner was heading", () => {
    const target = signInRedirectTarget("/dashboard/progress");

    expect(target).toBe(`${LOGIN_PATH}?next=%2Fdashboard%2Fprogress`);
  });

  it("refuses an absolute URL, which would be an open redirect", () => {
    expect(signInRedirectTarget("https://evil.example/steal")).toBe(LOGIN_PATH);
  });

  it("refuses a protocol-relative URL", () => {
    expect(signInRedirectTarget("//evil.example/steal")).toBe(LOGIN_PATH);
  });

  it("refuses a path that is not a path at all", () => {
    expect(signInRedirectTarget("javascript:alert(1)")).toBe(LOGIN_PATH);
  });

  it("falls back to the default destination for the root path", () => {
    expect(signInRedirectTarget("/")).toBe(LOGIN_PATH);
  });
});

describe("DEFAULT_SIGNED_IN_PATH", () => {
  it("is itself protected, so the redirect cannot land somewhere public", () => {
    expect(isProtectedPath(DEFAULT_SIGNED_IN_PATH)).toBe(true);
  });
});
