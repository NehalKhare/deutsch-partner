import { beforeEach, describe, expect, it } from "vitest";

import { PLAN_CATALOGUE, QUOTA_WINDOW_MS } from "@dp/domain/plans";

import { allowanceRenewsAt, isAllowanceScope } from "@/lib/billing/allowance";
import {
  TRAINER_AGENDA_OVERDRAFT,
  agendaOverdraftScope,
  consumeQuota,
  consumeTrainerQuota,
  quotaLimiterFor,
  quotaScope,
  resetQuotaLimiters,
} from "@/lib/api/quota";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

/**
 * The daily plan quotas (billing-and-plans-spec.md S2).
 *
 * The same fixed-window mechanism as the per-minute limits, keyed by
 * pseudonym, one window per plan per kind. The unit tests run on the
 * in-memory window the per-minute limits fall back to outside production;
 * the Postgres window itself is tested in packages/db.
 */

const ALICE = "0123456789abcdef0123456789abcdef";
const BOB = "fedcba9876543210fedcba9876543210";

beforeEach(() => {
  resetQuotaLimiters();
});

describe("a plan's daily allowance", () => {
  it("allows exactly the catalogue's number, then refuses until the window reopens", async () => {
    const limit = PLAN_CATALOGUE.free.dailyQuotas.tutor_turns;
    const before = Date.now();

    for (let turn = 1; turn <= limit; turn += 1) {
      expect((await consumeQuota("free", "tutor_turns", ALICE)).allowed).toBe(true);
    }
    const refused = await consumeQuota("free", "tutor_turns", ALICE);

    expect(refused).toMatchObject({ allowed: false, refusal: "quota_exhausted" });
    // A fixed day from the first use, not a calendar day.
    const resetAt = refused.allowed ? null : refused.resetAt;
    expect(resetAt!.getTime()).toBeGreaterThanOrEqual(before + QUOTA_WINDOW_MS);
    expect(resetAt!.getTime()).toBeLessThanOrEqual(Date.now() + QUOTA_WINDOW_MS);
  });

  it("says how much is left while there is some", async () => {
    const first = await consumeQuota("plus", "transcriptions", ALICE);

    expect(first).toMatchObject({
      allowed: true,
      remaining: PLAN_CATALOGUE.plus.dailyQuotas.transcriptions - 1,
    });
  });

  it("keeps learners apart", async () => {
    for (let turn = 0; turn < PLAN_CATALOGUE.free.dailyQuotas.transcriptions; turn += 1) {
      await consumeQuota("free", "transcriptions", ALICE);
    }

    expect((await consumeQuota("free", "transcriptions", ALICE)).allowed).toBe(false);
    expect((await consumeQuota("free", "transcriptions", BOB)).allowed).toBe(true);
  });

  it("keeps kinds apart, so a spent Trainer allowance leaves the tutor open", async () => {
    for (let turn = 0; turn < PLAN_CATALOGUE.free.dailyQuotas.trainer_requests; turn += 1) {
      await consumeQuota("free", "trainer_requests", ALICE);
    }

    expect((await consumeQuota("free", "trainer_requests", ALICE)).allowed).toBe(false);
    expect((await consumeQuota("free", "tutor_turns", ALICE)).allowed).toBe(true);
  });

  it("opens a new window on a new plan, so upgrading is felt straight away", async () => {
    for (let turn = 0; turn < PLAN_CATALOGUE.free.dailyQuotas.tutor_turns; turn += 1) {
      await consumeQuota("free", "tutor_turns", ALICE);
    }

    expect((await consumeQuota("free", "tutor_turns", ALICE)).allowed).toBe(false);
    expect((await consumeQuota("plus", "tutor_turns", ALICE)).allowed).toBe(true);
  });

  it("refuses a feature the plan does not include as plan_required, with no window to wait for", async () => {
    expect(PLAN_CATALOGUE.free.dailyQuotas.voice_lines).toBe(0);

    expect(await consumeQuota("free", "voice_lines", ALICE)).toEqual({
      allowed: false,
      refusal: "plan_required",
      resetAt: null,
    });
  });
});

