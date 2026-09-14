import { describe, expect, it } from "vitest";

import {
  DISPUTE_THRESHOLD,
  MAX_DISPUTED_CORRECTIONS,
  defaultCoachingProfile,
  isDefaultCoaching,
  shouldVerifyBeforeCorrecting,
} from "@/domain/trainer-coaching";
import { MAX_AGENDA_ITEMS } from "@/domain/trainer-session";
import {
  MIX_FOR_FOCUS,
  SHORT_SESSION_ITEMS,
  agendaSizeFor,
  applyAdjustment,
  applyFeedback,
  describeDials,
} from "@/lib/trainer/coaching";

/**
 * How a vote becomes coaching.
 *
 * These are the product's rules about what feedback does, pinned: one reason
 * moves one dial one step, the ends of a scale hold, contradictory reasons
 * cancel, a wrong correction is counted rather than dialled, and helpful votes
 * wind that count back down. A model gets no say in any of it.
 */

const LEARNER = "11111111-1111-4111-8111-111111111111";
const AT = new Date("2026-09-14T12:00:00.000Z");
const LATER = new Date("2026-09-14T12:05:00.000Z");

const fresh = () => defaultCoachingProfile(LEARNER, AT);

describe("a fresh profile", () => {
  it("stands on every default and asks the trainer for nothing", () => {
    const profile = fresh();

    expect(isDefaultCoaching(profile)).toBe(true);
    expect(shouldVerifyBeforeCorrecting(profile)).toBe(false);
    expect(describeDials(profile)).toEqual([]);
    expect(agendaSizeFor(profile)).toBe(MAX_AGENDA_ITEMS);
  });
});

describe("one reason, one step", () => {
  it.each([
    ["too_long", "explanationDepth", "brief"],
    ["too_short", "explanationDepth", "detailed"],
    ["unclear", "explanationDepth", "detailed"],
    ["too_hard", "challenge", "gentler"],
    ["too_easy", "challenge", "harder"],
  ] as const)("%s moves %s to %s", (reason, dial, expected) => {
    const { profile, changed } = applyFeedback(
      fresh(),
      { verdict: "unhelpful", reasons: [reason] },
      LATER,
    );

    expect(profile[dial]).toBe(expected);
    expect(changed).toEqual([{ dial, from: "standard", to: expected }]);
    expect(profile.unhelpfulCount).toBe(1);
    expect(profile.updatedAt).toBe(LATER);
  });

  it("switches the news off and never back on by vote", () => {
    const { profile, changed } = applyFeedback(
      fresh(),
      { verdict: "unhelpful", reasons: ["skip_news"] },
      LATER,
    );

    expect(profile.news).toBe(false);
    expect(changed).toEqual([{ dial: "news", from: true, to: false }]);

    // A helpful vote is not a request for the news back; only asking is.
    const after = applyFeedback(profile, { verdict: "helpful", reasons: [] }, LATER);
    expect(after.profile.news).toBe(false);
  });

  it("holds at the end of a scale rather than wrapping or throwing", () => {
    const once = applyFeedback(fresh(), { verdict: "unhelpful", reasons: ["too_long"] }, LATER);
    const twice = applyFeedback(once.profile, { verdict: "unhelpful", reasons: ["too_long"] }, LATER);

    expect(twice.profile.explanationDepth).toBe("brief");
    // Nothing moved the second time, and the response says so.
    expect(twice.changed).toEqual([]);
    expect(twice.profile.unhelpfulCount).toBe(2);
  });

  it("lets contradictory reasons on one vote cancel", () => {
    const { profile, changed } = applyFeedback(
      fresh(),
      { verdict: "unhelpful", reasons: ["too_long", "too_short"] },
      LATER,
    );

    expect(profile.explanationDepth).toBe("standard");
    expect(changed).toEqual([]);
  });

  it("moves several dials when several reasons are given", () => {
    const { changed } = applyFeedback(
      fresh(),
      { verdict: "unhelpful", reasons: ["too_hard", "too_long", "skip_news"] },
      LATER,
    );

    expect(changed.map((change) => change.dial).sort()).toEqual([
      "challenge",
      "explanationDepth",
      "news",
    ]);
  });
});

