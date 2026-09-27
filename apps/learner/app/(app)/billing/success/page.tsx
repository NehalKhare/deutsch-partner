import Link from "next/link";

import { OFFERS, offerKeySchema } from "@dp/domain/billing";
import { comparePlans } from "@dp/domain/plans";
import { buttonPrimary, buttonQuiet, pageTitle, prose } from "@dp/ui/styles";

import { WaitForPlan } from "@/components/billing/wait-for-plan";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { planName } from "@/lib/billing/copy";
import { currentBilling } from "@/lib/billing/entitlement";
import { BILLING_PATH } from "@/lib/billing/offers";
import { planStatusLine } from "@/lib/billing/status";

export const metadata = { title: "Confirming your plan" };

/**
 * Where Stripe sends the learner back to.
 *
 * It grants nothing (billing-and-plans-spec.md S5). Arriving here proves only
 * that someone was redirected; the plan exists when the webhook has written
 * it from what Stripe says, and not before. So the page reads the learner's
 * own rows, as every page does, and either shows the plan or waits for it —
 * asking the server again every few seconds, never deciding for itself.
 *
 * The offer in the address only says which plan to wait for. It is checked
 * against the closed list, and it can make the page wait longer; it can
 * never make it show a plan the rows do not hold.
 */
export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ offer?: string | string[] }>;
}) {
  const learnerId = await requireAuthenticatedUserId();
  const [{ offer }, standing] = await Promise.all([searchParams, currentBilling(learnerId)]);

  const key = offerKeySchema.safeParse(offer);
  const expected = key.success ? OFFERS[key.data].plan : null;
  const plan = standing.entitlement.plan;
  const arrived =
    standing.readable && plan !== "free" && (expected === null || comparePlans(plan, expected) >= 0);

  if (arrived) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 md:px-8 md:py-10">
        <h1 className={pageTitle}>Welcome to {planName(plan)}</h1>
        <p className={prose}>{planStatusLine(standing)}</p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Link href="/chat" className={buttonPrimary}>
            Start a conversation
          </Link>
          <Link href={BILLING_PATH} className={buttonQuiet}>
            Plan &amp; billing
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 md:px-8 md:py-10">
      <h1 className={pageTitle}>Confirming with Stripe</h1>
      <p className={prose}>
        Your plan starts as soon as Stripe confirms it to us, usually within a few seconds.
        There is nothing more to do here.
      </p>
      <WaitForPlan />
    </main>
  );
}
