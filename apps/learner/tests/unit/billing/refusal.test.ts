import { describe, expect, it } from "vitest";

import { PLAN_CODES } from "@dp/domain/plans";

import {
  PLAN_REFUSALS,
  PlanRefusalError,
  planRefusalBody,
  planRefusalFrom,
  reopensLine,
  retryAfterSeconds,
  upgradeOffered,
} from "@/lib/billing/refusal";

/**
 * The three refusals a plan can cause, as the routes say them and the pages
 * read them back. One vocabulary on both sides of the wire, so a route cannot
 * invent a fourth that the client renders as a red "something went wrong".
 */

const RESET = new Date("2026-10-02T09:30:00.000Z");

describe("the vocabulary", () => {
  it("is exactly the three refusals the billing spec names", () => {
    expect(PLAN_REFUSALS).toEqual(["plan_required", "quota_exhausted", "budget_exhausted"]);
  });
});

describe("the body a route sends", () => {
  it("carries the code, the sentence, when it reopens and whether a plan would help", () => {
    expect(
      planRefusalBody("quota_exhausted", "You've used today's tutor turns.", {
        resetAt: RESET,
        upgrade: true,
      }),
    ).toEqual({
      error: "quota_exhausted",
      message: "You've used today's tutor turns.",
      resetAt: "2026-10-02T09:30:00.000Z",
      upgrade: true,
    });
  });

  it("says null rather than inventing a time when nothing reopens", () => {
    expect(
      planRefusalBody("plan_required", "That needs a paid plan.", { resetAt: null, upgrade: true })
        .resetAt,
    ).toBeNull();
  });
});

describe("reading a refusal back", () => {
  it("round-trips what a route sent", () => {
    const body = planRefusalBody("budget_exhausted", "You've used your AI allowance for now.", {
      resetAt: RESET,
      upgrade: false,
    });

    expect(planRefusalFrom(JSON.parse(JSON.stringify({ ...body, requestId: "r-1" })))).toEqual(body);
  });

  it.each([
    ["a per-minute refusal", { error: "rate_limited", message: "Slow down." }],
    ["a failure", { error: "generation_failed", message: "Try again." }],
    ["nothing", null],
    ["a body with no message", { error: "quota_exhausted" }],
    ["a string", "quota_exhausted"],
  ])("is not a plan refusal for %s", (_label, body) => {
    expect(planRefusalFrom(body)).toBeNull();
  });

  it("still shows the prompt when the time or the flag arrived malformed", () => {
    // The sentence is what matters; a garbled reset time is dropped rather
    // than turning an upgrade prompt back into a red error.
    expect(
      planRefusalFrom({ error: "quota_exhausted", message: "Used up.", resetAt: "soon", upgrade: "yes" }),
    ).toEqual({ error: "quota_exhausted", message: "Used up.", resetAt: null, upgrade: false });
  });

  it("travels as an error a client can catch and still read", () => {
    const refusal = planRefusalFrom(
      planRefusalBody("quota_exhausted", "Used up.", { resetAt: RESET, upgrade: true }),
    );
    const error = new PlanRefusalError(refusal!);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Used up.");
    expect(error.refusal.error).toBe("quota_exhausted");
  });
});

describe("who is offered a larger plan", () => {
  it("offers one to every plan below the top, and none to the top", () => {
    expect(PLAN_CODES.map((plan) => upgradeOffered(plan, true))).toEqual([true, true, false]);
  });

  it("offers nothing when the plan could not be read", () => {
    // A subscriber whose rows failed to load is served as Free, which is the
    // safe floor — and must not also be asked to pay for what they have.
    expect(upgradeOffered("free", false)).toBe(false);
  });
});

describe("retry-after", () => {
  it("is whole seconds until the window reopens, never less than one", () => {
    const now = RESET.getTime() - 90_500;

    expect(retryAfterSeconds(RESET, now)).toBe("91");
    expect(retryAfterSeconds(RESET, RESET.getTime() + 5_000)).toBe("1");
  });
});

describe("when it reopens, in words", () => {
  // Formatted where the learner is: the server sends an instant, the page
  // says it in the learner's own clock. Pinned to UTC and en-GB here.
  const zone = { locale: "en-GB", timeZone: "UTC" };
  const now = new Date("2026-10-01T15:00:00.000Z");
  const quota = (resetAt: string | null) =>
    planRefusalFrom({ error: "quota_exhausted", message: "Used up.", resetAt, upgrade: true })!;

  it("names the time when the window reopens later today", () => {
    expect(reopensLine(quota("2026-10-01T18:05:00.000Z"), now, zone)).toBe("Back at 18:05.");
  });

  it("says tomorrow when it reopens tomorrow", () => {
    expect(reopensLine(quota("2026-10-02T09:30:00.000Z"), now, zone)).toBe("Back tomorrow at 09:30.");
  });

  it("names the date of a monthly allowance's renewal", () => {
    const budget = planRefusalFrom({
      error: "budget_exhausted",
      message: "You've used your AI allowance for now.",
      resetAt: "2026-11-01T00:00:00.000Z",
      upgrade: true,
    })!;

    expect(reopensLine(budget, now, zone)).toBe("Renews on 1 November.");
  });

  it("names the day when it is further off than tomorrow", () => {
    expect(reopensLine(quota("2026-10-03T08:00:00.000Z"), now, zone)).toBe("Back on Saturday at 08:00.");
  });

  it("says nothing when nothing reopens", () => {
    const required = planRefusalFrom({ error: "plan_required", message: "Paid plan.", resetAt: null, upgrade: true })!;

    expect(reopensLine(required, now, zone)).toBeNull();
    expect(reopensLine(quota(null), now, zone)).toBeNull();
  });

  it("says soon rather than a time already past", () => {
    expect(reopensLine(quota("2026-10-01T14:59:00.000Z"), now, zone)).toBe("Back in a moment.");
  });
});
