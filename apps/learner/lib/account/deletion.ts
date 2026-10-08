import type { BillingProvider } from "@dp/billing/provider";
import type { BillingAdminRepository } from "@dp/db/billing-repository";
import type { RateLimiter } from "@dp/db/rate-limit-repository";
import type { OpsNotificationSink } from "@dp/domain/notifications";
import type { Logger } from "@dp/observability/logger";

/**
 * Deleting one's own account (Art. 17 GDPR; billing-and-plans-spec.md S10).
 *
 * The order matters. A Stripe subscription does not live in our tables, so
 * cascading the profile would leave it billing a learner who no longer
 * exists; every live one is set to end at its paid period first, and the
 * account goes only if all of them were. Then the auth user, which is what
 * every learner table cascades from. The usage ledger keeps its pseudonymous
 * rows, as the cost spec requires, and nothing in them names anyone.
 *
 * The phrase the learner types is fixed and in their own words — not a
 * pseudonym they would have to look up — because the point here is a pause,
 * not a proof of identity; the session is the proof.
 */

export const DELETION_PHRASE = "delete my account";

export const DELETION_ERRORS = {
  phrase: `Type “${DELETION_PHRASE}” to confirm.`,
  rate_limited: "Please wait a while before trying again.",
  billing_unavailable:
    "We could not check your subscription with the payment service, so nothing was deleted. Please try again.",
  subscription_not_cancelled:
    "Your subscription could not be cancelled, so the account was not deleted: it would have kept charging you. Please try again, or cancel it on Plan & billing first.",
  auth_failed: "The account could not be deleted just now. Nothing was removed. Please try again.",
} as const;

export type DeletionError = keyof typeof DELETION_ERRORS;

export type DeletionOutcome =
  | { readonly ok: true; readonly subscriptionsEnded: number }
  | { readonly ok: false; readonly error: DeletionError };

export interface AuthAccounts {
  delete(learnerId: string): Promise<{ readonly ok: boolean }>;
}

export interface DeletionDeps {
  /** Null when payments are off: then there is nothing at Stripe to end. */
  readonly provider: BillingProvider | null;
  readonly admin: Pick<BillingAdminRepository, "liveSubscriptionsFor">;
  readonly accounts: AuthAccounts;
  readonly limiter: RateLimiter;
  readonly logger: Logger;
  /** Where the operators hear a learner left. By pseudonym, like the audit line. */
  readonly alerts?: OpsNotificationSink;
}

export async function deleteOwnAccount(
  identity: { readonly learnerId: string; readonly userIdHash: string },
  typed: unknown,
  deps: DeletionDeps,
): Promise<DeletionOutcome> {
  if (String(typed ?? "").trim().toLowerCase() !== DELETION_PHRASE) return { ok: false, error: "phrase" };

  const decision = await deps.limiter.check(identity.userIdHash);
  if (!decision.allowed) return { ok: false, error: "rate_limited" };

  const live = await deps.admin.liveSubscriptionsFor(identity.learnerId);
  if (!live.ok) return { ok: false, error: "billing_unavailable" };

  let ended = 0;
  for (const subscription of live.data) {
    if (subscription.cancelAtPeriodEnd) continue;
    if (deps.provider === null) {
      // A live row with payments off is a mirror of something nobody can
      // reach from here; refusing is the only honest answer.
      return { ok: false, error: "subscription_not_cancelled" };
    }
    try {
      await deps.provider.cancelAtPeriodEnd(subscription.stripeSubscriptionId);
      ended += 1;
    } catch {
      deps.logger.warn("account.subscription_cancel_failed", { userIdHash: identity.userIdHash });
      return { ok: false, error: "subscription_not_cancelled" };
    }
  }

  const deleted = await deps.accounts.delete(identity.learnerId);
  if (!deleted.ok) {
    deps.logger.error("account.delete_failed", { userIdHash: identity.userIdHash, subscriptionsEnded: ended });
    return { ok: false, error: "auth_failed" };
  }

  deps.logger.info("account.deleted", { audit: true, userIdHash: identity.userIdHash, subscriptionsEnded: ended });
  await deps.alerts
    ?.notify({ kind: "account.deleted", userIdHash: identity.userIdHash, subscriptionsEnded: ended })
    .catch(() => undefined);
  return { ok: true, subscriptionsEnded: ended };
}
