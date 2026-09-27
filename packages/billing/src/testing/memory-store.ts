import { randomUUID } from "node:crypto";

import {
  billingPriceInputSchema,
  type BillingAdminRepository,
  type BillingPrice,
  type CheckoutStatus,
  type StoredPass,
  type StoredSubscription,
} from "@dp/db/billing-repository";
import { fail, ok, repositoryError, type RepositoryErrorKind } from "@dp/db/errors";
import { OFFERS, TRIAL_PLAN, type OfferKey } from "@dp/domain/billing";
import { nextPassStart } from "@dp/domain/entitlement";

/**
 * BillingAdminRepository in memory, for tests.
 *
 * It keeps the promises the SQL functions make — a claim taken once, a
 * subscription never regressed by an older read nor moved between learners,
 * a pass granted once per session, stacked after the last of its plan and
 * revoked once, bringing later ones forward; one trial checkout at a time —
 * so a webhook test exercises the same idempotency it will meet in Postgres.
 * It is not Postgres: no constraint, no RLS, no transaction, no lock.
 * tests/db in this package runs the webhook against the real repository for
 * those.
 *
 * Reachable by tests only; a CI test keeps product code from importing it.
 */

export interface StoredEvent {
  readonly type: string;
  readonly createdAt: Date;
  readonly status: "received" | "processed" | "failed" | "ignored";
  readonly errorCode: string | null;
  readonly attempts: number;
}

export interface StoredCheckout {
  readonly id: string;
  readonly learnerId: string;
  readonly offerKey: OfferKey;
  readonly kind: "order" | "trial";
  readonly sessionId: string | null;
  readonly status: CheckoutStatus;
  readonly createdAt: Date;
}

export interface MemoryBillingSnapshot {
  /** learner id → Stripe customer id */
  readonly customers: ReadonlyMap<string, string>;
  readonly checkouts: ReadonlyMap<string, StoredCheckout>;
  /** By Stripe subscription id. */
  readonly subscriptions: ReadonlyMap<string, StoredSubscription>;
  /** By Checkout Session id, the pass's idempotency key. */
  readonly passes: ReadonlyMap<string, StoredPass>;
  readonly events: ReadonlyMap<string, StoredEvent>;
  readonly prices: readonly BillingPrice[];
}

export interface MemoryBillingStore extends BillingAdminRepository {
  snapshot(): MemoryBillingSnapshot;
  /** The next call to `method` fails as the real repository would, with this kind. */
  failWith(method: keyof BillingAdminRepository, kind: RepositoryErrorKind): void;
}

const DAY_MS = 86_400_000;
/** billing_open_trial_checkout's allowance for a completion announced a little late. */
const TRIAL_GRACE_MS = 300_000;

