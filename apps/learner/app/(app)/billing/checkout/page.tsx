import Link from "next/link";

import { OFFERS, TERMS_VERSION, offerKeySchema } from "@dp/domain/billing";
import { nextPassStart } from "@dp/domain/entitlement";
import { buttonQuiet, card, eyebrow, linkInline, pageTitle } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";
import { Check } from "lucide-react";

import { placeOrderAction } from "@/app/(app)/billing/actions";
import { BillingActionForm, ConsentCheckbox } from "@/components/billing/billing-action-form";
import { BillingNotice } from "@/components/billing/billing-notice";
import { paymentsEnabled } from "@/lib/api/composition";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { currentPrices } from "@/lib/billing/catalogue";
import {
  ORDER_BUTTON_LABEL,
  PAYMENT_METHODS,
  earlyStartConsent,
  planHighlights,
  planName,
} from "@/lib/billing/copy";
import { currentBilling } from "@/lib/billing/entitlement";
import { formatBillingDate } from "@/lib/billing/format";
import {
  BILLING_PATH,
  PRICING_PATH,
  TERMS_PATH,
  offerCatalogue,
  type PriceView,
} from "@/lib/billing/offers";

export const metadata = { title: "Your order" };

/** Section headings as small labels, as on settings: they name a region, the text speaks. */
const sectionLabel =
  "font-display text-xs font-semibold uppercase tracking-[0.14em] text-copy/55";

/**
 * The order page (billing-and-plans-spec.md S6, S11).
 *
 * The order is placed here, not on Stripe's page: German law needs the button
 * that places a paid order to say so unambiguously (§312j BGB), and hosted
 * Checkout's button cannot be relabelled. So directly above this page's
 * button stand the plan's main features, the total price including VAT, the
 * billing interval, that it renews until cancelled and how to cancel — then
 * the one early-start box, unticked — then the button, which says "Order with
 * obligation to pay". Pressing it records the order and the consent, and
 * only then opens Stripe's page to take a payment method for it.
 *
 * When any of that cannot be said truthfully — an offer we do not sell, a
 * price the mirror does not hold, payments not switched on, a subscription
 * already held — the page says so and has no button at all. A pass that
 * stacks behind a running one says when it starts, and asks for that start. The action
 * checks every one of these again: this page is what the learner reads, not
 * what they are held to.
 */

function orderTitle(price: PriceView): string {
  const name = `Deutsch Partner ${planName(price.plan)}`;
  if (price.kind === "pass") return `${name} pass`;
  return `${name}, ${price.interval === "year" ? "yearly" : "monthly"}`;
}

function priceLine(price: PriceView): string {
  if (price.kind === "pass") {
    const days = price.passDays === null ? "" : `, for ${price.passDays} days of ${planName(price.plan)}`;
    return `${price.amount} once, including VAT${days}.`;
  }
  const month = price.perMonth ? ` (${price.perMonth} a month)` : "";
  return `${price.amount} per ${price.interval}, including VAT${month}.`;
}

function renewalLine(price: PriceView): string {
  return price.kind === "pass"
    ? "Paid once. It does not renew."
    : `Renews every ${price.interval} until you cancel.`;
}

