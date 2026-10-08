import { describe, expect, it } from "vitest";

import {
  LEARNER_NOTIFICATION_KINDS,
  OPS_NOTIFICATION_KINDS,
  learnerNotificationFor,
  newLearnerNotificationSchema,
  newOpsNotificationSchema,
  notificationFeedSchema,
  notificationHrefSchema,
  opsNotificationFor,
  type LearnerNotificationEvent,
  type OpsNotificationEvent,
} from "../src/notifications";

/**
 * Notifications: every kind composes to a row the schema accepts, every
 * link stays on this origin, and the same event twice collapses where it
 * should and not where it should not.
 */

const LEARNER_EVENTS: readonly LearnerNotificationEvent[] = [
  { kind: "level.advanced", from: 26, to: 27, theme: "Im Restaurant", cefr: "A2", earned: true },
  { kind: "level.advanced", from: 26, to: 27, theme: "Im Restaurant", cefr: "A2", earned: false },
  { kind: "billing.subscription_started", plan: "plus", trial: false },
  { kind: "billing.subscription_started", plan: "premium", trial: true },
  { kind: "billing.subscription_ended", plan: "plus" },
  { kind: "billing.payment_failed", plan: "premium" },
  { kind: "billing.pass_granted", plan: "plus", days: 180, endsAt: new Date("2027-04-06T12:00:00Z") },
  { kind: "billing.pass_revoked", plan: "plus" },
  { kind: "account.withdrawal_received", reference: "WITHDRAW01" },
];

const OPS_EVENTS: readonly OpsNotificationEvent[] = [
  { kind: "productops.review_needed", runId: "run-1", stage: "human_review" },
  { kind: "productops.run_failed", runId: "run-1", stage: "research", detail: "budget_exhausted" },
  { kind: "productops.run_failed", runId: "run-2", stage: null, detail: null },
  { kind: "productops.run_completed", runId: "run-1" },
  { kind: "budget.threshold", scope: "global_daily", state: "warn", ratio: 0.71, limitEur: 50, day: "2026-10-08" },
  { kind: "budget.threshold", scope: "global_daily", state: "degrade", ratio: 0.9, limitEur: 50, day: "2026-10-08" },
  { kind: "budget.threshold", scope: "global_daily", state: "deny", ratio: 1.02, limitEur: 50, day: "2026-10-08" },
  { kind: "jobs.dead_lettered", jobId: 42, jobKind: "pricing.snapshot", errorCode: "provider_error", attempts: 5 },
  { kind: "billing.event_failed", eventId: "evt_1", eventType: "customer.subscription.updated", code: "unknown_offer" },
  { kind: "contract_notice.received", noticeKind: "cancellation", contract: "unknown", reference: "ABCDEFGH23" },
  { kind: "account.deleted", userIdHash: "0123456789abcdef0123456789abcdef", subscriptionsEnded: 1 },
];

describe("every learner event", () => {
  it.each(LEARNER_EVENTS.map((event) => [event.kind, event] as const))(
    "%s composes to a notification the schema accepts",
    (_kind, event) => {
      const parsed = newLearnerNotificationSchema.safeParse(learnerNotificationFor(event));

      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    },
  );

  it("covers every kind the table accepts", () => {
    const composed = new Set(LEARNER_EVENTS.map((event) => learnerNotificationFor(event).kind));

    expect([...composed].sort()).toEqual([...LEARNER_NOTIFICATION_KINDS].sort());
  });
});

describe("every operator event", () => {
  it.each(OPS_EVENTS.map((event) => [event.kind, event] as const))(
    "%s composes to a notification the schema accepts",
    (_kind, event) => {
      const parsed = newOpsNotificationSchema.safeParse(opsNotificationFor(event));

      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    },
  );

  it("covers every kind the table accepts", () => {
    const composed = new Set(OPS_EVENTS.map((event) => opsNotificationFor(event).kind));

    expect([...composed].sort()).toEqual([...OPS_NOTIFICATION_KINDS].sort());
  });
});

