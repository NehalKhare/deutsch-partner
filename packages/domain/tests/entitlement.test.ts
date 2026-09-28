import { describe, expect, it } from "vitest";

import type { CompGrant, PassGrant, SubscriptionGrant } from "../src/billing";
import {
  SUBSCRIPTION_GRACE_MS,
  nextPassStart,
  resolveEntitlement,
  trialEligible,
  trialUsed,
} from "../src/entitlement";

/**
 * Entitlement, over rows already read.
 *
 * billing-and-plans-spec.md S5: the highest-ranked current grant wins, free
 * when there is none. Pure, so every Stripe status and every edge of a pass's
 * window is covered here without a database or a webhook.
 */

const NOW = new Date("2026-10-01T12:00:00.000Z");
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

function subscription(over: Partial<SubscriptionGrant> = {}): SubscriptionGrant {
  return {
    planCode: "plus",
    status: "active",
    currentPeriodEnd: at(10 * DAY),
    cancelAtPeriodEnd: false,
    trialEnd: null,
    ...over,
  };
}

function pass(over: Partial<PassGrant> = {}): PassGrant {
  return {
    planCode: "plus",
    startsAt: at(-DAY),
    endsAt: at(30 * DAY),
    revokedAt: null,
    ...over,
  };
}

function comp(over: Partial<CompGrant> = {}): CompGrant {
  return {
    planCode: "premium",
    startsAt: at(-DAY),
    endsAt: null,
    revokedAt: null,
    ...over,
  };
}

const resolve = (
  subscriptions: readonly SubscriptionGrant[],
  passes: readonly PassGrant[] = [],
  comps: readonly CompGrant[] = [],
) => resolveEntitlement({ subscriptions, passes, comps, now: NOW });

describe("with nothing to grant", () => {
  it("is free, from nowhere, with no end", () => {
    expect(resolve([], [])).toEqual({ plan: "free", source: "free", until: null });
  });
});

describe("a subscription", () => {
  it("grants its plan until its period ends", () => {
    expect(resolve([subscription({ planCode: "premium" })])).toEqual({
      plan: "premium",
      source: "subscription",
      until: at(10 * DAY),
    });
  });

  it.each(["active", "trialing", "past_due"] as const)("grants while %s", (status) => {
    expect(resolve([subscription({ status })]).plan).toBe("plus");
  });

  it.each(["incomplete", "incomplete_expired", "unpaid", "canceled", "paused"] as const)(
    "grants nothing while %s",
    (status) => {
      expect(resolve([subscription({ status })])).toEqual({ plan: "free", source: "free", until: null });
    },
  );

  it("still grants when it is set to cancel at the end of the period", () => {
    expect(resolve([subscription({ cancelAtPeriodEnd: true })]).plan).toBe("plus");
  });

  it("stops granting at the period end when it was set to cancel there", () => {
    // It will not renew, so no renewal webhook can be late: the end is the end.
    expect(
      resolve([subscription({ cancelAtPeriodEnd: true, currentPeriodEnd: at(-1) })]).plan,
    ).toBe("free");
  });

  it("keeps granting through a short grace after a renewing period ends", () => {
    // The renewal's webhook can arrive after the old period has ended; a
    // learner who paid should not bounce to free in that gap.
    const lapsed = subscription({ currentPeriodEnd: at(-(SUBSCRIPTION_GRACE_MS - 1)) });

    expect(resolve([lapsed]).plan).toBe("plus");
  });

  it("stops granting once the grace is over, so a missed webhook cannot grant forever", () => {
    const lapsed = subscription({ currentPeriodEnd: at(-SUBSCRIPTION_GRACE_MS) });

    expect(resolve([lapsed]).plan).toBe("free");
    expect(SUBSCRIPTION_GRACE_MS).toBe(3 * DAY);
  });

  it("gives a trial no grace: a card-free trial has no renewal to wait for", () => {
    // A trial that cannot convert ends at its end. The grace exists for a
    // late renewal webhook, and a lost customer.subscription.deleted would
    // otherwise hand out three more days of Premium.
    const ended = subscription({
      planCode: "premium",
      status: "trialing",
      currentPeriodEnd: at(-1),
      trialEnd: at(-1),
    });

    expect(resolve([ended]).plan).toBe("free");
    expect(resolve([{ ...ended, currentPeriodEnd: at(DAY), trialEnd: at(DAY) }]).plan).toBe("premium");
  });

  it("grants with no known end when Stripe has not told us one", () => {
    expect(resolve([subscription({ currentPeriodEnd: null })])).toEqual({
      plan: "plus",
      source: "subscription",
      until: null,
    });
  });
});

describe("a pass", () => {
  it("grants its plan inside its window", () => {
    expect(resolve([], [pass({ planCode: "premium" })])).toEqual({
      plan: "premium",
      source: "pass",
      until: at(30 * DAY),
    });
  });

  it("starts at its start, inclusive", () => {
    expect(resolve([], [pass({ startsAt: NOW })]).plan).toBe("plus");
  });

  it("ends at its end, exclusive", () => {
    expect(resolve([], [pass({ endsAt: NOW })]).plan).toBe("free");
  });

  it("grants nothing before it starts", () => {
    expect(resolve([], [pass({ startsAt: at(1), endsAt: at(DAY) })]).plan).toBe("free");
  });

  it("grants nothing once it is revoked, however much of it is left", () => {
    expect(resolve([], [pass({ revokedAt: at(-1) })]).plan).toBe("free");
  });
});