function cancelLine(price: PriceView): string {
  return price.kind === "pass"
    ? "Nothing to cancel: the pass ends by itself."
    : "Cancel any time on Plan & billing. Your plan runs to the end of the period you have paid for, then stops.";
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ offer?: string | string[] }>;
}) {
  const learnerId = await requireAuthenticatedUserId();
  const { offer } = await searchParams;

  const key = offerKeySchema.safeParse(offer);
  if (!key.success) {
    return (
      <BillingNotice title="Choose a plan first">
        <p>This order page did not say which plan it was for.</p>
        <Link href={PRICING_PATH} className={cn(buttonQuiet, "self-start")}>
          See plans and prices
        </Link>
      </BillingNotice>
    );
  }

  if (!paymentsEnabled()) {
    return (
      <BillingNotice title="Payments are not switched on yet">
        <p>Nothing can be bought for the moment. Free carries on exactly as it is.</p>
      </BillingNotice>
    );
  }

  const [prices, standing] = await Promise.all([currentPrices(), currentBilling(learnerId)]);

  if (!standing.readable) {
    return (
      <BillingNotice title="Your plan could not be read">
        <p>We could not read your current plan just now, so we cannot take an order safely. Please refresh in a moment.</p>
      </BillingNotice>
    );
  }

  // One subscription at a time. Changing plan is the Customer Portal's job,
  // which prorates; a second subscription would bill twice. The trial is not
  // one — nobody pays for it — so a learner on it orders here.
  if (OFFERS[key.data].kind === "subscription" && standing.paidSubscription !== null) {
    return (
      <BillingNotice title="You already have a subscription">
        <p>To move to another plan or interval, change your subscription instead of starting a second one.</p>
        <Link href={BILLING_PATH} className={cn(buttonQuiet, "self-start")}>
          Go to Plan &amp; billing
        </Link>
      </BillingNotice>
    );
  }

  const price = offerCatalogue(prices).offers[key.data];
  if (!price) {
    return (
      <BillingNotice title="This price is not available">
        <p>This price is not available just now, so it cannot be ordered. Nothing was charged.</p>
        <Link href={PRICING_PATH} className={cn(linkInline, "self-start font-display text-sm")}>
          See plans and prices
        </Link>
      </BillingNotice>
    );
  }

  const product = `Deutsch Partner ${planName(price.plan)}`;

  // A pass stacks behind a running pass of the same plan (the webhook
  // decides the window the same way), so it starts then, and the page says
  // when rather than promising a start today.
  const now = new Date();
  const passStart = price.kind === "pass" ? nextPassStart(standing.passes, price.plan, now) : null;
  const startsOn = passStart !== null && passStart.getTime() > now.getTime() ? formatBillingDate(passStart) : null;
  const trialEnd = standing.trial ? (standing.trial.trialEnd ?? standing.trial.currentPeriodEnd) : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 md:px-8 md:py-10">
      <header className="flex flex-col gap-1">
        <p className={eyebrow}>Your order</p>
        <h1 className={pageTitle}>{orderTitle(price)}</h1>
      </header>

      <BillingActionForm action={placeOrderAction} submitLabel={ORDER_BUTTON_LABEL} className={card}>
        <input type="hidden" name="offer" value={price.offerKey} />
        {/* Compared on the server, never charged: Stripe charges the Price.
            A price that moved since this page was drawn refuses the order. */}
        <input type="hidden" name="shownAmountMinor" value={price.amountMinor} />

        <section aria-labelledby="included-heading" className="flex flex-col gap-2">
          <h2 id="included-heading" className={sectionLabel}>
            What is included
          </h2>
          <ul className="flex flex-col gap-1.5 text-sm text-copy/80">
            {planHighlights(price.plan).map((line) => (
              <li key={line} className="flex gap-2">
                <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-sprout" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>

        <dl className="grid gap-x-4 gap-y-2 border-t border-edge/50 pt-4 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className={sectionLabel}>Price</dt>
          <dd className="font-display font-semibold text-copy">{priceLine(price)}</dd>
          {startsOn !== null ? (
            <>
              <dt className={sectionLabel}>Starts</dt>
              <dd className="text-copy/80">{`Starts on ${startsOn}, when your current ${planName(price.plan)} pass ends.`}</dd>
            </>
          ) : null}
          <dt className={sectionLabel}>Renewal</dt>
          <dd className="text-copy/80">{renewalLine(price)}</dd>
          <dt className={sectionLabel}>Cancelling</dt>
          <dd className="text-copy/80">{cancelLine(price)}</dd>
          {trialEnd !== null && price.kind === "subscription" ? (
            <>
              <dt className={sectionLabel}>Your trial</dt>
              <dd className="text-copy/80">
                {`Your ${planName(standing.trial!.planCode)} trial still ends on ${formatBillingDate(trialEnd)}, ` +
                  "and nothing is charged for it. This subscription is separate: its first payment is taken " +
                  "when you complete the order."}
              </dd>
            </>
          ) : null}
        </dl>

        <p className="border-t border-edge/50 pt-4 text-xs leading-relaxed text-copy/60">
          The order is placed under our{" "}
          <Link href={TERMS_PATH} className={linkInline}>
            terms and withdrawal policy
          </Link>{" "}
          (version {TERMS_VERSION}).
        </p>

        <ConsentCheckbox label={earlyStartConsent(product, startsOn)} />
      </BillingActionForm>

      <p className="text-sm leading-relaxed text-copy/60">
        Next, Stripe&apos;s secure page asks how you would like to pay: {PAYMENT_METHODS}, where
        available. Your card and bank details stay with Stripe.
      </p>
    </main>
  );
}
