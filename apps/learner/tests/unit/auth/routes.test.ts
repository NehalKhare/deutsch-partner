import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNED_IN_PATH,
  LOGIN_PATH,
  isAuthPath,
  isProtectedPath,
  safeNextPath,
  signInRedirectTarget,
} from "@/lib/auth/routes";

describe("isProtectedPath", () => {
  it.each(["/dashboard", "/dashboard/progress", "/review", "/chat", "/settings", "/billing", "/billing/checkout"])(
    "protects %s",
    (path) => {
      expect(isProtectedPath(path)).toBe(true);
    },
  );

  it.each(["/", "/auth/login", "/auth/sign-up", "/auth/callback", "/about", "/pricing", "/legal/terms"])(
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

  it("keeps the query, so an order link survives the trip through sign-in", () => {
    expect(signInRedirectTarget("/billing/checkout?offer=dp_plus_month")).toBe(
      `${LOGIN_PATH}?next=${encodeURIComponent("/billing/checkout?offer=dp_plus_month")}`,
    );
  });

  it.each(["/\t/evil.example", "/\n/evil.example", "/\r/evil.example"])(
    "refuses a path carrying a control character (%j)",
    (path) => {
      // The URL parser strips tab, CR and LF before resolving, so "/\t/x"
      // arrives in a browser as "//x" — another origin.
      expect(signInRedirectTarget(path)).toBe(LOGIN_PATH);
    },
  );
});

describe("safeNextPath", () => {
  it("keeps a same-site path with its query", () => {
    expect(safeNextPath("/billing/checkout?offer=dp_plus_month")).toBe(
      "/billing/checkout?offer=dp_plus_month",
    );
  });

  it.each([undefined, null, "", "https://evil.example", "//evil.example", "/\\evil.example"])(
    "falls back to the default for %j",
    (next) => {
      expect(safeNextPath(next)).toBe(DEFAULT_SIGNED_IN_PATH);
    },
  );

  it.each(["/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\u0000/evil.example", "/\u007f/evil.example"])(
    "refuses a path smuggling a control character (%j) in front of a second slash",
    (next) => {
      // "/\t/evil.example" passes a naive "starts with one slash" check, and
      // the WHATWG URL parser then removes the tab and resolves "//evil.example".
      expect(safeNextPath(next)).toBe(DEFAULT_SIGNED_IN_PATH);
    },
  );

  it("refuses a value that repeated in the query and arrived as a list", () => {
    // `?next=a&next=b` reaches a page as string[]; it must not throw a 500.
    expect(safeNextPath(["/billing", "/dashboard"])).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it.each(["/%2F/evil.example", "/billing/../..//evil.example", "/./%09/evil.example"])(
    "never returns a destination that resolves off-site (%j)",
    (next) => {
      const base = "https://app.example/";
      expect(new URL(safeNextPath(next), base).origin).toBe(new URL(base).origin);
    },
  );
});

describe("DEFAULT_SIGNED_IN_PATH", () => {
  it("is itself protected, so the redirect cannot land somewhere public", () => {
    expect(isProtectedPath(DEFAULT_SIGNED_IN_PATH)).toBe(true);
  });
});