describe("the wording", () => {
  it("tells a learner whether they earned the move or asked for it", () => {
    const earned = learnerNotificationFor({ kind: "level.advanced", from: 26, to: 27, theme: "Im Restaurant", cefr: "A2", earned: true });
    const asked = learnerNotificationFor({ kind: "level.advanced", from: 26, to: 27, theme: "Im Restaurant", cefr: "A2", earned: false });

    expect(earned.title).toBe("Mini-level 26 mastered");
    expect(asked.title).toBe("Moved on to mini-level 27");
    expect(asked.body).toContain("skipped");
    expect(earned.body).not.toContain("skipped");
  });

  it("names the plan a learner is told about, never its code", () => {
    const started = learnerNotificationFor({ kind: "billing.subscription_started", plan: "premium", trial: false });

    expect(started.title).toContain("Premium");
    expect(`${started.title} ${started.body}`).not.toMatch(/\bpremium\b/);
  });

  it("says a trial is card-free and ends on its own", () => {
    const trial = learnerNotificationFor({ kind: "billing.subscription_started", plan: "plus", trial: true });

    expect(trial.title).toMatch(/trial/i);
    expect(trial.body).toMatch(/no card is charged/);
  });

  it("gives a pass its end date as a date, not a timestamp", () => {
    const pass = learnerNotificationFor({
      kind: "billing.pass_granted",
      plan: "plus",
      days: 180,
      endsAt: new Date("2027-04-06T12:34:56Z"),
    });

    expect(pass.body).toContain("2027-04-06");
    expect(pass.body).not.toContain("12:34");
  });

  it("grades the budget by state: a warning is a warning, the rest are critical", () => {
    const at = (state: "warn" | "degrade" | "deny") =>
      opsNotificationFor({ kind: "budget.threshold", scope: "global_daily", state, ratio: 0.9, limitEur: 50, day: "2026-10-08" });

    expect(at("warn").severity).toBe("warning");
    expect(at("degrade").severity).toBe("critical");
    expect(at("deny").severity).toBe("critical");
    expect(at("deny").body).toMatch(/refused/);
  });

  it("names the review gate in words an operator reads on the board", () => {
    const review = opsNotificationFor({ kind: "productops.review_needed", runId: "run-1", stage: "plan_review" });

    expect(review.body).toContain("the plan review");
    expect(review.href).toBe("/product");
  });

  it("carries a learner's pseudonym into an operator's notification, abbreviated, and never an id", () => {
    const deleted = opsNotificationFor({
      kind: "account.deleted",
      userIdHash: "0123456789abcdef0123456789abcdef",
      subscriptionsEnded: 0,
    });

    expect(deleted.body).toContain("0123456789ab");
    expect(deleted.body).not.toContain("0123456789abcdef0123456789abcdef");
    expect(deleted.subject).toBe("0123456789abcdef0123456789abcdef");
  });
});

describe("deduplication", () => {
  it("collapses the same gate, the same budget day and the same job, which can each be raised again", () => {
    const review = () => opsNotificationFor({ kind: "productops.review_needed", runId: "run-1", stage: "human_review" });
    const budget = () =>
      opsNotificationFor({ kind: "budget.threshold", scope: "global_daily", state: "deny", ratio: 1.1, limitEur: 50, day: "2026-10-08" });
    const dead = () => opsNotificationFor({ kind: "jobs.dead_lettered", jobId: 42, jobKind: "fx.refresh", errorCode: "x", attempts: 5 });

    expect(review().dedupeKey).toBe(review().dedupeKey);
    expect(budget().dedupeKey).toBe("budget:global_daily:deny:2026-10-08");
    expect(dead().dedupeKey).toBe("jobs:dead:42");
  });

  it("tells one gate from the next on the same run, and one day's budget from the next", () => {
    const first = opsNotificationFor({ kind: "productops.review_needed", runId: "run-1", stage: "human_review" });
    const second = opsNotificationFor({ kind: "productops.review_needed", runId: "run-1", stage: "plan_review" });
    const today = opsNotificationFor({ kind: "budget.threshold", scope: "global_daily", state: "warn", ratio: 0.7, limitEur: 50, day: "2026-10-08" });
    const tomorrow = opsNotificationFor({ kind: "budget.threshold", scope: "global_daily", state: "warn", ratio: 0.7, limitEur: 50, day: "2026-10-09" });

    expect(first.dedupeKey).not.toBe(second.dedupeKey);
    expect(today.dedupeKey).not.toBe(tomorrow.dedupeKey);
  });

  it("lets a learner be told about every move and every purchase, which are never duplicates", () => {
    expect(learnerNotificationFor({ kind: "level.advanced", from: 1, to: 2, theme: "x", cefr: "A1", earned: false }).dedupeKey).toBeNull();
    expect(learnerNotificationFor({ kind: "billing.pass_granted", plan: "plus", days: 30, endsAt: new Date() }).dedupeKey).toBeNull();
  });
});

describe("links", () => {
  it("accepts a path and refuses anything that could leave this origin", () => {
    expect(notificationHrefSchema.safeParse("/billing").success).toBe(true);
    expect(notificationHrefSchema.safeParse("/product/runs?x=1").success).toBe(true);
    expect(notificationHrefSchema.safeParse("//evil.example").success).toBe(false);
    expect(notificationHrefSchema.safeParse("https://evil.example").success).toBe(false);
    expect(notificationHrefSchema.safeParse("billing").success).toBe(false);
    expect(notificationHrefSchema.safeParse("/bil ling").success).toBe(false);
  });

  it("points every learner notification at a page a learner has", () => {
    for (const event of LEARNER_EVENTS) {
      const href = learnerNotificationFor(event).href;
      expect(href === null || ["/curriculum", "/billing"].includes(href), event.kind).toBe(true);
    }
  });
});

describe("the feed", () => {
  it("is a count and a list of items with ISO timestamps", () => {
    const parsed = notificationFeedSchema.safeParse({
      unread: 2,
      items: [
        {
          id: "1",
          kind: "jobs.dead_lettered",
          severity: "critical",
          title: "t",
          body: "b",
          href: null,
          createdAt: "2026-10-08T10:00:00.000Z",
          readAt: null,
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it("refuses a negative count and a bare date", () => {
    expect(notificationFeedSchema.safeParse({ unread: -1, items: [] }).success).toBe(false);
    expect(
      notificationFeedSchema.safeParse({
        unread: 0,
        items: [{ id: "1", kind: "k", severity: "info", title: "t", body: "b", href: null, createdAt: "2026-10-08", readAt: null }],
      }).success,
    ).toBe(false);
  });
});
