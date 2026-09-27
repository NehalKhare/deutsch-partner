import Link from "next/link";

import { TRIAL_DAYS, TRIAL_PLAN } from "@dp/domain/billing";
import { buttonPrimary, buttonQuiet, linkInline } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { openPortalAction } from "@/app/(app)/billing/actions";
import { BillingActionForm } from "@/components/billing/billing-action-form";
import { AlwaysFree } from "@/components/pricing/always-free";
import { paymentsEnabled } from "@/lib/api/composition";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { planName } from "@/lib/billing/copy";
import { currentBilling } from "@/lib/billing/entitlement";
import { PRICING_PATH, TRIAL_PATH } from "@/lib/billing/offers";
import { planNotices, planStatusLine } from "@/lib/billing/status";

export const metadata = { title: "Plan & billing" };

/** Section headings as small labels, as on settings. */
const sectionLabel =
  "font-display text-xs font-semibold uppercase tracking-[0.14em] text-copy/55";

const panel = "flex flex-col gap-3 rounded-2xl border border-edge/70 bg-panel/50 p-4";

/**
 * Plan & billing.
 *
 * What the learner has, until when, and the one door to change it: Stripe's
 * Customer Portal, where a plan is switched, a card replaced, an invoice
 * downloaded or a subscription cancelled (billing-and-plans-spec.md S6). The
 * plan shown is the one resolved from the learner's own rows, which only the
 * webhook writes; nothing on this page changes it.
 *
 * Whatever the plan, the page ends with what never costs anything, because
 * the question a billing page raises is what happens if you stop paying.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string | string[] }>;
}) {
  const learnerId = await requireAuthenticatedUserId();
  const [{ checkout }, standing] = await Promise.all([searchParams, currentBilling(learnerId)]);
  const payments = paymentsEnabled();
  const plan = standing.entitlement.plan;
  // On the trial alone there is nothing to manage, and the portal is where a
  // card is added or a plan changed — either of which would turn a trial that
  // places no order into a charge (spec S6). Ordering happens on the order page.
  const trialOnly = standing.trial !== null && standing.paidSubscription === null;
  const portal = standing.hasCustomer && !trialOnly;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-4 md:gap-5 md:px-8 md:py-8">
      <header className="flex flex-col gap-0.5">
        <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
          Plan &amp; billing
        </h1>
        <p className="text-sm leading-snug text-copy/65">
          What you have, until when, and where to change it.
        </p>
      </header>

      {checkout === "cancelled" ? (
        <p role="status" className="rounded-2xl border border-edge/70 bg-panel/50 px-4 py-2.5 text-sm text-copy/80">
          Checkout was cancelled. Nothing was charged.
        </p>
      ) : null}

      <section aria-labelledby="plan-heading" className={panel}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="plan-heading" className={sectionLabel}>
              Your plan
            </h2>
            {standing.readable ? (
              <p className="font-display text-2xl font-semibold tracking-tight text-brand">{planName(plan)}</p>
            ) : null}
            <p className="text-sm text-copy/75">{planStatusLine(standing)}</p>
          </div>
          {portal && payments ? (
            <BillingActionForm action={openPortalAction} submitLabel="Manage billing" submitClassName={buttonQuiet} />
          ) : null}
        </div>

        {planNotices(standing).map((notice) => (
          <p
            key={notice.text}
            className={cn(
              "rounded-xl border px-3 py-2 text-sm text-copy/85",
              notice.tone === "warning" ? "border-ember/40 bg-ember/10" : "border-edge/70 bg-ground/60",
            )}
          >
            {notice.text}
          </p>
        ))}

        {portal ? (
          <p className="text-xs leading-relaxed text-copy/55">
            Manage billing opens Stripe&apos;s Customer Portal: change plan, replace your card,
            download invoices or cancel. The portal cannot change a Klarna or iDEAL payment
            method; to switch from one, cancel and subscribe again with another.
          </p>
        ) : null}
      </section>

      {standing.readable && (plan !== "premium" || trialOnly) ? (
        <section aria-labelledby="more-heading" className={panel}>
          <h2 id="more-heading" className={sectionLabel}>
            {trialOnly ? "After the trial" : "More practice"}
          </h2>
          <p className="text-sm leading-relaxed text-copy/75">
            {trialOnly
              ? `To keep ${planName(TRIAL_PLAN)} after the trial, or to choose Plus, order it on the pricing page. ` +
                "Nothing is charged for the trial either way."
              : "Plus and Premium add a stronger tutor model, more conversation each day and a natural " +
                "voice. Monthly, yearly, or a one-off pass."}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href={PRICING_PATH} className={cn(buttonPrimary, "text-sm")}>
              See plans and prices
            </Link>
            {standing.trialEligible && payments ? (
              <Link href={TRIAL_PATH} className={cn(linkInline, "font-display text-sm")}>
                Try {planName(TRIAL_PLAN)} free for {TRIAL_DAYS} days
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="free-heading" className={panel}>
        <h2 id="free-heading" className={sectionLabel}>
          Always free, on every plan
        </h2>
        <AlwaysFree compact />
      </section>
    </main>
  );
}
