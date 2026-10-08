import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNED_IN_PATH,
  ENROL_PATH,
  LOGIN_PATH,
  MFA_PATH,
  enrolRedirectTarget,
  isAuthPath,
  isProtectedPath,
  isStepUpPath,
  learnerRouteDecision,
  safeNextPath,
  signInRedirectTarget,
  stepUpRedirectTarget,
} from "@/lib/auth/routes";

describe("isProtectedPath", () => {
  it.each(["/dashboard", "/dashboard/progress", "/review", "/chat", "/settings", "/billing", "/billing/checkout", "/notifications"])(
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

describe("isStepUpPath", () => {
  it.each([MFA_PATH, ENROL_PATH, `${MFA_PATH}/`])("recognises %s", (path) => {
    expect(isStepUpPath(path)).toBe(true);
  });

  it.each([LOGIN_PATH, "/auth/mfaish", "/dashboard"])("leaves %s alone", (path) => {
    expect(isStepUpPath(path)).toBe(false);
  });

  it("is not a sign-in page, so a password-only session is not bounced off it", () => {
    expect(isAuthPath(MFA_PATH)).toBe(false);
    expect(isAuthPath(ENROL_PATH)).toBe(false);
  });
});

describe("stepUpRedirectTarget and enrolRedirectTarget", () => {
  it("remember a destination the same way sign-in does", () => {
    expect(stepUpRedirectTarget("/billing/checkout?offer=x")).toBe(
      `${MFA_PATH}?next=${encodeURIComponent("/billing/checkout?offer=x")}`,
    );
    expect(enrolRedirectTarget("/chat")).toBe(`${ENROL_PATH}?next=%2Fchat`);
  });

  it("leave the default destination off, as noise", () => {
    expect(stepUpRedirectTarget(DEFAULT_SIGNED_IN_PATH)).toBe(MFA_PATH);
    expect(enrolRedirectTarget("/")).toBe(ENROL_PATH);
  });

  it("drop a destination that could leave the site", () => {
    expect(stepUpRedirectTarget("//evil.example")).toBe(MFA_PATH);
    expect(enrolRedirectTarget("https://evil.example")).toBe(ENROL_PATH);
  });
});

/**
 * The step-up table. A password alone opens the step-up pages and the public
 * site, and nothing else; the destination a learner carries survives every hop.
 */
const none = { signedIn: false, aal: "aal1" as const };
const password = { signedIn: true, aal: "aal1" as const };
const both = { signedIn: true, aal: "aal2" as const };

describe("learnerRouteDecision for a visitor with no session", () => {
  it("passes the public site and the sign-in pages", () => {
    expect(learnerRouteDecision("/", "", none)).toBeNull();
    expect(learnerRouteDecision("/pricing", "", none)).toBeNull();
    expect(learnerRouteDecision(LOGIN_PATH, "?next=%2Fchat", none)).toBeNull();
  });

  it("is sent to sign in from a protected page, remembering it", () => {
    expect(learnerRouteDecision("/dashboard/progress", "", none)).toBe(
      `${LOGIN_PATH}?next=%2Fdashboard%2Fprogress`,
    );
  });

  it("is sent to sign in from the step-up pages, keeping the destination and not the page", () => {
    expect(learnerRouteDecision(MFA_PATH, "?next=%2Fchat", none)).toBe(`${LOGIN_PATH}?next=%2Fchat`);
    expect(learnerRouteDecision(ENROL_PATH, "", none)).toBe(LOGIN_PATH);
  });
});

describe("learnerRouteDecision for a password without its second factor", () => {
  it("is sent to the authenticator from everywhere protected, remembering where", () => {
    expect(learnerRouteDecision("/dashboard", "", password)).toBe(MFA_PATH);
    expect(learnerRouteDecision("/billing/checkout", "?offer=x", password)).toBe(
      `${MFA_PATH}?next=${encodeURIComponent("/billing/checkout?offer=x")}`,
    );
    expect(learnerRouteDecision("/onboarding", "", password)).toBe(`${MFA_PATH}?next=%2Fonboarding`);
  });

  it("is sent on from the sign-in pages with the destination it was carrying", () => {
    expect(learnerRouteDecision(LOGIN_PATH, "?next=%2Fchat", password)).toBe(`${MFA_PATH}?next=%2Fchat`);
    expect(learnerRouteDecision("/auth/sign-up", "", password)).toBe(MFA_PATH);
  });

  it("may stand on the step-up pages and browse the public site", () => {
    expect(learnerRouteDecision(MFA_PATH, "", password)).toBeNull();
    expect(learnerRouteDecision(ENROL_PATH, "?next=%2Fchat", password)).toBeNull();
    expect(learnerRouteDecision("/pricing", "", password)).toBeNull();
  });

  it("is not told about a destination that could leave the site", () => {
    expect(learnerRouteDecision(LOGIN_PATH, "?next=%2F%2Fevil.example", password)).toBe(MFA_PATH);
  });
});

describe("learnerRouteDecision for a session with both factors", () => {
  it("passes everywhere protected", () => {
    expect(learnerRouteDecision("/dashboard", "", both)).toBeNull();
    expect(learnerRouteDecision("/chat/abc", "", both)).toBeNull();
    expect(learnerRouteDecision("/onboarding", "", both)).toBeNull();
  });

  it("is sent where it was heading from the sign-in and step-up pages", () => {
    expect(learnerRouteDecision(LOGIN_PATH, "", both)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(learnerRouteDecision(LOGIN_PATH, "?next=%2Fbilling", both)).toBe("/billing");
    expect(learnerRouteDecision(MFA_PATH, "?next=%2Fchat", both)).toBe("/chat");
    expect(learnerRouteDecision(ENROL_PATH, "", both)).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("drops a destination that could leave the site", () => {
    expect(learnerRouteDecision(MFA_PATH, "?next=https%3A%2F%2Fevil.example", both)).toBe(
      DEFAULT_SIGNED_IN_PATH,
    );
  });
});

describe("route handlers", () => {
  it("are never redirected; they authenticate themselves", () => {
    expect(learnerRouteDecision("/api/chat", "", none)).toBeNull();
    expect(learnerRouteDecision("/api/chat", "", password)).toBeNull();
  });
});
