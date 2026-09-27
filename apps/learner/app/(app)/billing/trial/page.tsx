import Link from "next/link";
import { Check } from "lucide-react";

import { TRIAL_DAYS, TRIAL_PLAN } from "@dp/domain/billing";
import { buttonQuiet, card, eyebrow, pageTitle } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { startTrialAction } from "@/app/(app)/billing/actions";
import { BillingActionForm } from "@/components/billing/billing-action-form";
import { BillingNotice } from "@/components/billing/billing-notice";
import { paymentsEnabled } from "@/lib/api/composition";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { currentPrices } from "@/lib/billing/catalogue";
import { planHighlights, planName } from "@/lib/billing/copy";
import { currentBilling } from "@/lib/billing/entitlement";
import { PRICING_PATH, TRIAL_OFFER, offerCatalogue } from "@/lib/billing/offers";

export const metadata = { title: `${planName(TRIAL_PLAN)} trial` };

const sectionLabel =
  "font-display text-xs font-semibold uppercase tracking-[0.14em] text-copy/55";

/**
 * Premium's one trial (billing-and-plans-spec.md S6).
 *
 * Seven days, no card collected, and no automatic conversion: when it ends it
 * simply ends. A trial that cannot turn into a charge places no paid order,
 * so there is no order button and no early-start box here — only what the
 * trial is and a button that starts it. A page of its own rather than a
 * button on the pricing card, so that what the trial is gets read before it
 * is started, and so a visitor who signs up first lands somewhere to press.
 */
export default async function TrialPage() {
  const learnerId = await requireAuthenticatedUserId();
  const name = planName(TRIAL_PLAN);

  if (!paymentsEnabled()) {
    return (
      <BillingNotice title="Payments are not switched on yet">
        <p>The trial starts through our payment provider, so it waits until payments are on. Free carries on as it is.</p>
      </BillingNotice>
    );
  }

  const [standing, prices] = await Promise.all([currentBilling(learnerId), currentPrices()]);

  if (!standing.readable) {
    return (
      <BillingNotice title="Your plan could not be read">
        <p>We could not check whether this account has had its trial. Please refresh in a moment.</p>
      </BillingNotice>
    );
  }

  // Said as what is true of this account. Having subscribed rules the trial
  // out too, but a learner who never had it has not "had it".
  if (!standing.trialEligible) {
    return (
      <BillingNotice title={standing.trialUsed ? "The trial has been used" : "The trial is for new accounts"}>
        <p>
          {standing.trialUsed
            ? `There is one ${name} trial per account, and this account has had it.`
            : `The ${name} trial is for accounts that have not subscribed before.`}
        </p>
        <Link href={PRICING_PATH} className={cn(buttonQuiet, "self-start")}>
          See plans and prices
        </Link>
      </BillingNotice>
    );
  }

  if (standing.entitlement.plan === TRIAL_PLAN) {
    return (
      <BillingNotice title={`You already have ${name}`}>
        <p>Save the trial for later: it is one per account, and it starts the moment you press it.</p>
      </BillingNotice>
    );
  }

  // The trial subscribes to Premium's monthly Price, card-free; without the
  // Price in the mirror there is nothing to start it on.
  if (!offerCatalogue(prices).offers[TRIAL_OFFER]) {
    return (
      <BillingNotice title="The trial is not available just now">
        <p>Please try again a little later.</p>
      </BillingNotice>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 md:px-8 md:py-10">
      <header className="flex flex-col gap-1">
        <p className={eyebrow}>{name} trial</p>
        <h1 className={pageTitle}>
          Try {name} free for {TRIAL_DAYS} days
        </h1>
      </header>

      <BillingActionForm action={startTrialAction} submitLabel="Start my free trial" className={card}>
        <section aria-labelledby="trial-included" className="flex flex-col gap-2">
          <h2 id="trial-included" className={sectionLabel}>
            What you get
          </h2>
          <ul className="flex flex-col gap-1.5 text-sm text-copy/80">
            {planHighlights(TRIAL_PLAN).map((line) => (
              <li key={line} className="flex gap-2">
                <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-sprout" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>

        <dl className="grid gap-x-4 gap-y-2 border-t border-edge/50 pt-4 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className={sectionLabel}>Cost</dt>
          <dd className="font-display font-semibold text-copy">Nothing. No card is asked for.</dd>
          <dt className={sectionLabel}>When it ends</dt>
          <dd className="text-copy/80">
            After {TRIAL_DAYS} days it ends by itself. Nothing renews and nothing is charged, and Free carries on.
          </dd>
          <dt className={sectionLabel}>How often</dt>
          <dd className="text-copy/80">Once per account.</dd>
        </dl>
      </BillingActionForm>

      <p className="text-sm leading-relaxed text-copy/60">
        Next, Stripe&apos;s page confirms the trial. It does not ask for a card.
      </p>
    </main>
  );
}