describe("an operator comp", () => {
  it("grants its plan with no end while it has none", () => {
    expect(resolve([], [], [comp()])).toEqual({ plan: "premium", source: "comp", until: null });
  });

  it("grants until its end when it has one, end exclusive", () => {
    expect(resolve([], [], [comp({ endsAt: at(30 * DAY) })])).toEqual({
      plan: "premium",
      source: "comp",
      until: at(30 * DAY),
    });
    expect(resolve([], [], [comp({ endsAt: NOW })]).plan).toBe("free");
  });

  it("grants nothing before it starts", () => {
    expect(resolve([], [], [comp({ startsAt: at(1) })]).plan).toBe("free");
  });

  it("grants nothing once it is revoked, even one with no end", () => {
    expect(resolve([], [], [comp({ revokedAt: at(-1) })]).plan).toBe("free");
  });

  it("outlasts a paid grant of the same plan, because it has not ended", () => {
    const entitlement = resolve([subscription({ planCode: "premium" })], [], [comp()]);

    expect(entitlement).toEqual({ plan: "premium", source: "comp", until: null });
  });

  it("is absent from the input where a caller has no comp rows to hand", () => {
    expect(resolveEntitlement({ subscriptions: [], passes: [], now: NOW }).plan).toBe("free");
  });
});

describe("several grants at once", () => {
  it("resolves to the highest-ranked plan", () => {
    const entitlement = resolve(
      [subscription({ planCode: "plus" })],
      [pass({ planCode: "premium", endsAt: at(2 * DAY) })],
    );

    expect(entitlement).toEqual({ plan: "premium", source: "pass", until: at(2 * DAY) });
  });

  it("ignores a higher plan that does not currently grant", () => {
    const entitlement = resolve([
      subscription({ planCode: "premium", status: "canceled" }),
      subscription({ planCode: "plus" }),
    ]);

    expect(entitlement.plan).toBe("plus");
  });

  it("prefers the grant that lasts longer between two of the same plan", () => {
    const entitlement = resolve(
      [subscription({ planCode: "plus", currentPeriodEnd: at(5 * DAY) })],
      [pass({ planCode: "plus", endsAt: at(40 * DAY) })],
    );

    expect(entitlement).toEqual({ plan: "plus", source: "pass", until: at(40 * DAY) });
  });

  it("treats an unknown end as the longest, because it has not ended", () => {
    const entitlement = resolve(
      [subscription({ planCode: "plus", currentPeriodEnd: null })],
      [pass({ planCode: "plus", endsAt: at(400 * DAY) })],
    );

    expect(entitlement).toEqual({ plan: "plus", source: "subscription", until: null });
  });

  it("does not depend on the order the rows were read in", () => {
    const subscriptions = [subscription({ planCode: "plus" }), subscription({ planCode: "premium" })];
    const passes = [pass({ planCode: "plus" }), pass({ planCode: "premium", endsAt: at(3 * DAY) })];

    expect(resolve(subscriptions, passes)).toEqual(resolve([...subscriptions].reverse(), [...passes].reverse()));
  });
});

describe("trial eligibility", () => {
  it("is one trial per learner, ever", () => {
    expect(trialEligible([])).toBe(true);
    // Any subscription at all, including a trial that ran out or one that
    // never completed, uses the learner's one trial.
    expect(trialEligible([subscription({ status: "canceled", currentPeriodEnd: at(-100 * DAY) })])).toBe(false);
    expect(trialEligible([subscription({ status: "incomplete_expired" })])).toBe(false);
  });

  it("tells a used trial apart from a subscription that was never a trial", () => {
    // Both rule the trial out; only one of them is the learner having had it.
    expect(trialUsed([])).toBe(false);
    expect(trialUsed([subscription({ status: "canceled" })])).toBe(false);
    expect(trialUsed([subscription({ planCode: "premium", status: "canceled", trialEnd: at(-DAY) })])).toBe(true);
  });
});

describe("when a newly bought pass starts", () => {
  it("starts now when nothing of the same plan is running", () => {
    expect(nextPassStart([], "plus", NOW)).toEqual(NOW);
  });

  it("starts where the running pass of the same plan ends, so passes stack", () => {
    expect(nextPassStart([pass({ endsAt: at(30 * DAY) })], "plus", NOW)).toEqual(at(30 * DAY));
  });

  it("stacks after the last of several, including one that has not begun", () => {
    const passes = [
      pass({ startsAt: at(-DAY), endsAt: at(30 * DAY) }),
      pass({ startsAt: at(30 * DAY), endsAt: at(120 * DAY) }),
    ];

    expect(nextPassStart(passes, "plus", NOW)).toEqual(at(120 * DAY));
  });

  it("ignores passes of another plan, expired passes and revoked ones", () => {
    const passes = [
      pass({ planCode: "premium", endsAt: at(60 * DAY) }),
      pass({ startsAt: at(-90 * DAY), endsAt: at(-1) }),
      pass({ endsAt: at(90 * DAY), revokedAt: at(-DAY) }),
    ];

    expect(nextPassStart(passes, "plus", NOW)).toEqual(NOW);
  });

  it("hands back a date of its own, not one of the rows it was given", () => {
    const running = pass({ endsAt: at(30 * DAY) });
    const start = nextPassStart([running], "plus", NOW);

    start.setTime(0);
    expect(running.endsAt).toEqual(at(30 * DAY));
  });
});