describe("a Trainer agenda under way", () => {
  // Spec S4: a quota never interrupts a Trainer agenda midway. The day's
  // requests are counted as ever; a session that was started inside them is
  // let finish from a small overdraft, and only a new session is refused.
  const spend = async (plan: "free" | "plus") => {
    for (let request = 0; request < PLAN_CATALOGUE[plan].dailyQuotas.trainer_requests; request += 1) {
      expect((await consumeTrainerQuota(plan, ALICE, { continuing: false })).allowed).toBe(true);
    }
  };

  it("refuses a new session once the day's requests are spent", async () => {
    await spend("free");

    expect(await consumeTrainerQuota("free", ALICE, { continuing: false })).toMatchObject({
      allowed: false,
      refusal: "quota_exhausted",
    });
  });

  it("lets a session already under way carry on past the day's number", async () => {
    await spend("free");

    for (let request = 0; request < TRAINER_AGENDA_OVERDRAFT; request += 1) {
      expect((await consumeTrainerQuota("free", ALICE, { continuing: true })).allowed).toBe(true);
    }
  });

  it("bounds that overdraft, so a client that always claims a session under way cannot go on for ever", async () => {
    await spend("free");
    for (let request = 0; request < TRAINER_AGENDA_OVERDRAFT; request += 1) {
      await consumeTrainerQuota("free", ALICE, { continuing: true });
    }

    expect(await consumeTrainerQuota("free", ALICE, { continuing: true })).toMatchObject({
      allowed: false,
      refusal: "quota_exhausted",
    });
  });

  it("covers the longest agenda a session can pin, twice over", () => {
    expect(TRAINER_AGENDA_OVERDRAFT).toBeGreaterThanOrEqual(2 * 8);
  });

  it("counts a continuing request against the day as ever while the day has room", async () => {
    await consumeTrainerQuota("plus", ALICE, { continuing: true });

    expect(await consumeQuota("plus", "trainer_requests", ALICE)).toMatchObject({
      allowed: true,
      remaining: PLAN_CATALOGUE.plus.dailyQuotas.trainer_requests - 2,
    });
  });
});

describe("where the windows live", () => {
  it("names one scope per plan and kind", () => {
    expect(quotaScope("free", "tutor_turns")).toBe("quota_tutor_turns_free");
    expect(quotaScope("premium", "voice_lines")).toBe("quota_voice_lines_premium");
  });

  it("never shares a scope with a per-minute limit", () => {
    const perMinute = new Set(Object.keys(RATE_LIMITS));

    for (const plan of ["free", "plus", "premium"] as const) {
      expect(perMinute.has(agendaOverdraftScope(plan))).toBe(false);
      for (const kind of ["tutor_turns", "trainer_requests", "transcriptions", "voice_lines"] as const) {
        expect(perMinute.has(quotaScope(plan, kind))).toBe(false);
      }
    }
  });

  it("keeps a bucket key well inside what the store accepts", () => {
    // consume_rate_limit refuses a key over 200 characters.
    expect(`${quotaScope("premium", "trainer_requests")}:${ALICE}`.length).toBeLessThan(200);
  });

  it("returns one limiter per plan and kind, so a quota is not per call site", () => {
    expect(quotaLimiterFor("free", "tutor_turns")).toBe(quotaLimiterFor("free", "tutor_turns"));
    expect(quotaLimiterFor("free", "tutor_turns")).not.toBe(quotaLimiterFor("plus", "tutor_turns"));
  });
});

describe("a learner's own euro allowance", () => {
  it("is the per-learner scopes, and nothing product-wide", () => {
    expect(isAllowanceScope("per_user_monthly")).toBe(true);
    expect(isAllowanceScope("per_user_daily")).toBe(true);
    expect(isAllowanceScope("global_daily")).toBe(false);
    expect(isAllowanceScope("per_request")).toBe(false);
    expect(isAllowanceScope(null)).toBe(false);
    expect(isAllowanceScope(undefined)).toBe(false);
  });

  it("renews when the counter's period turns over", () => {
    const now = new Date("2026-10-15T08:00:00.000Z");

    expect(allowanceRenewsAt("per_user_monthly", now).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(allowanceRenewsAt("per_user_daily", now).toISOString()).toBe("2026-10-16T00:00:00.000Z");
  });
});