export function createMemoryBillingStore(): MemoryBillingStore {
  const customers = new Map<string, string>();
  const checkouts = new Map<string, StoredCheckout>();
  const subscriptions = new Map<string, StoredSubscription>();
  const passes = new Map<string, StoredPass>();
  const events = new Map<string, StoredEvent>();
  let prices: BillingPrice[] = [];
  const failures = new Map<string, RepositoryErrorKind>();

  /** A scripted failure, consumed by the call it was scripted for. */
  const failure = (method: keyof BillingAdminRepository) => {
    const kind = failures.get(method);
    if (kind === undefined) return null;
    failures.delete(method);
    return fail(repositoryError(kind));
  };

  const store: MemoryBillingStore = {
    snapshot: () => ({ customers, checkouts, subscriptions, passes, events, prices }),
    failWith: (method, kind) => {
      failures.set(method, kind);
    },

    async customerFor(learnerId) {
      return failure("customerFor") ?? ok(customers.get(learnerId) ?? null);
    },

    async saveCustomer(learnerId, stripeCustomerId) {
      const failed = failure("saveCustomer");
      if (failed) return failed;
      const owner = [...customers.entries()].find(([, customer]) => customer === stripeCustomerId)?.[0];
      if (owner !== undefined && owner !== learnerId) return fail(repositoryError("conflict"));
      if (!customers.has(learnerId)) customers.set(learnerId, stripeCustomerId);
      return ok(customers.get(learnerId)!);
    },

    async learnerForCustomer(stripeCustomerId) {
      const failed = failure("learnerForCustomer");
      if (failed) return failed;
      const owner = [...customers.entries()].find(([, customer]) => customer === stripeCustomerId)?.[0];
      return ok(owner ?? null);
    },

    async createCheckout(input) {
      const failed = failure("createCheckout");
      if (failed) return failed;
      if (input.kind !== "order" || input.earlyStartConsentAt === null) return fail(repositoryError("invalid_input"));
      const id = randomUUID();
      checkouts.set(id, {
        id,
        learnerId: input.learnerId,
        offerKey: input.offerKey,
        kind: "order",
        sessionId: null,
        status: "created",
        createdAt: new Date(),
      });
      return ok(id);
    },

    async openTrialCheckout(input) {
      const failed = failure("openTrialCheckout");
      if (failed) return failed;
      const offer = OFFERS[input.offerKey];
      if (offer.plan !== TRIAL_PLAN || offer.kind !== "subscription") return fail(repositoryError("invalid_input"));

      const own = [...checkouts.values()].filter((row) => row.learnerId === input.learnerId && row.kind === "trial");
      const subscribed = [...subscriptions.values()].some((row) => row.learnerId === input.learnerId);
      if (subscribed || own.some((row) => row.status === "completed")) return ok({ status: "used" as const });

      const openSince = Date.now() - input.openForSeconds * 1000 - TRIAL_GRACE_MS;
      const open = own.some(
        (row) => (row.status === "created" || row.status === "opened") && row.createdAt.getTime() > openSince,
      );
      if (open) return ok({ status: "open" as const });

      const id = randomUUID();
      checkouts.set(id, {
        id,
        learnerId: input.learnerId,
        offerKey: input.offerKey,
        kind: "trial",
        sessionId: null,
        status: "created",
        createdAt: new Date(),
      });
      return ok({ status: "created" as const, id });
    },

    async abandonCheckout(checkoutId) {
      const failed = failure("abandonCheckout");
      if (failed) return failed;
      const checkout = checkouts.get(checkoutId);
      if (checkout === undefined || checkout.status !== "created") return ok(false);
      checkouts.set(checkoutId, { ...checkout, status: "failed" });
      return ok(true);
    },

    async attachCheckoutSession(checkoutId, sessionId) {
      const failed = failure("attachCheckoutSession");
      if (failed) return failed;
      const checkout = checkouts.get(checkoutId);
      if (checkout === undefined) return ok(false);
      checkouts.set(checkoutId, { ...checkout, sessionId, status: "opened" });
      return ok(true);
    },

    async setCheckoutStatus(sessionId, status) {
      const failed = failure("setCheckoutStatus");
      if (failed) return failed;
      const checkout = [...checkouts.values()].find((candidate) => candidate.sessionId === sessionId);
      if (checkout === undefined) return ok(false);
      checkouts.set(checkout.id, { ...checkout, status });
      return ok(true);
    },

    async upsertSubscription(record) {
      const failed = failure("upsertSubscription");
      if (failed) return failed;
      const before = subscriptions.get(record.stripeSubscriptionId) ?? null;
      if (before !== null && before.learnerId !== record.learnerId) return fail(repositoryError("forbidden"));
      if (before !== null && before.syncedAt.getTime() > record.syncedAt.getTime()) {
        return ok({ before, after: before, applied: false });
      }
      const after: StoredSubscription = {
        id: before?.id ?? randomUUID(),
        learnerId: record.learnerId,
        stripeSubscriptionId: record.stripeSubscriptionId,
        stripePriceId: record.stripePriceId,
        planCode: record.planCode,
        status: record.status,
        currentPeriodEnd: record.currentPeriodEnd,
        cancelAtPeriodEnd: record.cancelAtPeriodEnd,
        trialEnd: record.trialEnd,
        canceledAt: record.canceledAt,
        syncedAt: record.syncedAt,
        createdAt: before?.createdAt ?? record.syncedAt,
      };
      subscriptions.set(record.stripeSubscriptionId, after);
      return ok({ before, after, applied: true });
    },

    async storedSubscription(stripeSubscriptionId) {
      const failed = failure("storedSubscription");
      if (failed) return failed;
      const row = subscriptions.get(stripeSubscriptionId);
      return ok(row === undefined ? null : { planCode: row.planCode, stripePriceId: row.stripePriceId });
    },

    async grantPass(input) {
      const failed = failure("grantPass");
      if (failed) return failed;
      const existing = passes.get(input.stripeCheckoutSessionId);
      if (existing !== undefined) return ok({ pass: existing, created: false });
      // As billing_grant_pass decides it: after the learner's latest
      // unrevoked pass of the plan, or when it was paid for.
      const own = [...passes.values()].filter((pass) => pass.learnerId === input.learnerId);
      const startsAt = nextPassStart(own, input.planCode, input.at);
      const pass: StoredPass = {
        id: randomUUID(),
        learnerId: input.learnerId,
        planCode: input.planCode,
        startsAt,
        endsAt: new Date(startsAt.getTime() + input.days * DAY_MS),
        revokedAt: null,
        stripeCheckoutSessionId: input.stripeCheckoutSessionId,
        stripePaymentIntentId: input.stripePaymentIntentId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        createdAt: input.at,
      };
      passes.set(input.stripeCheckoutSessionId, pass);
      return ok({ pass, created: true });
    },

    async revokePassByPaymentIntent(paymentIntentId, at) {
      const failed = failure("revokePassByPaymentIntent");
      if (failed) return failed;
      const pass = [...passes.values()].find(
        (candidate) => candidate.stripePaymentIntentId === paymentIntentId && candidate.revokedAt === null,
      );
      if (pass === undefined) return ok(null);
      passes.set(pass.stripeCheckoutSessionId, { ...pass, revokedAt: at });

      // As billing_revoke_pass does: what of it was still to come is given
      // back to the passes stacked behind it.
      const unused =
        pass.endsAt.getTime() - Math.max(pass.startsAt.getTime(), Math.min(at.getTime(), pass.endsAt.getTime()));
      if (unused > 0) {
        for (const later of passes.values()) {
          if (
            later.id !== pass.id &&
            later.learnerId === pass.learnerId &&
            later.planCode === pass.planCode &&
            later.revokedAt === null &&
            later.startsAt.getTime() >= pass.endsAt.getTime()
          ) {
            passes.set(later.stripeCheckoutSessionId, {
              ...later,
              startsAt: new Date(later.startsAt.getTime() - unused),
              endsAt: new Date(later.endsAt.getTime() - unused),
            });
          }
        }
      }
      return ok({ id: pass.id, learnerId: pass.learnerId, planCode: pass.planCode });
    },

    async passesFor(learnerId) {
      const failed = failure("passesFor");
      if (failed) return failed;
      return ok(
        [...passes.values()]
          .filter((pass) => pass.learnerId === learnerId)
          .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime()),
      );
    },

    async claimEvent({ eventId, type, createdAt }) {
      const failed = failure("claimEvent");
      if (failed) return failed;
      const existing = events.get(eventId);
      if (existing === undefined) {
        events.set(eventId, { type, createdAt, status: "received", errorCode: null, attempts: 1 });
        return ok("new");
      }
      if (existing.status === "processed" || existing.status === "ignored") return ok("processed");
      events.set(eventId, { ...existing, status: "received", attempts: existing.attempts + 1 });
      return ok("retry");
    },

    async finishEvent(eventId, status, errorCode = null) {
      const failed = failure("finishEvent");
      if (failed) return failed;
      if (status === "failed" && errorCode === null) return fail(repositoryError("invalid_input"));
      const existing = events.get(eventId);
      if (existing === undefined) return ok(false);
      events.set(eventId, { ...existing, status, errorCode });
      return ok(true);
    },

    async replacePrices(rows, fetchedAt) {
      const failed = failure("replacePrices");
      if (failed) return failed;
      // As the SQL refuses the whole batch for one bad row, so does this.
      if (!rows.every((row) => billingPriceInputSchema.safeParse(row).success)) {
        return fail(repositoryError("invalid_input"));
      }
      const key = (row: { stripePriceId: string; currency: string }) => `${row.stripePriceId}/${row.currency}`;
      const incoming = new Set(rows.map(key));
      let deactivated = 0;
      const kept = prices.map((row) => {
        if (row.active && !incoming.has(key(row))) {
          deactivated += 1;
          return { ...row, active: false, fetchedAt };
        }
        return row;
      });
      const byKey = new Map(kept.map((row) => [key(row), row]));
      for (const row of rows) byKey.set(key(row), { ...row, active: true, fetchedAt });
      prices = [...byKey.values()];
      return ok({ upserted: rows.length, deactivated });
    },

    async priceOffer(stripePriceId) {
      const failed = failure("priceOffer");
      if (failed) return failed;
      const row = prices.find((candidate) => candidate.stripePriceId === stripePriceId);
      return ok(row === undefined ? null : { lookupKey: row.lookupKey, passDays: row.passDays });
    },

    async activePrices() {
      const failed = failure("activePrices");
      if (failed) return failed;
      return ok(
        prices
          .filter((row) => row.active)
          .sort((a, b) => a.lookupKey.localeCompare(b.lookupKey) || a.currency.localeCompare(b.currency)),
      );
    },
  };

  return store;
}
