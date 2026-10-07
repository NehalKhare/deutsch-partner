import { describe, expect, it, vi } from "vitest";

import type { StoredSubscription } from "@dp/db/billing-repository";

import { DELETION_PHRASE, deleteOwnAccount, type DeletionDeps } from "@/lib/account/deletion";

/**
 * Deleting one's own account: the phrase, the subscriptions first, the auth
 * user last, and nothing removed when any step before the last refuses
 * (billing-and-plans-spec.md S10).
 */

const IDENTITY = { learnerId: "22222222-2222-4222-8222-222222222222", userIdHash: "abc123" };

function subscription(over: Partial<StoredSubscription> = {}): StoredSubscription {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    learnerId: IDENTITY.learnerId,
    stripeSubscriptionId: "sub_Live1",
    stripePriceId: "price_PlusMonth",
    planCode: "plus",
    status: "active",
    currentPeriodEnd: new Date("2026-11-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
    trialEnd: null,
    canceledAt: null,
    syncedAt: new Date("2026-10-01T00:00:00Z"),
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...over,
  };
}

function deps(live: StoredSubscription[] = [], over: Partial<DeletionDeps> = {}) {
  const cancelAtPeriodEnd = vi.fn(async (id: string) => ({ id }) as never);
  const d: DeletionDeps = {
    provider: { cancelAtPeriodEnd } as never,
    admin: { liveSubscriptionsFor: vi.fn(async () => ({ ok: true as const, data: live })) },
    accounts: { delete: vi.fn(async () => ({ ok: true })) },
    limiter: { check: async () => ({ allowed: true, remaining: 2, resetAt: new Date() }) } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as never,
    ...over,
  };
  return { d, cancelAtPeriodEnd };
}

describe("deleting your own account", () => {
  it("needs the phrase, in any case and with spare whitespace", async () => {
    const { d } = deps();

    expect(await deleteOwnAccount(IDENTITY, "", d)).toEqual({ ok: false, error: "phrase" });
    expect(await deleteOwnAccount(IDENTITY, "delete", d)).toEqual({ ok: false, error: "phrase" });
    expect(await deleteOwnAccount(IDENTITY, `  ${DELETION_PHRASE.toUpperCase()} `, d)).toEqual({
      ok: true,
      subscriptionsEnded: 0,
    });
  });

  it("ends every live subscription at its paid period before the account goes", async () => {
    const { d, cancelAtPeriodEnd } = deps([
      subscription(),
      subscription({ stripeSubscriptionId: "sub_Live2", status: "past_due" }),
      subscription({ stripeSubscriptionId: "sub_Ending", cancelAtPeriodEnd: true }),
    ]);

    const outcome = await deleteOwnAccount(IDENTITY, DELETION_PHRASE, d);

    expect(outcome).toEqual({ ok: true, subscriptionsEnded: 2 });
    expect(cancelAtPeriodEnd.mock.calls.map(([id]) => id)).toEqual(["sub_Live1", "sub_Live2"]);
    expect(d.accounts.delete).toHaveBeenCalledWith(IDENTITY.learnerId);
    expect(d.logger.info).toHaveBeenCalledWith("account.deleted", expect.objectContaining({ audit: true, userIdHash: "abc123" }));
  });

  it("deletes nothing when a subscription could not be ended: it would keep charging", async () => {
    const { d, cancelAtPeriodEnd } = deps([subscription()]);
    cancelAtPeriodEnd.mockRejectedValueOnce(new Error("stripe down"));

    const outcome = await deleteOwnAccount(IDENTITY, DELETION_PHRASE, d);

    expect(outcome).toEqual({ ok: false, error: "subscription_not_cancelled" });
    expect(d.accounts.delete).not.toHaveBeenCalled();
  });

  it("deletes nothing when the subscriptions could not be read", async () => {
    const { d } = deps([], { admin: { liveSubscriptionsFor: async () => ({ ok: false, error: { kind: "unavailable" } }) as never } });

    expect(await deleteOwnAccount(IDENTITY, DELETION_PHRASE, d)).toEqual({ ok: false, error: "billing_unavailable" });
    expect(d.accounts.delete).not.toHaveBeenCalled();
  });

  it("refuses a live subscription with payments off, rather than orphaning it", async () => {
    const { d } = deps([subscription()], { provider: null });

    expect(await deleteOwnAccount(IDENTITY, DELETION_PHRASE, d)).toEqual({ ok: false, error: "subscription_not_cancelled" });
  });

  it("goes ahead with payments off when there is nothing live", async () => {
    const { d } = deps([], { provider: null });

    expect(await deleteOwnAccount(IDENTITY, DELETION_PHRASE, d)).toEqual({ ok: true, subscriptionsEnded: 0 });
  });

  it("says when the auth service refused, after the subscriptions were already ended", async () => {
    const { d } = deps([subscription()], { accounts: { delete: async () => ({ ok: false }) } });

    expect(await deleteOwnAccount(IDENTITY, DELETION_PHRASE, d)).toEqual({ ok: false, error: "auth_failed" });
    expect(d.logger.error).toHaveBeenCalledWith("account.delete_failed", expect.objectContaining({ subscriptionsEnded: 1 }));
  });

  it("is rate limited per learner", async () => {
    const { d } = deps([], { limiter: { check: async () => ({ allowed: false, remaining: 0, resetAt: new Date() }) } as never });

    expect(await deleteOwnAccount(IDENTITY, DELETION_PHRASE, d)).toEqual({ ok: false, error: "rate_limited" });
  });
});