describe("a disputed correction", () => {
  it("is counted, not dialled", () => {
    const { profile, changed } = applyFeedback(
      fresh(),
      { verdict: "unhelpful", reasons: ["wrong_correction"] },
      LATER,
    );

    expect(profile.disputedCorrections).toBe(1);
    expect(changed).toEqual([]);
    expect(isDefaultCoaching(profile)).toBe(true);
    expect(shouldVerifyBeforeCorrecting(profile)).toBe(false);
  });

  it("asks the trainer to verify once the threshold is reached", () => {
    let profile = fresh();
    for (let vote = 0; vote < DISPUTE_THRESHOLD; vote += 1) {
      profile = applyFeedback(
        profile,
        { verdict: "unhelpful", reasons: ["wrong_correction"] },
        LATER,
      ).profile;
    }

    expect(shouldVerifyBeforeCorrecting(profile)).toBe(true);
  });

  it("is wound back by a helpful vote, so a recovered trainer is not told off forever", () => {
    let profile = fresh();
    for (let vote = 0; vote < DISPUTE_THRESHOLD; vote += 1) {
      profile = applyFeedback(
        profile,
        { verdict: "unhelpful", reasons: ["wrong_correction"] },
        LATER,
      ).profile;
    }

    const { profile: after } = applyFeedback(profile, { verdict: "helpful", reasons: [] }, LATER);

    expect(after.disputedCorrections).toBe(DISPUTE_THRESHOLD - 1);
    expect(after.helpfulCount).toBe(1);
    expect(shouldVerifyBeforeCorrecting(after)).toBe(false);
  });

  it("never counts below zero or above its cap", () => {
    const helped = applyFeedback(fresh(), { verdict: "helpful", reasons: [] }, LATER);
    expect(helped.profile.disputedCorrections).toBe(0);

    let profile = { ...fresh(), disputedCorrections: MAX_DISPUTED_CORRECTIONS };
    profile = applyFeedback(
      profile,
      { verdict: "unhelpful", reasons: ["wrong_correction"] },
      LATER,
    ).profile;
    expect(profile.disputedCorrections).toBe(MAX_DISPUTED_CORRECTIONS);
  });
});

describe("a request made in words", () => {
  it("sets exactly the dials named and reports each move", () => {
    const { profile, changed } = applyAdjustment(
      fresh(),
      { sessionLength: "short", focus: "grammar" },
      LATER,
    );

    expect(profile.sessionLength).toBe("short");
    expect(profile.focus).toBe("grammar");
    expect(profile.explanationDepth).toBe("standard");
    expect(changed).toEqual([
      { dial: "sessionLength", from: "standard", to: "short" },
      { dial: "focus", from: "balanced", to: "grammar" },
    ]);
  });

  it("ignores an undefined value rather than clearing the dial", () => {
    const tuned = applyAdjustment(fresh(), { challenge: "harder" }, LATER).profile;
    const { profile, changed } = applyAdjustment(
      tuned,
      { challenge: undefined, news: false },
      LATER,
    );

    expect(profile.challenge).toBe("harder");
    expect(changed).toEqual([{ dial: "news", from: true, to: false }]);
  });

  it("can switch the news back on, which no vote can", () => {
    const off = applyFeedback(fresh(), { verdict: "unhelpful", reasons: ["skip_news"] }, LATER);
    const { profile } = applyAdjustment(off.profile, { news: true }, LATER);

    expect(profile.news).toBe(true);
  });
});

describe("what the dials change", () => {
  it("cuts a short sitting to fewer items", () => {
    expect(agendaSizeFor({ sessionLength: "short" })).toBe(SHORT_SESSION_ITEMS);
    expect(SHORT_SESSION_ITEMS).toBeLessThan(MAX_AGENDA_ITEMS);
  });

  it("leans the mix towards the focus without abandoning the other pool", () => {
    expect(MIX_FOR_FOCUS.grammar.grammarSlots).toBeGreaterThan(
      MIX_FOR_FOCUS.balanced.grammarSlots,
    );
    expect(MIX_FOR_FOCUS.vocabulary.grammarSlots).toBeGreaterThanOrEqual(1);
    expect(MIX_FOR_FOCUS.vocabulary.grammarSlots).toBeLessThan(
      MIX_FOR_FOCUS.balanced.grammarSlots,
    );
  });

  it("describes only what differs from the defaults, in the learner's words", () => {
    const tuned = applyAdjustment(
      fresh(),
      { explanationDepth: "brief", sessionLength: "short", news: false },
      LATER,
    ).profile;

    expect(describeDials(tuned)).toEqual([
      "brief explanations",
      "shorter sessions",
      "no news item",
    ]);
  });
});
